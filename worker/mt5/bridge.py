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
import hashlib
import hmac
import os
import shutil
import time

import MetaTrader5 as mt5

from bridge_common import BridgeError, kill_process, mend_desktop, serve, urgent_waiting

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
# The fill mode each symbol takes, learned once per session: it saves a call to
# the terminal on every order after the first (cleared whenever it logs in).
FILLING = {}
# Accounts a broker won't let trade even on the master password (disabled on
# the server, an evaluation that has ended), and when that was last found: such
# an account is logged in once, not again on every call for the next minutes.
NO_TRADE = {}

# Who may use a session that is already open.
#
# The terminals are shared: one is on an account because the last caller logged
# it in, and the next caller may be another connection to the same account.
# Being on the account already therefore says nothing about the password in the
# request, and a session used to be reused for any password at all: an account
# could be "connected" with a wrong password while its owner's sync kept a
# terminal on it, and an order could have gone out on a master session whose
# password its caller never had.
#
# So an open session is reused only for a password the broker itself has
# accepted for that account, in a login made by this process (ACCEPTED), and a
# session that can trade only for a password that opened one (TRADES). Anything
# else is logged in for real, and the broker decides. What is kept is a keyed
# digest, in memory, never the password, and a refused login forgets the
# account's digests.
_DIGEST_KEY = os.urandom(32)
ACCEPTED = {}
TRADES = {}


def _digest(account, server, password):
    return hmac.new(_DIGEST_KEY, f"{account}\0{server.strip().lower()}\0{password}".encode("utf-8"), hashlib.sha256).digest()


def _known(table, account, server, password):
    return _digest(account, server, password) in table.get(account, ())


def _remember(table, account, server, password):
    if len(table) > 2000:
        table.clear()
    held = table.setdefault(account, set())
    if len(held) > 16:
        held.clear()
    held.add(_digest(account, server, password))


def _forget(account):
    ACCEPTED.pop(account, None)
    TRADES.pop(account, None)


def refused(account):
    """A login the terminal reports as failed: what the worker is told, and,
    when it is the broker saying no, the end of what this account was known by."""
    code, message = last_error()
    if code == -6:
        _forget(account)
    return login_error(code, message)
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
    FILLING.clear()
    # a terminal started on a desktop that names a dead window dies as it logs in
    mend_desktop()
    if not mt5.initialize(path=args.terminal, portable=True, login=account, password=password, server=server, timeout=90_000):
        err = refused(account)
        mt5.shutdown()
        raise err
    # initialize() also attaches to a terminal that is still running, and one
    # already on this account is not made to ask the broker again. A password
    # the broker has not accepted yet is put to it now.
    if not _known(ACCEPTED, account, server, password) and not mt5.login(account, password=password, server=server, timeout=60_000):
        err = refused(account)
        mt5.shutdown()
        raise err


def record(obj):
    out = {}
    for key, value in obj._asdict().items():
        out[key] = str(value) if key in ID_FIELDS and value is not None else value
    return out


def current_login():
    info = mt5.account_info()
    return (info.login, info.server) if info else (None, None)


def login(account, password, server):
    """Logs the terminal into `account`, reusing the session when it is
    already on it and the password is one the broker has accepted for it."""
    if mt5.terminal_info() is None:
        start_terminal(account, password, server)
    else:
        term = mt5.terminal_info()
        have_login, have_server = current_login()
        if term and term.connected and have_login == account and (have_server or "").lower() == server.lower() and _known(ACCEPTED, account, server, password):
            return False
        if not mt5.login(account, password=password, server=server, timeout=60_000):
            raise refused(account)
    # The terminal reports success before the account is fully loaded; wait
    # for it to show the right account and a live connection.
    deadline = time.time() + 20
    while time.time() < deadline:
        term = mt5.terminal_info()
        if term and term.connected and current_login()[0] == account:
            _remember(ACCEPTED, account, server, password)
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


