# Gym TV Kiosk — Pi-Based Coach Display

The system that runs a coach's gym TV: a Raspberry Pi boots into Chromium kiosk pointing at the workout-tracker `/tv/static` page, displays today's workout in a TV-readable format, and is controlled remotely by the coach from their dashboard.

**Goal:** A coach plugs in the Pi, walks through a one-time setup on their phone, and the gym TV runs hands-off forever — the coach swaps the active program, reboots the TV, or shuts it down at night, all from `app.bestrongagain.com` without touching the Pi.

---

## Hardware

| Part | Notes |
|---|---|
| Raspberry Pi 4 (or Pi Zero 2 W) | Pi 4 strongly preferred — 4-core A72 + 2-8GB RAM handles the SPA + brand-flash without breaking a sweat. Pi Zero 2 W works but needs the brand-flash disabled and persistent logo dropped (see git history for the disable flags). Pi 4 has full USB-A ports — no adapter needed for a Flirc IR receiver. |
| 5V/3A USB-C power supply (Pi 4) or 5V/2.5A micro-USB (Zero 2 W) | Don't reuse a Pi Zero adapter for a Pi 4 — under-voltage browns out Chromium. |
| Micro-HDMI → HDMI cable (Pi 4) | Pi Zero 2 W uses mini-HDMI. Different connectors. |
| Flirc USB IR receiver (~$25, optional) | For day/week navigation via remote. Plugs into any USB-A port. |
| LG / TCL / generic HDMI TV | 1080p or 4K both work. On 4K, kiosk autostart forces `--force-device-scale-factor=2` so text is readable from couch distance. |

---

## Architecture

```
┌─────────────────────┐         ┌──────────────────────┐         ┌─────────────────┐
│  Coach's Phone /    │  HTTPS  │  app.bestrongagain   │  HTTPS  │  Pi at the gym  │
│  Coach Dashboard    │ ──────▶ │  Flask backend       │ ◀────── │  (polls every   │
│  (CoachDashboard,   │         │  /api/kiosk/*        │         │   10s for cmds) │
│   AdminDashboard)   │         │  /api/media/*        │         │                 │
└─────────────────────┘         │  /api/workout/*      │         └────────┬────────┘
                                 └──────────┬───────────┘                  │
                                            │                              │ HTTPS
                                            │                              ▼
                                            ▼                  ┌──────────────────────┐
                                   ┌────────────────┐          │  bestrongagain.      │
                                   │  RDS Postgres  │          │  netlify.app/tv/     │
                                   │  kiosk_commands│          │  static?coach=...    │
                                   │  coach_devices │          │  (workouttracker)    │
                                   └────────────────┘          └──────────────────────┘
```

**Three data flows:**

1. **Coach picks today's program** → Coach Dashboard calls `/api/kiosk/active-program` → Pi's `/tv-config` poll picks up the new active code → Chromium switches to the new workout. (No reboot needed for program swap — done in-page via React state.)

2. **Coach reboots / shuts down / reloads TV** → button in `GymTvPowerCard.jsx` POSTs to `/api/kiosk/shutdown|pi-reboot|reload` → backend writes a row to `kiosk_commands` table → Pi's `bsa-kiosk-agent.py` polls `/api/kiosk/commands?coach_code=<code>` every 10s, picks up the command, executes via `sudo reboot` / `sudo shutdown` / `pkill chromium`. Commands expire after 5 minutes.

3. **Customer onboards a fresh Pi at their gym** → Pi boots, no known WiFi → wrapper waits 60s → launches `bsa-setup-portal.py` → opens AP `BSA-Kiosk-Setup` → customer's phone connects → form captures gym SSID + password + coach code → Pi connects to that WiFi, saves coach code to `/home/pi/bsa-config`, kicks Chromium → kiosk loads workout.

---

## Pi Software Stack

All paths absolute on the Pi. Source files live on Glen's Desktop and (where applicable) in repos.

