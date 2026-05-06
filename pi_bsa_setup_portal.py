#!/usr/bin/env python3
"""BSA Kiosk Setup Portal — single-step WiFi + coach-code pairing.

Runs in place of Balena wifi-connect. On boot (via wifi-connect-wrapper.sh):
  1. Wrapper waits 60s for a known WiFi to attach. If it does, portal is skipped.
  2. Otherwise this script runs: brings up an open AP 'BSA-Kiosk-Setup' at
     192.168.42.1, serves a single HTML form on port 80.
  3. Customer connects phone to the AP — captive portal detection triggers their
     browser to open this page.
  4. They pick their WiFi from a scanned list, enter the password, enter their
     coach's referral code (e.g. GLENM7NUS), submit.
  5. Script saves coach code to /home/pi/bsa-config, adds+activates WiFi in NM,
     tears down the AP, exits. Pi reboots into normal kiosk mode with the
     correct coach identity baked into the Chromium URL via autostart.

Zero extra deps — Python stdlib only.
"""

import http.server
import json
import os
import re
import signal
import socketserver
import subprocess
import threading
import time
from pathlib import Path
from urllib.parse import urlparse

# ────────────────────────────────────────────────────────────────
# Config
# ────────────────────────────────────────────────────────────────
AP_SSID      = "BSA-Kiosk-Setup"
AP_IFACE     = "wlan0"
AP_IP        = "192.168.42.1"
AP_CONN_NAME = "bsa-setup-hotspot"      # NM connection name
CONFIG_PATH  = Path("/home/pi/bsa-config")
UI_PATH      = Path("/usr/share/bsa-setup/index.html")

COACH_CODE_RE = re.compile(r"^[A-Z0-9]{4,20}$")

# Common captive portal detection probes — redirect them all to "/"
CAPTIVE_PROBES = {
    "/hotspot-detect.html",               # iOS/macOS
    "/library/test/success.html",         # iOS
    "/generate_204", "/gen_204",          # Android
    "/connecttest.txt", "/ncsi.txt",      # Windows
    "/fwlink", "/success.txt",            # misc
}

# ────────────────────────────────────────────────────────────────
# NetworkManager helpers
# ────────────────────────────────────────────────────────────────
def run(*args, timeout=30):
    """Run a command, return (returncode, stdout, stderr)."""
    try:
        r = subprocess.run(list(args), capture_output=True, text=True, timeout=timeout)
        return r.returncode, r.stdout, r.stderr
    except subprocess.TimeoutExpired:
        return -1, "", "timeout"
    except FileNotFoundError:
        return -1, "", "command-not-found"

def scan_wifi():
    """Return list of nearby WiFi networks ordered by signal strength."""
    run("nmcli", "device", "wifi", "rescan")
    time.sleep(2)  # rescan is async; give it a moment
    code, out, _ = run("nmcli", "-t", "-f", "SSID,SIGNAL,SECURITY", "device", "wifi", "list")
    if code != 0:
        return []
    seen = set()
    nets = []
    for line in out.strip().split("\n"):
        if not line or ":" not in line:
            continue
        parts = line.split(":", 2)
        if len(parts) < 2:
            continue
        ssid = parts[0].strip()
        if not ssid or ssid in seen or ssid == AP_SSID:
            continue
        seen.add(ssid)
        try:
            signal_val = int(parts[1])
        except ValueError:
            signal_val = 0
        security = parts[2] if len(parts) > 2 else ""
        nets.append({
            "ssid": ssid,
            "signal": signal_val,
            "secured": bool(security and security != "--"),
        })
    nets.sort(key=lambda n: -n["signal"])
    return nets

def bring_up_ap():
    """Create/activate the open setup AP."""
    # Remove any stale version first
    run("nmcli", "connection", "delete", AP_CONN_NAME)
    code, _, err = run(
        "nmcli", "connection", "add",
        "type", "wifi",
        "ifname", AP_IFACE,
        "con-name", AP_CONN_NAME,
        "autoconnect", "no",
        "ssid", AP_SSID,
        "mode", "ap",
        "ipv4.method", "shared",
        "ipv4.addresses", f"{AP_IP}/24",
        "wifi-sec.key-mgmt", "none",
    )
    if code != 0:
        print(f"[AP] add failed: {err}", flush=True)
        return False
    code, _, err = run("nmcli", "connection", "up", AP_CONN_NAME)
    if code != 0:
        print(f"[AP] up failed: {err}", flush=True)
        return False
    print(f"[AP] {AP_SSID} up at {AP_IP}", flush=True)
    return True

def tear_down_ap():
    run("nmcli", "connection", "down", AP_CONN_NAME)
    run("nmcli", "connection", "delete", AP_CONN_NAME)

