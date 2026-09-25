"""TradeLoop MT5 bridge — a thin, local-only HTTP adapter around ONE MetaTrader 5
terminal, run under Wine on the sync VPS (Windows Python + the official
MetaTrader5 package; see worker/mt5/README.md).

It only reads: log into an account with its investor (read-only) password,
return the account's info, deals, orders and open positions exactly as MT5
reports them. Everything else — scheduling, storage, turning deals into
trades — lives in the Node worker and the app, so nothing outside this file
imports MetaTrader5.

A terminal holds one logged-in account at a time, so requests are serialized
with a lock; the worker runs several bridges (one terminal each) for
parallelism. Listens on 127.0.0.1 only and requires the shared token.
"""

import argparse
import ctypes
import ctypes.wintypes as wt
import hmac
import json
import os
import shutil
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import MetaTrader5 as mt5

parser = argparse.ArgumentParser()
parser.add_argument("--terminal", required=True, help=r"path to terminal64.exe, e.g. C:\mt5\t1\terminal64.exe")
parser.add_argument("--port", type=int, required=True)
parser.add_argument("--token-file", required=True)
args = parser.parse_args()

with open(args.token_file, encoding="utf-8") as fh:
    TOKEN = fh.read().strip()

TERMINAL_DIR = os.path.dirname(args.terminal)
LOCK = threading.Lock()
# MT5 IPC failures (send/receive/init/connect/timeout): the terminal went away
# (crashed, or restarted itself after an update) — drop the session so the
# next request starts it again.
IPC_ERRORS = {-10001, -10002, -10003, -10004, -10005}
# MT5 fields that are 64-bit ids — sent as strings so JavaScript can't round them.
ID_FIELDS = {"ticket", "order", "position_id", "position_by_id", "identifier", "magic", "external_id"}


class BridgeError(Exception):
    def __init__(self, status, kind, message, code=None):
        super().__init__(message)
        self.status, self.kind, self.message, self.code = status, kind, message, code


def last_error():
    code, message = mt5.last_error()
    return code, message


def login_error(code, message):
    # -6 is MT5's "authorization failed": wrong login/password, or a server
    # that rejected it. An IPC timeout during a login means the terminal never
    # became ready — in practice, a server name it couldn't find.
    if code == -6:
        return BridgeError(401, "auth", "MetaTrader rejected the login — check the account number, investor password and server name", code)
    if code == -10005:
        return BridgeError(404, "server", "Couldn't reach that MetaTrader server — check the server name matches your terminal exactly", code)
    return BridgeError(502, "terminal", f"MetaTrader login failed: {message}", code)


def start_terminal(account, password, server):
    """Attaches to (or starts) the terminal, logging it into `account`.

    A terminal that has never had an account sits in its first-run wizard and
    never answers the Python API, so a cold start has to hand over the login
    in initialize() itself rather than log in afterwards."""
    if not mt5.initialize(path=args.terminal, portable=True, login=account, password=password, server=server, timeout=90_000):
        code, message = last_error()
        mt5.shutdown()
        raise login_error(code, message)


def record(obj):
    out = {}
    for key, value in obj._asdict().items():
        out[key] = str(value) if key in ID_FIELDS and value is not None else value
    return out


def current_login():
    info = mt5.account_info()
    return (info.login, info.server) if info else (None, None)


def login(account, password, server):
    """Logs the terminal into `account`, reusing the session when it already is."""
    if mt5.terminal_info() is None:
        start_terminal(account, password, server)
    else:
        term = mt5.terminal_info()
        have_login, have_server = current_login()
        if term and term.connected and have_login == account and (have_server or "").lower() == server.lower():
            return False
        if not mt5.login(account, password=password, server=server, timeout=60_000):
            code, message = last_error()
            raise login_error(code, message)
    # The terminal reports success before the account is fully loaded; wait
    # for it to show the right account and a live connection.
    deadline = time.time() + 20
    while time.time() < deadline:
        term = mt5.terminal_info()
        if term and term.connected and current_login()[0] == account:
            return True
        time.sleep(0.25)
    raise BridgeError(504, "timeout", "Logged in, but the broker never finished connecting the account")


def settled_history(date_from, date_to):
    """Right after a login the terminal is still downloading the account's
    history, so read until the deal count stops growing."""
    last = -1
    for _ in range(20):
        total = mt5.history_deals_total(date_from, date_to)
        if total is not None and total == last:
            return
        last = total if total is not None else last
        time.sleep(0.5)


def server_clock():
    """Newest tick time across the Market Watch symbols — the broker's clock.
    Deal times are in broker server time, so the worker compares this with
    UTC now to learn the server's offset. None when every tick is stale (e.g.
    a weekend with no 24/7 symbols in Market Watch)."""
    best = None
    for sym in mt5.symbols_get() or ():
        if not sym.visible:
            continue
        tick = mt5.symbol_info_tick(sym.name)
        if tick and tick.time and (best is None or tick.time > best):
            best = tick.time
    return best