| Path | Source | Purpose |
|---|---|---|
| `/home/pi/.config/labwc/autostart` | `Desktop/pi_labwc_autostart` | Bash script labwc sources at session start. Reads coach code from `/home/pi/bsa-config`, builds workout URL, runs Chromium kiosk in a respawn loop. Also forces `--force-device-scale-factor=2` for 4K TVs. **CRITICAL: labwc sources via dash, NOT bash. No bashisms (no `${var/pat/repl}`).** |
| `/home/pi/setup-instructions.html` | `Desktop/pi_setup_instructions.html` | Branded purple "Setting up your Gym TV" fallback page shown when Chromium can't reach the internet AND no coach code is set. |
| `/home/pi/bsa-config` | written by setup portal | `{"coach_code": "GLENM7NUS"}` — the shared secret between Pi and backend. Captive portal writes this. |
| `/usr/local/sbin/bsa-setup-portal.py` | `Desktop/pi_bsa_setup_portal.py` | Python stdlib captive portal. Brings up open AP `BSA-Kiosk-Setup` at 192.168.42.1, serves the setup form, calls `nmcli` to connect, kicks Chromium, exits 0 on success. |
| `/usr/share/bsa-setup/index.html` | `Desktop/pi_bsa_setup_index.html` | Branded setup form (WiFi dropdown + password + coach code). |
| `/usr/local/sbin/wifi-connect-wrapper.sh` | `Desktop/pi_wifi_connect_wrapper.sh` | 60s grace check — exits silently if WiFi reachable, launches portal otherwise. |
| `/etc/systemd/system/wifi-connect.service` | `Desktop/pi_wifi_connect_service` | systemd oneshot that runs the wrapper at boot. |
| `/usr/local/sbin/bsa-kiosk-agent.py` | `bsa-coach-platform/scripts/pi-kiosk/bsa-kiosk-agent.py` | Long-running polling agent. Reads coach code from bsa-config, polls `/api/kiosk/commands` every 10s, executes shutdown/reboot/reload. |
| `/etc/systemd/system/bsa-kiosk-agent.service` | `bsa-coach-platform/scripts/pi-kiosk/bsa-kiosk-agent.service` | systemd unit, runs as user `pi`, restart-on-failure. |
| `/etc/sudoers.d/010_pi-kiosk-agent` | inline | `pi ALL=(ALL) NOPASSWD: /sbin/reboot, /sbin/shutdown, /usr/sbin/shutdown, /usr/sbin/reboot, /usr/bin/pkill` — required because Imager-set custom passwords break the default Pi OS nopasswd sudoers entry, and the agent needs passwordless sudo to act on dashboard commands. |

---

## URL Flow + Branding

The kiosk URL the autostart builds:

```
https://bestrongagain.netlify.app/tv/static?coach=<COACH_CODE>&device=<PI_CPU_SERIAL>
```

- `coach=<CODE>` — the coach's referral code. Used to look up active program + branding via `/tv-config`.
- `device=<SERIAL>` — Pi's CPU serial (`awk '/^Serial/{print $3}' /proc/cpuinfo`). Used to register the Pi as a `coach_devices` row so each TV is independently named/configured from the Gym TV admin page.

**Branding** is fetched from `/api/kiosk/tv-config?coach=<CODE>&device=<SERIAL>` and includes:

- `gym_name` — string, shown in the header bar next to the program title
- `primary` / `accent` — hex colors, applied to day-header strips and brand gradient
- `logo_data` — base64 PNG/JPG, shown small in the persistent header AND large during the 15-min flash takeover
- Coaches set these from the Gym Branding button on their dashboard

**Brand-flash takeover:** every 15 min for 3 seconds, full-screen `logo + gym_name` on the brand gradient. Doubles as OLED burn-in protection. Knobs in `workouttracker/src/components/tv/TVStatic.jsx`:

```js
const FLASH_ENABLED = true;          // toggle the whole feature
const FLASH_DURATION_MS = 3_000;     // how long each flash lasts
const FLASH_INTERVAL_MS = 15 * 60 * 1000;  // gap between flashes
const FIRST_FLASH_DELAY_MS = 30_000; // delay before the first flash
```

---

## Coach Controls (the dashboard side)

`GymTvPowerCard.jsx` renders three buttons:

| Button | Endpoint | What the Pi does |
|---|---|---|
| **Reboot TV** | `POST /api/kiosk/pi-reboot` | `sudo reboot` (the agent picks it up within 10s, comes back up in ~75s) |
| **Shutdown TV** | `POST /api/kiosk/shutdown` | `sudo shutdown -h +0` — for end-of-night, before unplugging |
| **Reload Workout** | `POST /api/kiosk/reload` | `pkill -HUP chromium` — quick page refresh without full reboot |