def kept_session(req):
    """Puts the terminal on the account the copy lane keeps it for, logging in
    only when it is not on it yet. Returns (account, fresh): fresh when it has
    only just logged in."""
    try:
        account = int(req["login"])
        password = str(req["password"])
        server = str(req["server"]).strip()
    except (KeyError, TypeError, ValueError):
        raise BridgeError(400, "request", "login, password and server are required")
    if req.get("trading"):
        before = mt5.account_info()
        ensure_trading_login(account, password, server)
        fresh = before is None or before.login != account or not before.trade_allowed
        try:
            # the "Algo Trading" button too, so the first order doesn't have to wait for it
            ensure_algo_trading(account)
        except BridgeError:
            pass
    else:
        fresh = login(account, password, server)
    if fresh:
        FILLING.clear()
        # the trade server sends the positions a moment after the login: wait until the count holds still
        last = -1
        for _ in range(12):
            total = mt5.positions_total()
            if total is not None and total == last:
                break
            last = total
            time.sleep(0.4)
    return account, fresh


def position_signature(listed):
    """What the copy engine acts on: which positions, how big, and their stops."""
    return "|".join(sorted(f"{p.ticket}:{p.volume}:{p.sl}:{p.tp}" for p in listed))


def read_positions(account, fresh, req, listed=None):
    term = mt5.terminal_info()
    info = mt5.account_info()
    if listed is None:
        listed = mt5.positions_get()
    if term is None or not term.connected or info is None or info.login != account or listed is None:
        code, message = last_error()
        raise BridgeError(502, "terminal", f"Could not read the positions: {message}", code)
    # of the tickets the caller knows and that are no longer listed: the ones a closing deal confirms
    here = {str(p.ticket) for p in listed} | {str(p.identifier) for p in listed}
    closed = []
    for ticket in req.get("check") or []:
        if str(ticket) in here:
            continue
        deals = mt5.history_deals_get(position=int(ticket))
        if deals and any(d.entry in (mt5.DEAL_ENTRY_OUT, mt5.DEAL_ENTRY_OUT_BY) for d in deals):
            closed.append(str(ticket))
    for symbol in req.get("prime") or []:
        # in Market Watch, so its price is already streaming when an order for it arrives
        if str(symbol) not in FILLING:
            try:
                ensure_symbol(str(symbol))
            except BridgeError:
                pass
    return {
        "positions": [record(p) for p in listed],
        "signature": position_signature(listed),
        "closed": closed,
        "balance": info.balance,
        "equity": info.equity,
        "tradeAllowed": bool(info.trade_allowed and term.trade_allowed),
        "fresh": bool(fresh),
        # the terminal's own measure of the round trip to the broker's server, in ms
        # (one that hasn't measured yet reports ten seconds: that is no reading)
        "ping": round(term.ping_last / 1000, 1) if 0 < getattr(term, "ping_last", 0) < 5_000_000 else None,
        "utcNow": int(time.time()),
    }


def positions(req):
    """The open positions of one account, from a session that is kept open for
    it (the copy lane's terminals). Logs in only when the terminal is not on
    this account yet. `check` is a list of tickets the caller knows: the ones
    that are gone and that a closing deal confirms are returned in `closed`, so
    a list that is short only because the terminal has just reconnected is
    never taken for positions that were closed."""
    account, fresh = kept_session(req)
    return read_positions(account, fresh, req)


def watch(req):
    """/positions that waits. Returns the moment the account's positions differ
    from `signature` (the one the last answer gave), or after `waitMs` with
    nothing changed. This is how the copy lane learns of a leader's trade
    within a few milliseconds instead of at its next look. An order that
    arrives for this terminal meanwhile ends the wait at once."""
    account, fresh = kept_session(req)
    if fresh:
        return read_positions(account, fresh, req)
    signature = str(req.get("signature") or "")
    deadline = time.time() + min(max(float(req.get("waitMs") or 1000), 0), 5000) / 1000
    listed = mt5.positions_get()
    # One look costs both this process and the terminal about a millisecond of
    # processor. Every 5ms is a quarter of a core per leader at most, and a
    # change is seen within 7ms.
    while listed is not None and position_signature(listed) == signature and time.time() < deadline and not urgent_waiting():
        time.sleep(0.005)
        listed = mt5.positions_get()
    return read_positions(account, False, req, listed)