def sync(req):
    try:
        account = int(req["login"])
        password = str(req["password"])
        server = str(req["server"]).strip()
    except (KeyError, TypeError, ValueError):
        raise BridgeError(400, "request", "login, password and server are required")
    date_from = int(req.get("from") or 0)
    date_to = int(req.get("to") or (time.time() + 3 * 86400))

    fresh = login(account, password, server)
    if fresh:
        settled_history(date_from, date_to)

    info = mt5.account_info()
    if info is None:
        code, message = last_error()
        raise BridgeError(502, "terminal", f"Could not read the account: {message}", code)
    deals = mt5.history_deals_get(date_from, date_to)
    orders = mt5.history_orders_get(date_from, date_to)
    positions = mt5.positions_get()
    if deals is None or orders is None or positions is None:
        code, message = last_error()
        raise BridgeError(502, "terminal", f"Could not read the account history: {message}", code)
    return {
        "account": info._asdict(),
        "deals": [record(d) for d in deals],
        "orders": [record(o) for o in orders],
        "positions": [record(p) for p in positions],
        "serverClock": server_clock(),
        "utcNow": int(time.time()),
        "fresh": fresh,
    }


def kill_terminal():
    """Ends this bridge's own terminal process (matched by its full path, so
    other bridges' terminals are left alone) and waits for it to exit."""
    k32 = ctypes.windll.kernel32
    k32.CreateToolhelp32Snapshot.restype = wt.HANDLE
    k32.OpenProcess.restype = wt.HANDLE

    class ProcessEntry(ctypes.Structure):
        _fields_ = [
            ("dwSize", wt.DWORD), ("cntUsage", wt.DWORD), ("th32ProcessID", wt.DWORD),
            ("th32DefaultHeapID", ctypes.c_size_t), ("th32ModuleID", wt.DWORD), ("cntThreads", wt.DWORD),
            ("th32ParentProcessID", wt.DWORD), ("pcPriClassBase", ctypes.c_long), ("dwFlags", wt.DWORD),
            ("szExeFile", wt.WCHAR * 260),
        ]

    snap = k32.CreateToolhelp32Snapshot(0x2, 0)  # TH32CS_SNAPPROCESS
    entry = ProcessEntry()
    entry.dwSize = ctypes.sizeof(entry)
    more = k32.Process32FirstW(snap, ctypes.byref(entry))
    while more:
        if entry.szExeFile.lower() == "terminal64.exe":
            # PROCESS_TERMINATE | SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION
            handle = k32.OpenProcess(0x0001 | 0x00100000 | 0x1000, False, entry.th32ProcessID)
            if handle:
                buf = ctypes.create_unicode_buffer(1024)
                size = wt.DWORD(1024)
                if k32.QueryFullProcessImageNameW(handle, 0, buf, ctypes.byref(size)) and os.path.normcase(buf.value) == os.path.normcase(args.terminal):
                    k32.TerminateProcess(handle, 0)
                    k32.WaitForSingleObject(handle, 15_000)
                k32.CloseHandle(handle)
        more = k32.Process32NextW(snap, ctypes.byref(entry))
    k32.CloseHandle(snap)


def reset(req):
    """Stops the terminal and, when given one, installs a broker's server list
    (servers.dat) before the next start. A generic MT5 only knows the servers
    in that file, and reads it at startup — so serving another broker means a
    restart with that broker's list."""
    servers_dat = req.get("serversDat")
    mt5.shutdown()
    kill_terminal()
    if servers_dat:
        shutil.copyfile(servers_dat, os.path.join(TERMINAL_DIR, "Config", "servers.dat"))
    return {"ok": True}


def health():
    term = mt5.terminal_info()
    have_login, have_server = current_login()
    return {
        "ok": True,
        "terminal": None if term is None else {"connected": term.connected, "build": term.build, "company": term.company},
        "login": have_login,
        "server": have_server,
    }


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *a):  # quiet; the worker logs outcomes
        pass

    def reply(self, status, body):
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def authorized(self):
        return hmac.compare_digest(self.headers.get("X-Bridge-Token", ""), TOKEN)

    def handle_call(self, fn, *fn_args):
        if not self.authorized():
            return self.reply(401, {"ok": False, "kind": "unauthorized", "message": "bad bridge token"})
        with LOCK:
            try:
                return self.reply(200, fn(*fn_args))
            except BridgeError as err:
                if err.code in IPC_ERRORS:
                    mt5.shutdown()
                return self.reply(err.status, {"ok": False, "kind": err.kind, "message": err.message, "code": err.code})
            except Exception as err:  # never let one bad request kill the bridge
                return self.reply(500, {"ok": False, "kind": "internal", "message": str(err)})

    def do_GET(self):
        if self.path == "/health":
            return self.handle_call(health)
        self.reply(404, {"ok": False, "kind": "not_found", "message": "not found"})

    def do_POST(self):
        handler = {"/sync": sync, "/reset": reset}.get(self.path)
        if handler is None:
            return self.reply(404, {"ok": False, "kind": "not_found", "message": "not found"})
        try:
            length = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(length) or b"{}")
        except (ValueError, json.JSONDecodeError):
            return self.reply(400, {"ok": False, "kind": "request", "message": "invalid JSON"})
        return self.handle_call(handler, body)


if __name__ == "__main__":
    ThreadingHTTPServer(("127.0.0.1", args.port), Handler).serve_forever()
