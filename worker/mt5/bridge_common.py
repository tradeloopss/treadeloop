"""Shared plumbing for the TradeLoop MetaTrader bridges (bridge.py for MT5,
bridge_mt4.py for MT4): the local-only HTTP server, the shared-token check,
one-request-at-a-time locking, and ending a terminal process by its path.
Runs under Windows Python in Wine on the sync VPS (see README.md)."""

import ctypes
import ctypes.wintypes as wt
import hmac
import json
import os
import threading
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


def serve(port, token_file, get_routes, post_routes, on_bridge_error=None):
    """Serves the bridge on 127.0.0.1:port. Every call needs the X-Bridge-Token
    header and runs alone (a terminal holds one account at a time)."""
    with open(token_file, encoding="utf-8") as fh:
        token = fh.read().strip()
    lock = threading.Lock()

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

        def call(self, fn, *fn_args):
            if not hmac.compare_digest(self.headers.get("X-Bridge-Token", ""), token):
                return self.reply(401, {"ok": False, "kind": "unauthorized", "message": "bad bridge token"})
            with lock:
                try:
                    return self.reply(200, fn(*fn_args))
                except BridgeError as err:
                    if on_bridge_error:
                        on_bridge_error(err)
                    return self.reply(err.status, {"ok": False, "kind": err.kind, "message": err.message, "code": err.code})
                except Exception as err:  # never let one bad request kill the bridge
                    return self.reply(500, {"ok": False, "kind": "internal", "message": str(err)})

        def do_GET(self):
            fn = get_routes.get(self.path)
            if fn is None:
                return self.reply(404, {"ok": False, "kind": "not_found", "message": "not found"})
            return self.call(fn)

        def do_POST(self):
            fn = post_routes.get(self.path)
            if fn is None:
                return self.reply(404, {"ok": False, "kind": "not_found", "message": "not found"})
            try:
                length = int(self.headers.get("Content-Length") or 0)
                body = json.loads(self.rfile.read(length) or b"{}")
            except (ValueError, json.JSONDecodeError):
                return self.reply(400, {"ok": False, "kind": "request", "message": "invalid JSON"})
            return self.call(fn, body)

    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
