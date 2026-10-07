"""Shared plumbing for the TradeLoop MetaTrader bridges (bridge.py for MT5,
bridge_mt4.py for MT4): the local-only HTTP server, the shared-token check,
one-request-at-a-time locking, ending a terminal process by its path, and
keeping Wine's desktop fit to start a terminal on.
Runs under Windows Python in Wine on the sync VPS (see README.md)."""

import ctypes
import ctypes.wintypes as wt
import hmac
import json
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


class BridgeError(Exception):
    """A failure the worker can act on. kind: auth | server | terminal |
    timeout | request | internal."""

    def __init__(self, status, kind, message, code=None):
        super().__init__(message)
        self.status, self.kind, self.message, self.code = status, kind, message, code


def kill_process(exe_path):
    """Ends every process running exactly `exe_path` (so other bridges'
    terminals are left alone) and waits for each to exit."""
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

    exe_name = os.path.basename(exe_path).lower()
    target = os.path.normcase(os.path.normpath(exe_path))
    snap = k32.CreateToolhelp32Snapshot(0x2, 0)  # TH32CS_SNAPPROCESS
    entry = ProcessEntry()
    entry.dwSize = ctypes.sizeof(entry)
    more = k32.Process32FirstW(snap, ctypes.byref(entry))
    while more:
        if entry.szExeFile.lower() == exe_name:
            # PROCESS_TERMINATE | SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION
            handle = k32.OpenProcess(0x0001 | 0x00100000 | 0x1000, False, entry.th32ProcessID)
            if handle:
                buf = ctypes.create_unicode_buffer(1024)
                size = wt.DWORD(1024)
                if k32.QueryFullProcessImageNameW(handle, 0, buf, ctypes.byref(size)) and os.path.normcase(os.path.normpath(buf.value)) == target:
                    k32.TerminateProcess(handle, 0)
                    k32.WaitForSingleObject(handle, 15_000)
                k32.CloseHandle(handle)
        more = k32.Process32NextW(snap, ctypes.byref(entry))
    k32.CloseHandle(snap)


# Where Wine's X11 driver keeps, on the desktop window, the id of the window it
# confines the cursor with. It belongs to the desktop's owner (explorer.exe).
CLIP_WINDOW = "__wine_x11_clip_window"


def mend_desktop():
    """Takes a dead window off Wine's desktop before a terminal starts on it.

    The desktop belongs to an explorer.exe that Wine starts by itself, as a
    child of whichever program first needed a desktop: so it lives in that
    program's service and dies when that service is restarted. Wine starts no
    other while anything is still on the desktop, and the desktop window goes
    on naming the old owner's cursor-clip window, which is gone. Every program
    started after that is killed by the X server the moment it touches the
    cursor clip (BadWindow on X_UnmapWindow). A terminal does as it logs in:
    the MT5 API then says "IPC recv failed" (or "send failed"), for every
    account on the shared terminals, until every program has left the desktop.
    That was 7 Oct 2026, after a restart of the copy lane's bridges.

    With the name taken off, a program skips cursor clipping, which nothing
    here needs. Only done when the desktop really has no owner: a clip window
    with a living owner is that owner's, and is left alone. Returns True if
    the desktop was mended."""
    try:
        # a user32 of our own: the argument types set here are nobody else's
        user32 = ctypes.WinDLL("user32")
        user32.GetDesktopWindow.restype = wt.HWND
        user32.GetWindowThreadProcessId.argtypes = [wt.HWND, ctypes.POINTER(wt.DWORD)]
        user32.GetWindowThreadProcessId.restype = wt.DWORD
        user32.GetPropW.argtypes = [wt.HWND, wt.LPCWSTR]
        user32.GetPropW.restype = wt.HANDLE
        user32.RemovePropW.argtypes = [wt.HWND, wt.LPCWSTR]
        user32.RemovePropW.restype = wt.HANDLE
        desktop = user32.GetDesktopWindow()
        if user32.GetWindowThreadProcessId(desktop, None) or not user32.GetPropW(desktop, CLIP_WINDOW):
            return False
        user32.RemovePropW(desktop, CLIP_WINDOW)
        print("[bridge] the desktop had lost its owner: its dead clip window is taken off", flush=True)
        return True
    except Exception as err:  # never the reason a terminal isn't started
        try:
            print(f"[bridge] could not check the desktop: {err}", flush=True)
        except Exception:
            pass
        return False


# Calls that must not wait behind a long one. A route that waits on purpose
# (the copy lane's /watch) asks urgent_waiting() as it goes and steps aside.
_urgent = 0
_urgent_lock = threading.Lock()
# When the call that holds the terminal now began (None: it is free).
_busy_since = None


def urgent_waiting():
    return _urgent > 0


def serve(port, token_file, get_routes, post_routes, on_bridge_error=None, urgent=()):
    """Serves the bridge on 127.0.0.1:port. Every call needs the X-Bridge-Token
    header and runs alone (a terminal holds one account at a time). A call to
    one of the `urgent` paths makes a waiting route give the terminal up.

    GET /alive answers without the terminal: how long the current call has had
    it, so a watchdog can tell a bridge stuck on a dead terminal from a busy one."""
    global _urgent, _busy_since
    with open(token_file, encoding="utf-8") as fh:
        token = fh.read().strip()
    lock = threading.Lock()

    class Handler(BaseHTTPRequestHandler):
        # keep the connection: the copy lane calls many times a second
        protocol_version = "HTTP/1.1"

        def log_message(self, fmt, *a):  # quiet; the worker logs outcomes
            pass

        def reply(self, status, body):
            data = json.dumps(body).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def call(self, fn, *fn_args):
            global _urgent, _busy_since
            if not hmac.compare_digest(self.headers.get("X-Bridge-Token", ""), token):
                return self.reply(401, {"ok": False, "kind": "unauthorized", "message": "bad bridge token"})
            pressing = self.path in urgent
            if pressing:
                with _urgent_lock:
                    _urgent += 1
            try:
                lock.acquire()
            finally:
                if pressing:
                    with _urgent_lock:
                        _urgent -= 1
            _busy_since = time.time()
            try:
                return self.reply(200, fn(*fn_args))
            except BridgeError as err:
                if on_bridge_error:
                    on_bridge_error(err)
                return self.reply(err.status, {"ok": False, "kind": err.kind, "message": err.message, "code": err.code})
            except Exception as err:  # never let one bad request kill the bridge
                return self.reply(500, {"ok": False, "kind": "internal", "message": str(err)})
            finally:
                _busy_since = None
                lock.release()

        def do_GET(self):
            if self.path == "/alive":
                if not hmac.compare_digest(self.headers.get("X-Bridge-Token", ""), token):
                    return self.reply(401, {"ok": False, "kind": "unauthorized", "message": "bad bridge token"})
                since = _busy_since
                return self.reply(200, {"ok": True, "busyFor": round(time.time() - since, 1) if since else 0})
            fn = get_routes.get(self.path)
            if fn is None:
                return self.reply(404, {"ok": False, "kind": "not_found", "message": "not found"})
            return self.call(fn)

        def do_POST(self):
            fn = post_routes.get(self.path)
            try:
                length = int(self.headers.get("Content-Length") or 0)
                body = json.loads(self.rfile.read(length) or b"{}")
            except (ValueError, json.JSONDecodeError):
                return self.reply(400, {"ok": False, "kind": "request", "message": "invalid JSON"})
            if fn is None:
                return self.reply(404, {"ok": False, "kind": "not_found", "message": "not found"})
            return self.call(fn, body)

    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
