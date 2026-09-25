#!/usr/bin/env python3
"""Adds one broker's server list ("pack") to the sync VPS. Run as the `mt5`
user, one broker at a time, when users need that broker:

  add_broker.py --platform mt5 --url https://download.mql5.com/cdn/web/<company>/mt5/<name>5setup.exe \\
                --slug ftmo --name FTMO --prefix FTMO-
  add_broker.py --platform mt4 --url .../mt4/<name>4setup.exe --slug exness --name Exness

It runs the broker's own MetaTrader installer under Wine, keeps only the
server list (MT5: Config/servers.dat -> brokers/<slug>/; MT4: config/*.srv ->
every MT4 terminal slot), registers it, and deletes the install. The first MT4
broker added also becomes the MT4 terminal (slots m1, m2) and gets the
TradeLoopExport script compiled into it. See README.md.
"""
import argparse
import glob
import json
import os
import re
import shutil
import subprocess
import sys
import time

ROOT = "/srv/mt5"
BROKERS = f"{ROOT}/brokers"
DRIVE_C = f"{ROOT}/wine/drive_c"
MT4_SLOTS = ["m1", "m2"]
EXPORT_SCRIPT = f"{DRIVE_C}/mt5/mql4/TradeLoopExport.mq4"
WINE = "/opt/wine-stable/bin/wine"
ENV = {
    **os.environ,
    "HOME": ROOT, "WINEPREFIX": f"{ROOT}/wine", "WINEARCH": "win64", "WINEDEBUG": "-all",
    "WINEDLLOVERRIDES": "mscoree,mshtml=", "DISPLAY": ":99",
}


def log(*a):
    print(*a, flush=True)


def save_json(path, data):
    tmp = path + ".tmp"
    with open(tmp, "w") as fh:
        json.dump(data, fh, indent=2)
    os.chmod(tmp, 0o644)
    os.replace(tmp, path)


def load_json(path, default):
    try:
        with open(path) as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return default


def install_dirs():
    return {d for base in ("Program Files", "Program Files (x86)") for d in glob.glob(f"{DRIVE_C}/{base}/*")}


def kill_from(directory):
    """Stops anything started from `directory` — the installer opens the new
    terminal when it finishes."""
    win = "C:\\" + os.path.relpath(directory, DRIVE_C).replace("/", "\\")
    subprocess.run(["pkill", "-u", "mt5", "-f", re.escape(win)], check=False)
    time.sleep(3)


def run_installer(url, exe_name):
    os.makedirs(f"{ROOT}/dl", exist_ok=True)
    path = f"{ROOT}/dl/{os.path.basename(url)}"
    if not os.path.exists(path):
        log("downloading", url)
        if subprocess.run(["curl", "-4", "-fsSL", "-m", "300", "-o", path, url]).returncode != 0:
            if os.path.exists(path):
                os.remove(path)
            sys.exit("download failed (MetaQuotes may be refusing this server for now) — nothing changed; try again later")
    before = install_dirs()
    log("installing (this takes a minute or two)…")
    proc = subprocess.Popen([WINE, path, "/auto"], env=ENV, cwd=ROOT)
    deadline = time.time() + 15 * 60
    new_dir = None
    while time.time() < deadline:
        fresh = [d for d in install_dirs() - before if os.path.exists(os.path.join(d, exe_name))]
        if fresh:
            new_dir = fresh[0]
            if proc.poll() is not None:
                break
        elif proc.poll() is not None:
            break
        time.sleep(5)
    if proc.poll() is None:
        proc.kill()
    if not new_dir:
        sys.exit("installer finished without installing a terminal (download refused?) — nothing changed")
    kill_from(new_dir)
    return new_dir


def add_mt5(args, install):
    src = os.path.join(install, "Config", "servers.dat")
    if not os.path.exists(src):
        sys.exit(f"no Config/servers.dat in {install}")
    os.makedirs(f"{BROKERS}/{args.slug}", exist_ok=True)
    shutil.copyfile(src, f"{BROKERS}/{args.slug}/servers.dat")
    os.chmod(f"{BROKERS}/{args.slug}/servers.dat", 0o644)
    brokers = [b for b in load_json(f"{BROKERS}/brokers.json", []) if b["slug"] != args.slug]
    brokers.append({"slug": args.slug, "name": args.name, "prefixes": args.prefix or [args.slug]})
    save_json(f"{BROKERS}/brokers.json", sorted(brokers, key=lambda b: b["slug"]))
    log(f"MT5 pack '{args.slug}' added ({os.path.getsize(src)} bytes); prefixes {args.prefix or [args.slug]}")


def ensure_mt4_slots(install):
    """The first MT4 install becomes the MT4 terminal: copy it into each slot
    and compile the export script there."""
    for slot in MT4_SLOTS:
        target = f"{DRIVE_C}/mt4/{slot}"
        if os.path.exists(os.path.join(target, "terminal.exe")):
            continue
        log("creating MT4 terminal slot", slot)
        shutil.copytree(install, target)
        scripts = os.path.join(target, "MQL4", "Scripts")
        os.makedirs(scripts, exist_ok=True)
        shutil.copyfile(EXPORT_SCRIPT, os.path.join(scripts, "TradeLoopExport.mq4"))
        editor = os.path.join(target, "metaeditor.exe")
        mq4 = f"C:\\mt4\\{slot}\\MQL4\\Scripts\\TradeLoopExport.mq4"
        subprocess.run([WINE, editor, f"/compile:{mq4}", "/log"], env=ENV, cwd=target, check=False, timeout=180)
        if not os.path.exists(os.path.join(scripts, "TradeLoopExport.ex4")):
            sys.exit(f"compiling TradeLoopExport.mq4 in {slot} failed — see {scripts}/TradeLoopExport.log")


def add_mt4(args, install):
    srv = glob.glob(os.path.join(install, "config", "*.srv"))
    if not srv:
        sys.exit(f"no config/*.srv in {install}")
    ensure_mt4_slots(install)
    os.makedirs(f"{BROKERS}/mt4", exist_ok=True)
    for f in srv:
        shutil.copy(f, f"{BROKERS}/mt4/")
        for slot in MT4_SLOTS:
            shutil.copy(f, f"{DRIVE_C}/mt4/{slot}/config/")
    names = sorted({os.path.splitext(os.path.basename(f))[0] for f in glob.glob(f"{BROKERS}/mt4/*.srv")})
    save_json(f"{BROKERS}/mt4-servers.json", names)
    log(f"MT4: {len(srv)} server files from '{args.name}' added; {len(names)} MT4 servers known")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--platform", choices=["mt5", "mt4"], required=True)
    ap.add_argument("--url", required=True)
    ap.add_argument("--slug", required=True)
    ap.add_argument("--name", required=True)
    ap.add_argument("--prefix", action="append", help="server-name prefix (MT5), e.g. FTMO-; defaults to the slug")
    args = ap.parse_args()
    if os.geteuid() == 0:
        sys.exit("run as the mt5 user: sudo -u mt5 add_broker.py …")
    install = run_installer(args.url, "terminal64.exe" if args.platform == "mt5" else "terminal.exe")
    try:
        (add_mt5 if args.platform == "mt5" else add_mt4)(args, install)
    finally:
        shutil.rmtree(install, ignore_errors=True)


if __name__ == "__main__":
    main()