All three queue commands in `kiosk_commands` table with a 5-minute TTL. If the Pi is offline when clicked, the command expires unused (so a Pi waking up hours later doesn't randomly halt).

---

## Customer Onboarding (Captive Portal)

For a fresh Pi being deployed at a new gym:

1. Coach plugs Pi into power + TV at the gym.
2. ~60 seconds after boot, the TV shows the purple "Setting up your Gym TV" page.
3. Coach pulls out their phone → WiFi settings → connects to **`BSA-Kiosk-Setup`** (open network, no password).
4. Setup form auto-pops on phone (or open `192.168.42.1` in Safari/Chrome).
5. Coach selects gym WiFi from the dropdown → enters password → enters their coach code (e.g. `GLENM7NUS`) → taps **Connect Gym TV**.
6. Pi connects to gym WiFi, saves coach code, kicks Chromium → TV switches to live workout in ~10 seconds.

Subsequent boots: gym WiFi is now saved in NetworkManager, Pi auto-connects within 5–10 seconds, no portal fires.

---

## Local Source Files (on Glen's Desktop)

These are the canonical sources for Pi-side scripts. Edit them, then redeploy via `pi_ssh.py`:

```
Desktop/
  pi_ssh.py                       # paramiko wrapper for SSH to the Pi
  pi_labwc_autostart              # Chromium kiosk respawn loop
  pi_setup_instructions.html      # offline branded fallback page
  pi_bsa_setup_portal.py          # captive portal Python (root)
  pi_bsa_setup_index.html         # captive portal form
  pi_wifi_connect_wrapper.sh      # 60s grace before portal
  pi_wifi_connect_service         # systemd unit text
```

Agent files live in this repo: `scripts/pi-kiosk/bsa-kiosk-agent.{py,service}`.

**Note:** `pi_ssh.py` has `HOST = "192.168.1.36"` hardcoded for Glen's home Pi 4. Override in calling code (`pi_ssh.HOST = '...'`) for other Pis.

---

## Common Ops

### Restart the kiosk (program swap, etc.)

From the Coach Dashboard: click **Reload Workout** (kicks Chromium, ~3s). For a clean restart use **Reboot TV** (~75s).

### Re-run the captive portal (gym WiFi changed)

```bash
ssh pi@bsa-tv.local
sudo nmcli connection delete <old_gym_ssid>
sudo rm /home/pi/bsa-config
sudo reboot
```

Pi boots, doesn't see the (deleted) old WiFi, portal fires after 60s, customer reconnects on their phone.

### Tail kiosk logs

```bash
ssh pi@<ip>
tail -f /tmp/kiosk-respawn.log              # Chromium launch / exit cycle
journalctl -u bsa-kiosk-agent -f            # dashboard-command poll
journalctl -u wifi-connect -f               # captive portal lifecycle
```

### Adjust 4K text size

Edit `--force-device-scale-factor=2` in `Desktop/pi_labwc_autostart` (around line 80). Push to `/home/pi/.config/labwc/autostart` via SFTP, reboot Pi.

---

## Setup Checklist for a New Pi

1. Flash SD with Raspberry Pi OS Trixie 64-bit via Imager. Use OS Customization to set hostname `bsa-tv`, user/password, WiFi (your home — for tonight's prep), enable SSH.
2. Boot Pi 4, find IP via router admin or `ssh pi@bsa-tv.local`.
3. Update `Desktop/pi_ssh.py` `HOST` to the new IP.
4. SSH in; verify Chromium + labwc + nmcli are present (full Pi OS, not Lite).
5. Push: `pi_labwc_autostart` → `/home/pi/.config/labwc/autostart` (chmod +x).
6. Push: `pi_setup_instructions.html` → `/home/pi/setup-instructions.html`.
7. Seed: `/home/pi/bsa-config` with `{"coach_code": "GLENM7NUS"}` (or strip this for a customer Pi so portal fires on first boot).
8. Sudo install: portal Python + wrapper + index.html + systemd unit (see `pi_ssh.py` deploy commands in chat history; targets in the table above).
9. Sudo install: kiosk agent + service + sudoers drop-in (from `scripts/pi-kiosk/`).
10. `systemctl daemon-reload && systemctl enable wifi-connect bsa-kiosk-agent`
11. Reboot. Within 10–15s, TV should show the workout for the configured coach.

---

## Known Issues + Fixes

| Symptom | Cause | Fix |
|---|---|---|
| TV stuck on purple "Setting up" page even with WiFi | labwc sourced autostart via dash, your `${VAR/pat/repl}` returned empty → fell through to setup URL | Use plain string concat in autostart, no bashisms |
| Workout text tiny on 4K TV | Pi 4 outputs native 4K, fonts render at half size | Add `--force-device-scale-factor=2` to Chromium args |
| "Reboot TV" button does nothing | Kiosk agent not installed, OR sudo password prompt blocking | Install agent + sudoers drop-in |
| Brand-flash never appears | Pi Zero 2 W disable flags still active, OR coach has no logo configured | Set `FLASH_ENABLED = true`, ensure `/api/kiosk/tv-config` returns `logo_data` |
| `BSA-Kiosk-Setup` AP doesn't appear on phone | Portal service crashed, OR Pi already auto-connected to known WiFi | Check `journalctl -u wifi-connect`. If known WiFi is the issue, `nmcli connection delete` it and reboot. |
| `BSA-Kiosk-Setup` AP appears but **prompts for a password** | Portal's `bring_up_ap()` used `nmcli device wifi hotspot` shortcut which always defaults to WPA2 + random PSK; the after-the-fact `connection modify ... key-mgmt none` doesn't fully clear all security fields on Trixie's NM | **Fix below** — replace bring_up_ap() with explicit `nmcli connection add` that never sets a password in the first place |
| New deploy not showing | Wrong git remote URL (case-sensitive — `WorkoutTracker` not `workouttracker`) so Netlify webhook didn't fire | `git remote set-url origin https://github.com/Glen-collab/WorkoutTracker.git` and re-push |

---

## Apr 27, 2026 — Captive Portal AP Came Up Password-Protected

**Symptom**: Glen took the Pi to the gym. AP `BSA-Kiosk-Setup` broadcast correctly, but iPhone WiFi prompted for a password instead of joining open. No way to recover the random password without SSH access (and the Pi is stranded — no internet).

**Root cause**: `bsa-setup-portal.py`'s `bring_up_ap()` uses the `nmcli device wifi hotspot` *shortcut*. That command **always creates a WPA2-PSK AP with a random password** and immediately activates it. The after-create `nmcli connection modify <name> 802-11-wireless-security.key-mgmt none` plus `-802-11-wireless-security.psk` calls don't fully clear all security fields on NetworkManager 1.46+ (Trixie's default), so the AP stays password-protected.

**Fix to apply tonight** — rewrite `bring_up_ap()` in `Desktop/pi_bsa_setup_portal.py` (and the deployed `/usr/local/sbin/bsa-setup-portal.py`) to use the explicit `nmcli connection add` pattern. Set the connection up as open from the start; no password phase.

```python
def bring_up_ap():
    log(f"bringing up AP {AP_SSID}")
    run(f"nmcli connection delete {AP_CON_NAME}")
    rc, _, err = run(
        f"nmcli connection add type wifi ifname {WIFI_IFACE} con-name {AP_CON_NAME} "
        f"autoconnect no ssid {shlex.quote(AP_SSID)} "
        f"802-11-wireless.mode ap 802-11-wireless.band bg "
        f"802-11-wireless-security.key-mgmt none "
        f"ipv4.method shared ipv4.addresses 192.168.42.1/24",
        timeout=20,
    )
    if rc != 0:
        log(f"AP create failed rc={rc}: {err}")
        return False
    rc, _, err = run(f"nmcli connection up {AP_CON_NAME}", timeout=20)
    if rc != 0:
        log(f"AP up failed rc={rc}: {err}")
        return False
    log(f"AP {AP_SSID} ready at 192.168.42.1 (open)")
    return True
```

**Then**: SCP the updated portal to the Pi, `sudo install -m 0755 -o root -g root /tmp/bsa-setup-portal.py /usr/local/sbin/bsa-setup-portal.py`, and reboot. Verify the AP comes up open by joining from a phone — no password prompt.

**Test plan before redeploying to gym**:
1. SSH into home Pi
2. Stop the kiosk: `sudo nmcli connection delete <home WiFi>` then `sudo rm /home/pi/bsa-config && sudo reboot`
3. Wait 90s — portal should fire
4. iPhone WiFi list → tap `BSA-Kiosk-Setup` → must connect WITHOUT a password prompt
5. Setup form should auto-pop or open via `192.168.42.1`
6. Fill in home WiFi + `GLENM7NUS` → submit
7. Pi should reconnect to home WiFi within 10s, kiosk loads

---

## Recovering a Stranded Pi (no internet, portal won't open)

If a Pi is stuck somewhere (gym, customer site) without the captive portal working — no SSH path, no way to add WiFi:

**Option A: Take it home / back to base.** Fix locally, redeploy. Slowest but safest.

**Option B: iPhone hotspot SSID-spoof trick.** Pi auto-connects to phone, you SSH from phone. ~10 minutes if you have the home WiFi password handy.

1. iPhone Settings → General → About → Name → set to **the exact SSID of any WiFi already saved on the Pi** (e.g. `SpectrumSetup-73`)
2. iPhone Personal Hotspot → Wi-Fi Password → set to that same network's password (the one stored in the Pi's NetworkManager keyfile)
3. Enable Personal Hotspot
4. Wait 60–90 seconds — Pi NetworkManager auto-connects to "home WiFi" (which is now your phone)
5. Install Termius (or any SSH app) on the iPhone
6. SSH `pi@172.20.10.2` (default iOS hotspot subnet IP for the first client) — password `pi`
7. Run `sudo nmcli device wifi connect "<gym SSID>" password "<gym password>"` — Pi joins the real gym WiFi
8. Kiosk loads, dashboard remote works, etc.
9. Disable hotspot, restore phone name

**Option C: Pull the SD card, mount on a Mac/Linux machine, edit the NetworkManager keyfile.** Add a new `.nmconnection` file at `/etc/NetworkManager/system-connections/` with the gym SSID + password, mode 0600 root:root, then put SD back. Windows can't write ext4 cleanly so this is Mac/Linux only.
