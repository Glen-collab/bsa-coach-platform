#!/usr/bin/env python3
"""
bsa-cec-listener.py — HDMI-CEC fallback for graceful Pi shutdown.

Listens for the TV's standby (power-off) signal over HDMI-CEC using
cec-client (from the `cec-utils` package). When the TV goes to standby,
runs `sudo shutdown -h now` so the Pi halts cleanly before the TV cuts
USB power a few seconds later.

This is belt-and-suspenders to the phone-initiated shutdown:
  - Primary: coach taps "Shutdown TV" in the dashboard → bsa-kiosk-agent
  - Fallback: coach forgets the button and just powers off the TV → CEC

Install:
    sudo apt install -y cec-utils
    sudo cp bsa-cec-listener.py /usr/local/sbin/bsa-cec-listener.py
    sudo chmod +x /usr/local/sbin/bsa-cec-listener.py
    sudo cp bsa-cec-listener.service /etc/systemd/system/
    sudo systemctl daemon-reload
    sudo systemctl enable --now bsa-cec-listener.service

Tuning:
    Set BSA_CEC_DEBOUNCE_SECONDS (default 3) if the TV sends spurious
    standby signals during channel changes / input switches. Longer
    debounce = fewer false shutdowns but a few extra seconds of power
    draw after the TV is actually off.

Logs:
    journalctl -u bsa-cec-listener -f
"""

import logging
import os
import subprocess
import sys
import time

DEBOUNCE = float(os.environ.get("BSA_CEC_DEBOUNCE_SECONDS", "3"))

logging.basicConfig(
    format="[%(asctime)s] %(levelname)s %(message)s",
    level=logging.INFO,
    stream=sys.stdout,
)
log = logging.getLogger("bsa-cec-listener")


def tv_is_off():
    """Ask the TV (logical address 0) its power status.
    Returns True if the TV reports 'on standby' or 'in transition'."""
    try:
        out = subprocess.run(
            ["cec-client", "-s", "-d", "1"],
            input="pow 0",
            capture_output=True,
            text=True,
            timeout=6,
        ).stdout.lower()
    except Exception as e:
        log.warning("cec-client pow 0 failed: %s", e)
        return False
    # Look for "power status: standby" or "to standby"
    for line in out.splitlines():
        if "power status" in line and ("standby" in line or "off" in line):
            return True
    return False


def listen():
    """Stream CEC traffic. Look for standby messages, then confirm with
    an explicit pow query before halting (avoids false positives from
    routing-change traffic)."""
    log.info("Starting CEC monitor (debounce=%ss)", DEBOUNCE)
    proc = subprocess.Popen(
        ["cec-client", "-m", "-d", "8"],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    assert proc.stdout is not None
    try:
        for raw in proc.stdout:
            line = raw.strip().lower()
            # We only care about messages *from* the TV (source 0) hinting at
            # power-down. cec-client prefixes lines with "TRAFFIC:".
            if "standby" in line or ">> 36" in line or ">> 0f:36" in line:
                # 0x36 is the CEC "Standby" opcode. 0f:36 is broadcast standby.
                log.info("CEC standby signal seen: %s", line)
                time.sleep(DEBOUNCE)
                if tv_is_off():
                    log.info("TV confirmed standby — shutting down Pi")
                    subprocess.Popen(["sudo", "shutdown", "-h", "+0"])
                    time.sleep(30)
                    return
                else:
                    log.info("TV still reports on — ignoring standby blip")
    finally:
        try:
            proc.terminate()
        except Exception:
            pass


def main():
    # Retry loop — if cec-client dies or the HDMI connection drops momentarily,
    # systemd will keep us alive but we also reconnect internally.
    while True:
        try:
            listen()
        except Exception as e:
            log.exception("listen() crashed: %s", e)
        log.info("Reconnecting to CEC in 5s")
        time.sleep(5)


if __name__ == "__main__":
    main()
