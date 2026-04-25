# Pi Kiosk — Handoff (April 25, 2026)

State of the world after a long evening of provisioning a fresh gym Pi
and chasing memory pressure issues. Pick up here when the **Pi 4** arrives.

---

## What's working right now

- **Phone-shutdown round trip.** Coach dashboard at `app.bestrongagain.com`
  has a *Gym TV Power* card with **Shutdown TV** + **Reboot TV** buttons.
  Pi-side `bsa-kiosk-agent.service` polls `/api/kiosk/commands` every 10s
  and runs `sudo shutdown -h now` / `sudo reboot`. Confirmed end-to-end
  tonight: Glen tapped Shutdown, Pi halted within ~10 seconds.
- **Coach Dashboard link** lives on `/admin` (Glen kept missing
  `/coach`).
- **CEC listener** (`bsa-cec-listener.service`) is installed and watches
  for the TV's standby signal. Untested in production yet.
- **Provisioning script** at `scripts/pi-kiosk/bsa-pi-install.sh`. One
  bash command on a fresh-flashed Pi installs the whole kiosk stack
  (autologin → labwc → chromium → agent + CEC + sudoers + bsa-config).
- **`/tv/static`** + per-device IDs (localStorage UUID for non-Pi
  browsers) lets a single coach drive multiple TVs from the
  `/gym-tv` dashboard page.

## What's broken / hurting

- **The current gym Pi is a Pi Zero 2 W with 425MB usable RAM.**
  Chromium running our React bundle pushes it to the edge — clean
  exits / SIGKILLs every ~30s, blanking the screen between launches.
  Glen ordered a **Pi 4** to replace it. None of these symptoms will
  remain on a Pi 4.
- **Brand-flash takeover is disabled on `/tv/static`** (FLASH_ENABLED
  = false in TVStatic.jsx). Bring it back when the Pi 4 is up.
- **`brand_logo_data` is a 113KB blob** carried in every poll JSON.
  TVStatic now strips it from React state to save heap, but it's
  still on the wire. Real fix: serve logo at a separate cacheable
  URL and shrink the poll JSON. Follow-up.
- **The `/cast/poll` response also carries logo_data.** Same problem,
  same follow-up. Less acute because casting is a phone-driven flow
  and the TV is usually a real smart TV, not a Pi.
- **`raspi-config` Desktop edition** auto-enables `lightdm` which
  steals the HDMI from labwc. Tonight we masked it
  (`systemctl mask lightdm`). For future deploys, **flash Lite, not
  Desktop**, OR add `sudo systemctl mask lightdm` to `bsa-pi-install.sh`.

## File inventory

Inside this directory (`scripts/pi-kiosk/`):

| File | Purpose |
|---|---|
| `bsa-pi-install.sh` | Master post-flash installer. Run on a fresh Pi after staging files into `/tmp/bsa-stage/`. |
| `bsa-kiosk-agent.py` + `.service` | Polls backend for shutdown/reboot/reload commands. Reads coach code from `/home/pi/bsa-config` (JSON or KEY=VALUE). |
| `bsa-cec-listener.py` + `.service` | HDMI-CEC listener; halts Pi when TV powers off. Belt-and-suspenders for the phone-shutdown flow. |

Loose on Glen's Desktop (need to be repo-ified eventually):
- `pi_labwc_autostart` — labwc session autostart (Chromium respawn loop)
- `pi_setup_instructions.html` — the "Setting up your Gym TV" page
- `pi_bsa_setup_index.html` — captive-portal landing
- `pi_bsa_setup_portal.py` — captive-portal Flask server
- `pi_wifi_connect_wrapper.sh` — wifi-connect grace-period wrapper
- `pi_ssh.py` — paramiko helper used to drive the Pi from the workstation

## Git commits today

In `bsa-coach-platform`:
- Pi kiosk: agent reads JSON bsa-config + master install script
- Add Gym TV Power + Coach Dashboard link to AdminDashboard

In `workouttracker`:
- Cast: TDZ white-screen fix in CastTVDisplay
- TVStatic: stop re-allocating brand on every poll (Pi Zero 2 W memory)
- TV cursor + brand-flash cleanup
- TVStatic: disable brand flash + drop logo_data on Pi Zero 2 W
- Cast layout toggle, brand flash, Day+1 lookup, fetch allWorkouts
- Fix week-to-week carryover: match by exercise name, not index

## Pi 4 plan (when it arrives)

1. **Flash Raspberry Pi OS Bookworm Lite (32-bit)** with Pi Imager.
   Settings: hostname `bsa-tv`, user `pi`/`pi`, SSH on, WiFi to home/work.
   *Lite, not Desktop — avoids lightdm.*
2. Boot the Pi. SSH in via `bsa-tv.local`.
3. From the workstation, run the staging + install dance the same way
   we did tonight (see `bsa-pi-install.sh` and the SCP commands in
   tonight's session log). Or pull the repo on the Pi directly:
   ```bash
   sudo apt install -y git chromium-browser cec-utils labwc seatd python3 python3-flask network-manager curl
   git clone https://github.com/Glen-collab/bsa-coach-platform /tmp/bsa
   # copy Desktop files (autostart, setup-instructions html, portal py)
   # into /tmp/bsa/scripts/pi-kiosk/ first, then:
   bash /tmp/bsa/scripts/pi-kiosk/bsa-pi-install.sh
   ```
4. Reboot. Should land directly in the kiosk.
5. **Re-enable the brand flash on `/tv/static`** — flip `FLASH_ENABLED`
   back to `true` in `workouttracker/src/components/tv/TVStatic.jsx`.
6. Verify `Shutdown TV` from the coach dashboard halts the Pi.

## Productization to-do list (for paying customers)

- Move `brand_logo_data` to a cacheable URL endpoint, drop it from
  `/api/kiosk/tv-config` and `/api/cast/poll` JSON.
- Pre-flash a "golden" SD image with everything baked in. Customer
  flashes once, plugs in, scans QR, types coach code, walks away.
- Universal SD captive portal flow needs end-to-end testing
  (currently dormant on Glen's Pi because his WiFi was pre-configured).
- Decide on hardware spec to ship: Pi 4 4GB + FLIRC heatsink case
  + USB-C 3A PSU + branded SD = ~$80 BOM.
