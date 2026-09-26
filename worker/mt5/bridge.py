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
import os
import shutil
import time

import MetaTrader5 as mt5

from bridge_common import BridgeError, kill_process, serve

parser = argparse.ArgumentParser()
parser.add_argument("--terminal", required=True, help=r"path to terminal64.exe, e.g. C:\mt5\t1\terminal64.exe")
parser.add_argument("--port", type=int, required=True)
parser.add_argument("--token-file", required=True)
args = parser.parse_args()

TERMINAL_DIR = os.path.dirname(args.terminal)
# MT5 IPC failures (send/receive/init/connect/timeout): the terminal went away
# (crashed, or restarted itself after an update) — drop the session so the
# next request starts it again.
IPC_ERRORS = {-10001, -10002, -10003, -10004, -10005}
# MT5 fields that are 64-bit ids — sent as strings so JavaScript can't round them.
ID_FIELDS = {"ticket", "order", "position_id", "position_by_id", "identifier", "magic", "external_id"}


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


def reset(req):
    """Stops the terminal and, when given one, installs a broker's server list
    (servers.dat) before the next start. A generic MT5 only knows the servers
    in that file, and reads it at startup — so serving another broker means a
    restart with that broker's list."""
    servers_dat = req.get("serversDat")
    mt5.shutdown()
    kill_process(args.terminal)
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


# --------------------------------------------------------------------------
# Order execution (write path). Only reached for accounts the user opted into
# trading, which is why the worker sends the MASTER password here — the investor
# password used for /sync can only read. Each op re-authenticates with the
# password given, so a terminal that was on a read-only session becomes able to
# trade. See lib/order-execution and worker.ts (processOrderCommands).

def pick_filling(info):
    """Pick a fill mode the symbol allows (its filling_mode is a bitmask:
    1 = FOK, 2 = IOC); fall back to RETURN."""
    modes = getattr(info, "filling_mode", 0) or 0
    if modes & 1:
        return mt5.ORDER_FILLING_FOK
    if modes & 2:
        return mt5.ORDER_FILLING_IOC
    return mt5.ORDER_FILLING_RETURN


def ensure_trading_login(account, password, server):
    """Authenticate the terminal with the given (master) password, forcing a
    re-login even when it's already on this account — a prior /sync may have
    logged in read-only, and only a master session can send orders."""
    if mt5.terminal_info() is None:
        start_terminal(account, password, server)
    elif not mt5.login(account, password=password, server=server, timeout=60_000):
        code, message = last_error()
        raise login_error(code, message)
    deadline = time.time() + 20
    while time.time() < deadline:
        term = mt5.terminal_info()
        if term and term.connected and current_login()[0] == account:
            return
        time.sleep(0.25)
    raise BridgeError(504, "timeout", "Logged in, but the account never finished connecting")


def send_order(request):
    result = mt5.order_send(request)
    if result is None:
        code, message = last_error()
        raise BridgeError(502, "order", f"order_send returned nothing: {message}", code)
    done = result.retcode in (mt5.TRADE_RETCODE_DONE, mt5.TRADE_RETCODE_DONE_PARTIAL, mt5.TRADE_RETCODE_PLACED)
    # A broker rejection is a normal result (accepted=False), not a bridge
    # error, so the worker records the retcode/comment rather than retrying.
    return {
        "accepted": bool(done),
        "retcode": int(result.retcode),
        "comment": result.comment,
        "order": str(result.order),
        "deal": str(result.deal),
        "volume": result.volume,
        "price": result.price,
    }


def position_by_ticket(ticket):
    positions = mt5.positions_get(ticket=ticket)
    if not positions:
        raise BridgeError(404, "position", "position not found — it may already be closed")
    return positions[0]


def ensure_symbol(symbol):
    info = mt5.symbol_info(symbol)
    if info is None:
        raise BridgeError(502, "order", f"unknown symbol {symbol}")
    if not info.visible:
        mt5.symbol_select(symbol, True)
        info = mt5.symbol_info(symbol)
    return info