def reset(req):
    """Stops the terminal and, when given one, installs a broker's server list
    (servers.dat) before the next start. A generic MT5 only knows the servers
    in that file, and reads it at startup — so serving another broker means a
    restart with that broker's list."""
    servers_dat = req.get("serversDat")
    FILLING.clear()
    mt5.shutdown()
    kill_process(args.terminal)
    if servers_dat:
        shutil.copyfile(servers_dat, os.path.join(TERMINAL_DIR, "Config", "servers.dat"))
    return {"ok": True}


def check(req):
    """Puts a password to the broker and says what the session it opens may do.

    Always a login of its own, whatever session the terminal was in: the answer
    is the broker's. Asked when a trader allows orders on an account, so that a
    password the broker rejects, or one that can only read, is told to them
    then and not at the first trade that is not copied."""
    try:
        account = int(req["login"])
        password = str(req["password"])
        server = str(req["server"]).strip()
    except (KeyError, TypeError, ValueError):
        raise BridgeError(400, "request", "login, password and server are required")
    FILLING.clear()
    if mt5.terminal_info() is None:
        start_terminal(account, password, server)
    if not mt5.login(account, password=password, server=server, timeout=60_000):
        raise refused(account)
    deadline = time.time() + 20
    while True:
        term = mt5.terminal_info()
        if term and term.connected and current_login()[0] == account:
            break
        if time.time() > deadline:
            raise BridgeError(504, "timeout", "Logged in, but the account never finished connecting")
        time.sleep(0.25)
    # The account's own switch can come a moment after the login: looked at
    # until it is on, for a few seconds, before "it can't trade" is believed.
    allowed = False
    for _ in range(10):
        info = mt5.account_info()
        if info is not None and info.login == account and info.trade_allowed:
            allowed = True
            break
        time.sleep(0.3)
    digest = _digest(account, server, password)
    _remember(ACCEPTED, account, server, password)
    if allowed:
        _remember(TRADES, account, server, password)
        NO_TRADE.pop(digest, None)
    else:
        if len(NO_TRADE) > 2000:
            NO_TRADE.clear()
        NO_TRADE[digest] = time.time()
    return {"ok": True, "tradeAllowed": allowed}


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
    """Make sure the terminal is a CONNECTED, trade-enabled master session on
    this account. Crucially, it REUSES an already-good session rather than
    re-logging in: a re-login is slow and resets the "Algo Trading" toolbar
    button, which would undo the enable the worker just did and bounce the
    order again. We only (re)login when the current session can't trade
    (trade_allowed is false — e.g. it's the read-only investor session from the
    last /sync, or a fresh terminal)."""
    term = mt5.terminal_info()
    # Two different things must both be true. term.trade_allowed is only the
    # terminal's "Algo Trading" button, and it stays on across a re-login with
    # the read-only investor password (which every /sync does). The ACCOUNT's
    # own trade_allowed is what says this session was opened with the master
    # password: on an investor session it is False, and an order sent then is
    # refused by the broker with retcode 10017 "Trade disabled".
    info = mt5.account_info()
    here = term is not None and term.connected and info is not None and info.login == account
    # The session is used as it is only for a password that opened one like it
    # (see ACCEPTED): a master session is not lent to a caller without the
    # master password, whoever left the terminal on the account.
    digest = _digest(account, server, password)
    if here and term.trade_allowed and info.trade_allowed and digest in TRADES.get(account, ()):
        NO_TRADE.pop(digest, None)
        return
    if here and not info.trade_allowed and time.time() - NO_TRADE.get(digest, 0) < 300:
        return
    if term is None:
        start_terminal(account, password, server)
    elif not mt5.login(account, password=password, server=server, timeout=60_000):
        raise refused(account)
    deadline = time.time() + 20
    while time.time() < deadline:
        term = mt5.terminal_info()
        if term and term.connected and current_login()[0] == account:
            _remember(ACCEPTED, account, server, password)
            info = mt5.account_info()
            if info is not None and info.trade_allowed:
                _remember(TRADES, account, server, password)
            elif info is not None:
                if len(NO_TRADE) > 2000:
                    NO_TRADE.clear()
                NO_TRADE[digest] = time.time()
            return
        time.sleep(0.25)
    raise BridgeError(504, "timeout", "Logged in, but the account never finished connecting")


