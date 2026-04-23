#!/bin/bash
# Install BSA kiosk agent + CEC listener on a Pi.
# Run as:  bash install.sh
# Assumes /home/pi/bsa-config already has COACH_CODE=... set by the
# captive-portal onboarding flow.
set -euo pipefail

SCRIPT_DIR="$( cd "$(dirname "${BASH_SOURCE[0]}")" && pwd )"

echo "[bsa] Installing cec-utils if needed…"
sudo apt update -y
sudo apt install -y cec-utils python3

echo "[bsa] Copying agent + cec listener into /usr/local/sbin/…"
sudo install -m 0755 "$SCRIPT_DIR/bsa-kiosk-agent.py"   /usr/local/sbin/bsa-kiosk-agent.py
sudo install -m 0755 "$SCRIPT_DIR/bsa-cec-listener.py"  /usr/local/sbin/bsa-cec-listener.py

echo "[bsa] Installing systemd units…"
sudo install -m 0644 "$SCRIPT_DIR/bsa-kiosk-agent.service"  /etc/systemd/system/bsa-kiosk-agent.service
sudo install -m 0644 "$SCRIPT_DIR/bsa-cec-listener.service" /etc/systemd/system/bsa-cec-listener.service

echo "[bsa] Ensuring pi user can shutdown/reboot without a password…"
echo 'pi ALL=(ALL) NOPASSWD: /sbin/shutdown, /sbin/reboot' | \
    sudo tee /etc/sudoers.d/bsa-kiosk-shutdown >/dev/null
sudo chmod 0440 /etc/sudoers.d/bsa-kiosk-shutdown

echo "[bsa] Enabling services…"
sudo systemctl daemon-reload
sudo systemctl enable --now bsa-kiosk-agent.service
sudo systemctl enable --now bsa-cec-listener.service

echo "[bsa] Done. Tail logs with:"
echo "    journalctl -u bsa-kiosk-agent  -f"
echo "    journalctl -u bsa-cec-listener -f"