def do_close(req, partial):
    ticket = int(req["positionRef"])
    pos = position_by_ticket(ticket)
    info = ensure_symbol(pos.symbol)
    volume = float(req["volume"]) if partial and req.get("volume") else pos.volume
    volume = min(volume, pos.volume)
    is_buy = pos.type == mt5.POSITION_TYPE_BUY
    tick = mt5.symbol_info_tick(pos.symbol)
    if tick is None:
        raise BridgeError(502, "order", f"no price for {pos.symbol}")
    return send_order({
        "action": mt5.TRADE_ACTION_DEAL,
        "position": ticket,
        "symbol": pos.symbol,
        "volume": volume,
        "type": mt5.ORDER_TYPE_SELL if is_buy else mt5.ORDER_TYPE_BUY,
        "price": tick.bid if is_buy else tick.ask,
        "deviation": 30,
        "type_time": mt5.ORDER_TIME_GTC,
        "type_filling": pick_filling(info),
        "comment": "TradeLoop",
    })


def do_modify(req):
    ticket = int(req["positionRef"])
    pos = position_by_ticket(ticket)
    return send_order({
        "action": mt5.TRADE_ACTION_SLTP,
        "position": ticket,
        "symbol": pos.symbol,
        "sl": float(req["stopLoss"]) if req.get("stopLoss") is not None else pos.sl,
        "tp": float(req["takeProfit"]) if req.get("takeProfit") is not None else pos.tp,
    })


def do_cancel(req):
    return send_order({"action": mt5.TRADE_ACTION_REMOVE, "order": int(req["orderRef"])})


ORDER_TYPE_NAMES = {
    ("long", "market"): "ORDER_TYPE_BUY",
    ("short", "market"): "ORDER_TYPE_SELL",
    ("long", "limit"): "ORDER_TYPE_BUY_LIMIT",
    ("short", "limit"): "ORDER_TYPE_SELL_LIMIT",
    ("long", "stop"): "ORDER_TYPE_BUY_STOP",
    ("short", "stop"): "ORDER_TYPE_SELL_STOP",
}


def do_place(req):
    symbol = str(req["symbol"])
    info = ensure_symbol(symbol)
    side = str(req.get("side") or "long")
    otype = str(req.get("orderType") or "market")
    type_name = ORDER_TYPE_NAMES.get((side, otype))
    if type_name is None:
        raise BridgeError(400, "request", f"bad order type {side}/{otype}")
    market = otype == "market"
    tick = mt5.symbol_info_tick(symbol)
    if tick is None:
        raise BridgeError(502, "order", f"no price for {symbol}")
    price = (tick.ask if side == "long" else tick.bid) if market else float(req["price"])
    request = {
        "action": mt5.TRADE_ACTION_DEAL if market else mt5.TRADE_ACTION_PENDING,
        "symbol": symbol,
        "volume": float(req["volume"]),
        "type": getattr(mt5, type_name),
        "price": price,
        "deviation": 30,
        "type_time": mt5.ORDER_TIME_GTC,
        "type_filling": pick_filling(info),
        "comment": "TradeLoop",
    }
    if req.get("stopLoss") is not None:
        request["sl"] = float(req["stopLoss"])
    if req.get("takeProfit") is not None:
        request["tp"] = float(req["takeProfit"])
    return send_order(request)


def order(req):
    try:
        account = int(req["login"])
        password = str(req["password"])
        server = str(req["server"]).strip()
        kind = str(req["kind"])
    except (KeyError, TypeError, ValueError):
        raise BridgeError(400, "request", "login, password, server and kind are required")
    ensure_trading_login(account, password, server)
    if kind == "close":
        return do_close(req, False)
    if kind == "partial_close":
        return do_close(req, True)
    if kind == "modify":
        return do_modify(req)
    if kind == "cancel":
        return do_cancel(req)
    if kind == "place":
        return do_place(req)
    raise BridgeError(400, "request", f"unknown order kind {kind}")


def on_bridge_error(err):
    if err.code in IPC_ERRORS:
        mt5.shutdown()


if __name__ == "__main__":
    serve(args.port, args.token_file, {"/health": health}, {"/sync": sync, "/reset": reset, "/order": order}, on_bridge_error)
