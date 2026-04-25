#!/bin/bash
# bsa-pi-install.sh — runs on the Pi after staging files into /tmp/bsa-stage.
# Idempotent: re-running on an existing Pi just re-applies state.
set -e
cd /tmp/bsa-stage

echo "[1/7] Filesystem layout"
mkdir -p /home/pi/.config/labwc
install -m 0755 labwc-autostart /home/pi/.config/labwc/autostart
chown -R pi:pi /home/pi/.config
install -m 0644 setup-instructions.html /home/pi/setup-instructions.html
chown pi:pi /home/pi/setup-instructions.html

echo "[2/7] Seed bsa-config with coach code"
# Universal SD: in production this file is written by the captive portal
# when a customer enters their coach code. Glen's gym Pi seeds it directly.
echo '{"coach_code":"GLENM7NUS"}' > /home/pi/bsa-config
chown pi:pi /home/pi/bsa-config
chmod 0644 /home/pi/bsa-config

echo "[3/7] Captive portal (used when no WiFi yet — harmless idle here)"
sudo install -m 0755 bsa-setup-portal.py     /usr/local/sbin/bsa-setup-portal.py
sudo install -m 0755 wifi-connect-wrapper.sh /usr/local/sbin/wifi-connect-wrapper.sh
sudo mkdir -p /usr/share/wifi-connect/ui
sudo install -m 0644 bsa-portal-index.html   /usr/share/wifi-connect/ui/index.html

echo "[4/7] Phone-shutdown agent + CEC listener"
sudo install -m 0755 bsa-kiosk-agent.py      /usr/local/sbin/bsa-kiosk-agent.py
sudo install -m 0755 bsa-cec-listener.py     /usr/local/sbin/bsa-cec-listener.py
sudo install -m 0644 bsa-kiosk-agent.service  /etc/systemd/system/
sudo install -m 0644 bsa-cec-listener.service /etc/systemd/system/

echo "[5/7] Passwordless shutdown for pi user"
sudo tee /etc/sudoers.d/bsa-kiosk-shutdown >/dev/null <<'SUDOERS'
pi ALL=(ALL) NOPASSWD: /sbin/shutdown, /sbin/reboot, /usr/sbin/shutdown, /usr/sbin/reboot
SUDOERS
sudo chmod 0440 /etc/sudoers.d/bsa-kiosk-shutdown

echo "[6/7] Autologin pi on tty1 + launch labwc on tty1 only"
sudo mkdir -p /etc/systemd/system/getty@tty1.service.d
sudo tee /etc/systemd/system/getty@tty1.service.d/autologin.conf >/dev/null <<'AUTOLOGIN'
[Service]
ExecStart=
ExecStart=-/sbin/agetty --autologin pi --noclear %I $TERM
AUTOLOGIN

# .bash_profile launches labwc only on tty1, only if not already in Wayland.
sudo -u pi tee /home/pi/.bash_profile >/dev/null <<'PROFILE'
if [ -z "$WAYLAND_DISPLAY" ] && [ "$(tty)" = "/dev/tty1" ]; then
  exec labwc -s /home/pi/.config/labwc/autostart
fi
PROFILE

echo "[7/7] Enable services"
sudo systemctl daemon-reload
sudo systemctl enable --now bsa-kiosk-agent.service
sudo systemctl enable --now bsa-cec-listener.service

echo "=== install complete ==="
systemctl is-active bsa-kiosk-agent bsa-cec-listener
echo "Reboot the Pi to land in kiosk mode: sudo reboot"
