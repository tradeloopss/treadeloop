"""TradeLoop MT4 bridge — drives ONE MetaTrader 4 terminal under Wine on the
sync VPS (see README.md). Same HTTP contract as the MT5 bridge (bridge.py), so
the worker and the app treat both platforms alike.

MT4 has no Python API. Instead, each sync starts the terminal with a one-off
startup config (login, investor password, server, and "run the
TradeLoopExport script"); the script waits for the login, writes the account's
info and history to MQL4\\Files\\tradeloop-<login>.json and closes the terminal.
This bridge then reshapes MT4's closed orders into MT5-style entry/exit deals.

A terminal knows a server only from the .srv files dropped into its config
folder (current builds import them into an encrypted config\\servers.ini on
their next start and delete the .srv files). MT4 reads every one, so one
terminal serves every broker we have files for (unlike MT5, no swapping); the
worker checks the server against mt4-servers.json before sending it here.
"""

import argparse
import glob
import json
import os
import re
import subprocess
import time

from bridge_common import BridgeError, kill_process, serve

parser = argparse.ArgumentParser()
parser.add_argument("--terminal", required=True, help=r"path to terminal.exe, e.g. C:\mt4\m1\terminal.exe")
parser.add_argument("--port", type=int, required=True)
parser.add_argument("--token-file", required=True)
args = parser.parse_args()

TERMINAL_DIR = os.path.dirname(args.terminal)
FILES_DIR = os.path.join(TERMINAL_DIR, "MQL4", "Files")
LOGS_DIR = os.path.join(TERMINAL_DIR, "logs")
CONFIG_DIR = os.path.join(TERMINAL_DIR, "config")
START_INI = os.path.join(TERMINAL_DIR, "tradeloop-start.ini")
# Where MT4 remembers accounts it has logged into (with their password).
ACCOUNTS_INI = os.path.join(CONFIG_DIR, "accounts.ini")
EXPORT_TIMEOUT = 150

# MT4 order types: 0 buy, 1 sell, 2-5 pending (cancelled ones sit in history
# too), 6 balance, 7 credit.
BUY, SELL, BALANCE, CREDIT = 0, 1, 6, 7


def log_sizes():
    return {path: os.path.getsize(path) for path in glob.glob(os.path.join(LOGS_DIR, "*.log"))}


def new_log_text(before):
    """Journal lines written since `before` (MT4 journals are ANSI text)."""
    text = []
    for path in glob.glob(os.path.join(LOGS_DIR, "*.log")):
        try:
            with open(path, "rb") as fh:
                fh.seek(before.get(path, 0))
                text.append(fh.read().decode("cp1252", errors="replace"))
        except OSError:
            pass
    return "\n".join(text)


def check_journal(before, account):
    text = new_log_text(before)
    if re.search(r"invalid account|incorrect password|invalid password", text, re.I):
        raise BridgeError(401, "auth", "MetaTrader rejected the login — check the account number, investor password and server name")
    if re.search(r"account disabled|account is disabled", text, re.I):
        raise BridgeError(401, "auth", "The broker says this account is disabled")


def export(account, password, server):
    os.makedirs(FILES_DIR, exist_ok=True)
    out = os.path.join(FILES_DIR, f"tradeloop-{account}.json")
    for stale in (out, out + ".part"):
        if os.path.exists(stale):
            os.remove(stale)
    kill_process(args.terminal)
    before = log_sizes()
    with open(START_INI, "w", encoding="cp1252", errors="replace") as fh:
        fh.write("\n".join([
            f"Login={account}",
            f"Password={password}",
            f"Server={server}",
            "AutoConfiguration=false",
            "EnableNews=false",
            "ExpertsEnable=true",
            "ExpertsDllImport=false",
            "ExpertsExpImport=false",
            "ExpertsTrades=false",
            "Script=TradeLoopExport",
        ]) + "\n")
    proc = subprocess.Popen([args.terminal, "/portable", START_INI], cwd=TERMINAL_DIR)
    try:
        deadline = time.time() + EXPORT_TIMEOUT
        while time.time() < deadline:
            if os.path.exists(out):
                with open(out, encoding="cp1252", errors="replace") as fh:
                    return json.load(fh)
            check_journal(before, account)
            if proc.poll() is not None and not os.path.exists(out):
                time.sleep(1)
                if not os.path.exists(out):
                    check_journal(before, account)
                    raise BridgeError(502, "terminal", "MetaTrader 4 closed before exporting the account")
            time.sleep(0.5)
        raise BridgeError(504, "timeout", "MetaTrader 4 didn't finish loading the account in time")
    finally:
        # The startup file holds the password, and MT4 saves the login in
        # accounts.ini: never leave either behind.
        try:
            os.remove(START_INI)
        except OSError:
            pass
        kill_process(args.terminal)
        try:
            os.remove(ACCOUNTS_INI)
        except OSError:
            pass