# A user32 of our own: the argument types set here are nobody else's. They have
# to be set: a window handle is 64 bits wide, and passed untyped it goes as a C
# int, which raises for any handle above 2^31.
_WINDOW_VISITOR = ctypes.WINFUNCTYPE(wt.BOOL, wt.HWND, wt.LPARAM)
_user32 = ctypes.WinDLL("user32")
_user32.EnumWindows.argtypes = [_WINDOW_VISITOR, wt.LPARAM]
_user32.IsWindowVisible.argtypes = [wt.HWND]
_user32.GetWindowTextW.argtypes = [wt.HWND, wt.LPWSTR, ctypes.c_int]
_user32.SetForegroundWindow.argtypes = [wt.HWND]


def _terminal_window(account):
    """The terminal's main window handle. Its title starts with the logged-in
    account number (e.g. "474587297 - Exness-MT5Trial15: …")."""
    found = []
    needle = str(account)

    @_WINDOW_VISITOR
    def visit(hwnd, _lparam):
        # Whatever one window does, the next is still looked at: an exception
        # here ends the enumeration, and the terminal's window was then never
        # reached, so Algo Trading was never switched on from here.
        try:
            if _user32.IsWindowVisible(hwnd):
                buf = ctypes.create_unicode_buffer(512)
                _user32.GetWindowTextW(hwnd, buf, 512)
                title = buf.value or ""
                # The main terminal window carries the account + server; skip the
                # tiny "Default IME" helper window.
                if needle in title and "IME" not in title:
                    found.append(hwnd)
        except Exception:
            pass
        return True

    _user32.EnumWindows(visit, 0)
    return found[0] if found else None


def _press_algo_button(account):
    """Toggle the "Algo Trading" toolbar button via Ctrl+E, sent with the
    Windows API to the terminal window (we're in the same Wine session as it,
    so this is far more reliable than an X-level key from the Linux side)."""
    user32 = ctypes.windll.user32
    hwnd = _terminal_window(account)
    if not hwnd:
        return
    _user32.SetForegroundWindow(hwnd)
    time.sleep(0.2)
    VK_CONTROL, VK_E, KEYEVENTF_KEYUP = 0x11, 0x45, 0x0002
    user32.keybd_event(VK_CONTROL, 0, 0, 0)
    user32.keybd_event(VK_E, 0, 0, 0)
    user32.keybd_event(VK_E, 0, KEYEVENTF_KEYUP, 0)
    user32.keybd_event(VK_CONTROL, 0, KEYEVENTF_KEYUP, 0)
    time.sleep(0.5)


def ensure_algo_trading(account):
    """Make sure trade_allowed is on before an order. Only toggles when it's
    off (so it never turns a good session off), and retries a few times."""
    info = mt5.terminal_info()
    if info is not None and info.trade_allowed:
        return
    for _ in range(5):
        _press_algo_button(account)
        info = mt5.terminal_info()
        if info is not None and info.trade_allowed:
            return
        time.sleep(0.4)
    raise BridgeError(409, "autotrading", "Could not enable AutoTrading on the terminal")


def send_order(request):
    began = time.perf_counter()
    result = mt5.order_send(request)
    took = round((time.perf_counter() - began) * 1000, 1)
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
        # the round trip to the broker's server and back, as this terminal timed it
        "sendMs": took,
    }


def position_by_ticket(ticket, wait=6.0):
    """The open position with this ticket. Right after a login the terminal
    lists no positions for a moment, until it has synchronised with the trade
    server; an order that arrives then (a close, sent as the session is
    switched to the master password) would be told the position does not
    exist. So "not found" is only believed once it has stayed not found."""
    deadline = time.time() + wait
    while True:
        positions = mt5.positions_get(ticket=ticket)
        if positions:
            return positions[0]
        if time.time() >= deadline:
            raise BridgeError(404, "position", "position not found — it may already be closed")
        time.sleep(0.3)