def connect_wifi(ssid, password):
    """Add + activate a real WiFi connection. Returns (ok, error_text)."""
    # Rescan on wlan0 before connect attempt
    run("nmcli", "device", "wifi", "rescan")
    time.sleep(2)
    args = ["nmcli", "device", "wifi", "connect", ssid]
    if password:
        args += ["password", password]
    code, out, err = run(*args, timeout=45)
    if code == 0:
        return True, ""
    return False, (err or out).strip() or "unknown error"

def save_coach_code(code_str):
    CONFIG_PATH.write_text(json.dumps({"coach_code": code_str}) + "\n")
    try:
        os.chown(str(CONFIG_PATH), 1000, 1000)  # pi:pi
    except PermissionError:
        pass
    os.chmod(str(CONFIG_PATH), 0o644)

# ────────────────────────────────────────────────────────────────
# HTTP handler
# ────────────────────────────────────────────────────────────────
class PortalHandler(http.server.BaseHTTPRequestHandler):
    server_version = "BSA-Setup/1.0"

    def log_message(self, fmt, *args):
        # Log to stdout so systemd journal captures it
        print(f"[HTTP] {self.address_string()} {fmt % args}", flush=True)

    def _send(self, code, body, ctype="application/json"):
        body_bytes = body if isinstance(body, bytes) else body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body_bytes)))
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        self.send_header("Connection", "close")
        self.end_headers()
        self.wfile.write(body_bytes)

    def _redirect(self, target="/"):
        self.send_response(302)
        self.send_header("Location", target)
        self.send_header("Content-Length", "0")
        self.send_header("Connection", "close")
        self.end_headers()

    def do_GET(self):
        path = urlparse(self.path).path

        if path in ("/", "/index.html"):
            try:
                self._send(200, UI_PATH.read_bytes(), "text/html; charset=utf-8")
            except FileNotFoundError:
                self._send(500, "UI file missing at " + str(UI_PATH), "text/plain")
            return

        if path == "/api/networks":
            self._send(200, json.dumps({"networks": scan_wifi()}))
            return

        # Any other path (captive portal probes, favicon, etc.) → redirect to /
        self._redirect("/")

    def do_POST(self):
        path = urlparse(self.path).path
        if path != "/api/connect":
            self._send(404, json.dumps({"error": "not found"}))
            return

        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length).decode("utf-8") if length else "{}"
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            self._send(400, json.dumps({"error": "bad JSON"}))
            return

        ssid = (data.get("ssid") or "").strip()
        password = data.get("password") or ""
        coach_code = (data.get("coachCode") or "").strip().upper()

        if not ssid:
            self._send(400, json.dumps({"error": "WiFi network required"})); return
        if not COACH_CODE_RE.match(coach_code):
            self._send(400, json.dumps({"error": "Coach code must be 4–20 letters/digits"})); return

        # Save coach code first (cheap; survives even if WiFi fails)
        save_coach_code(coach_code)

        # Tear down the AP so NM can focus on joining the real WiFi
        tear_down_ap()
        time.sleep(1)

        ok, err = connect_wifi(ssid, password)
        if not ok:
            # WiFi failed — bring the AP back up so user can retry
            bring_up_ap()
            self._send(400, json.dumps({"error": f"Couldn't join {ssid}: {err}"}))
            return

        # Success. Shut down the portal process — systemd won't restart (Restart=no)
        self._send(200, json.dumps({"ok": True, "message": "Connected — this kiosk will load your workout within 30 seconds."}))
        threading.Timer(1.5, lambda: os.kill(os.getpid(), signal.SIGTERM)).start()


class ThreadedServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    allow_reuse_address = True
    daemon_threads = True

# ────────────────────────────────────────────────────────────────
# Main
# ────────────────────────────────────────────────────────────────
def main():
    if not bring_up_ap():
        print("[FATAL] AP failed to come up", flush=True)
        return 1

    # Give hostapd/dnsmasq a moment to settle
    time.sleep(2)

    try:
        with ThreadedServer((AP_IP, 80), PortalHandler) as httpd:
            print(f"[HTTP] listening on http://{AP_IP}:80", flush=True)
            httpd.serve_forever()
    except OSError as e:
        print(f"[HTTP] bind failed: {e}", flush=True)
        return 1
    finally:
        # Always clean up the AP on exit
        tear_down_ap()

    return 0


if __name__ == "__main__":
    # Install a signal handler so SIGTERM from the success path exits cleanly
    def _stop(signum, frame):
        print(f"[SIG] got {signum}, shutting down", flush=True)
        raise SystemExit(0)
    signal.signal(signal.SIGTERM, _stop)
    signal.signal(signal.SIGINT, _stop)

    raise SystemExit(main())