def reshape(data):
    """MT4 closed orders → MT5-style deals: an entry deal at open and an exit
    deal at close, sharing the ticket as the position id, so the worker and
    lib/metatrader-trades.ts need no MT4 special cases."""
    deals, orders = [], []
    for o in data.get("history", []):
        t, kind = str(o["ticket"]), o["type"]
        base = {"order": t, "magic": str(o.get("magic", 0)), "reason": 0, "external_id": "", "comment": o.get("comment", ""), "fee": 0.0}
        if kind in (BUY, SELL):
            deals.append({**base, "ticket": f"{t}.1", "position_id": t, "time": o["openTime"], "time_msc": o["openTime"] * 1000,
                          "type": kind, "entry": 0, "symbol": o["symbol"], "volume": o["lots"], "price": o["openPrice"],
                          "commission": o["commission"], "swap": 0.0, "profit": 0.0})
            deals.append({**base, "ticket": f"{t}.2", "position_id": t, "time": o["closeTime"], "time_msc": o["closeTime"] * 1000,
                          "type": SELL if kind == BUY else BUY, "entry": 1, "symbol": o["symbol"], "volume": o["lots"], "price": o["closePrice"],
                          "commission": 0.0, "swap": o["swap"], "profit": o["profit"]})
            orders.append({"ticket": t, "sl": o["sl"], "tp": o["tp"]})
        elif kind in (BALANCE, CREDIT):
            when = o["closeTime"] or o["openTime"]
            deals.append({**base, "ticket": f"{t}.0", "order": "0", "position_id": "0", "time": when, "time_msc": when * 1000,
                          "type": 2 if kind == BALANCE else 3, "entry": 0, "symbol": "", "volume": 0.0, "price": 0.0,
                          "commission": 0.0, "swap": 0.0, "profit": o["profit"]})
    positions = [
        {"ticket": str(o["ticket"]), "identifier": str(o["ticket"]), "type": o["type"], "symbol": o["symbol"], "volume": o["lots"],
         "price_open": o["openPrice"], "sl": o["sl"], "tp": o["tp"], "profit": o["profit"], "swap": o["swap"]}
        for o in data.get("open", []) if o["type"] in (BUY, SELL)
    ]
    return deals, orders, positions


def sync(req):
    try:
        account = int(req["login"])
        password = str(req["password"])
        server = str(req["server"]).strip()
    except (KeyError, TypeError, ValueError):
        raise BridgeError(400, "request", "login, password and server are required")
    data = export(account, password, server)
    a = data["account"]
    if int(a.get("login", 0)) != account:
        raise BridgeError(502, "terminal", "MetaTrader 4 exported a different account than requested")
    deals, orders, positions = reshape(data)
    return {
        "account": {"login": a["login"], "name": a.get("name", ""), "company": a.get("company", ""), "server": a.get("server", server),
                    "currency": a.get("currency", ""), "balance": a.get("balance", 0), "equity": a.get("equity", 0), "leverage": a.get("leverage", 0)},
        "deals": deals,
        "orders": orders,
        "positions": positions,
        "serverClock": data.get("serverClock") or None,
        "utcNow": int(time.time()),
        "fresh": True,
    }


def reset(req):
    kill_process(args.terminal)
    return {"ok": True}


def health():
    return {"ok": True, "platform": "mt4", "terminal": os.path.exists(args.terminal)}


if __name__ == "__main__":
    serve(args.port, args.token_file, {"/health": health}, {"/sync": sync, "/reset": reset})