def ensure_symbol(symbol):
    info = mt5.symbol_info(symbol)
    if info is None:
        raise BridgeError(502, "order", f"unknown symbol {symbol}")
    if not info.visible:
        mt5.symbol_select(symbol, True)
        info = mt5.symbol_info(symbol)
    FILLING[symbol] = pick_filling(info)
    return info


def filling_for(symbol):
    if symbol not in FILLING:
        ensure_symbol(symbol)
    return FILLING[symbol]


def do_close(req, partial):
    ticket = int(req["positionRef"])
    pos = position_by_ticket(ticket, float(req["wait"]) if req.get("wait") is not None else 6.0)
    filling = filling_for(pos.symbol)
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
        "type_filling": filling,
        "comment": "TradeLoop",
        **tag(req),
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
    filling = filling_for(symbol)
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
        "type_filling": filling,
        "comment": "TradeLoop",
        **tag(req),
    }
    if req.get("stopLoss") is not None:
        request["sl"] = float(req["stopLoss"])
    if req.get("takeProfit") is not None:
        request["tp"] = float(req["takeProfit"])
    return send_order(request)


def tag(req):
    """The number the copy lane gives an order it sends by itself. MetaTrader
    keeps it on the position, so after a crash the lane can tell whether that
    order reached the broker."""
    return {"magic": int(req["magic"])} if req.get("magic") is not None else {}


# Refusals that say the session can't trade as it is (Algo Trading off, an
# investor login): nothing was executed, so the order can be sent again once
# the session is put right. The same for a request that never left this machine.
SESSION_RETCODES = {10017, 10027}
NEVER_SENT = {-10001, -10004}


def run_order(kind, req):
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


def too_late(req):
    """A market order has a last moment it may be sent at (`deadline`, in
    seconds of this clock). Its caller waits for the answer until then and no
    longer: an order sent after it would open a position nobody is expecting,
    with nothing left to close it."""
    limit = req.get("deadline")
    return limit is not None and time.time() > float(limit)


LATE = "Not sent: the terminal took too long to be ready, and the order's time had passed"


def order(req):
    began = time.perf_counter()
    try:
        account = int(req["login"])
        password = str(req["password"])
        server = str(req["server"]).strip()
        kind = str(req["kind"])
    except (KeyError, TypeError, ValueError):
        raise BridgeError(400, "request", "login, password, server and kind are required")

    if kind == "place" and too_late(req):
        raise BridgeError(408, "late", LATE)

    def checked():
        ensure_trading_login(account, password, server)
        # A headless terminal starts with the "Algo Trading" button off (and a
        # re-login resets it), so order_send is refused with retcode 10027. Enable
        # it in-process, right here, after the login and before the order, so
        # nothing re-logs in between and resets it.
        ensure_algo_trading(account)
        # logging in can take most of a minute on a terminal that is new to the account: looked at again, last thing
        if kind == "place" and too_late(req):
            raise BridgeError(408, "late", LATE)
        return run_order(kind, req)

    # `fast`: the copy lane keeps this terminal on this account and has just
    # read it, so the checks above (four calls to the terminal) are skipped and
    # the order goes straight out. They run only if the session turns out not
    # to be what it was, and then the order is sent again. Never when it may
    # already have reached the broker.
    if req.get("fast"):
        try:
            result = run_order(kind, req)
            if not result["accepted"] and result["retcode"] in SESSION_RETCODES:
                result = checked()
        except BridgeError as err:
            if err.code not in NEVER_SENT:
                raise
            mt5.shutdown()
            result = checked()
    else:
        result = checked()
    result["totalMs"] = round((time.perf_counter() - began) * 1000, 1)
    return result


def on_bridge_error(err):
    if err.code in IPC_ERRORS:
        mt5.shutdown()


if __name__ == "__main__":
    serve(args.port, args.token_file, {"/health": health}, {"/sync": sync, "/reset": reset, "/order": order, "/positions": positions, "/watch": watch, "/check": check}, on_bridge_error, urgent=("/order",))
