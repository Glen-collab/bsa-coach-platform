# BSA Services — canonical map

Every service running on EC2 `3.19.135.182` (us-east-2), every subdomain
that points at it, every repo it ships from, and the deploy command for
each. **One source of truth** so future-you isn't rediscovering this on
a 3 AM page.

Last verified: **2026-05-10**.

---

## Servers / hosts

| Host | What | Cost |
|---|---|---|
| `3.19.135.182` (Amazon Linux EC2) | All BSA backends + 3 frontends | t-class instance, single box |
| RDS `bestrongagain.cdqaq4sg2r1g.us-east-2.rds.amazonaws.com` | Postgres for `bestrongagain` DB (BSA platform) | Same VPC as EC2 |
| Netlify CDN | WorkoutTracker static site (auto-deploy on git push) | Free tier |
| `192.168.1.36` (home) / Tailscale `bsa-tv-bsa-tv` | Pi 4 kiosk on the gym TV | Hardware Glen owns |

---

## Backends (systemd services on EC2 — all behind nginx)

| Service unit | Path | Stack | Port | Repo | Public URL prefix |
|---|---|---|---|---|---|
| `bestrongagain.service` | `/opt/bestrongagain/` | Flask + gunicorn (2 workers) + Postgres (RDS) | `127.0.0.1:5000` | [bsa-coach-platform](https://github.com/Glen-collab/bsa-coach-platform) | `app.bestrongagain.com/api/*` |
| `bsa-chatbot.service` | `/opt/bsa-chatbot/` | Flask + gunicorn + Anthropic API (Sonnet 4.5 + Haiku 4.5) | `127.0.0.1:5050` | (Glen-collab/bsa-chatbot — TBD) | `chat.bestrongagain.com/api/*` |
| `calendar-api.service` | `/opt/calendar-api/server/` | Node + Express | `*:5051` | (calendar repo) | `calendar.bestrongagain.com/api/*` |
| `leaderboard-api.service` | `/opt/leaderboard-api/server/` | Node + Express + SQLite | `*:5052` | [Glen-collab/leaderboard](https://github.com/Glen-collab/leaderboard) | `leaderboard.bestrongagain.com/api/*` |
| `polly-connect.service` | `/opt/polly-connect/server/` | Python 3.11 (FastAPI?) | `0.0.0.0:8000` | [Glen-collab/polly-connect](https://github.com/Glen-collab/polly-connect) | (separate Polly product, not BSA) |
| `bsa-ws-relay.service` | `/opt/bsa-ws-relay/` | Python (websockets) | `127.0.0.1:8765` | (in bsa-coach-platform or standalone) | `wss://app.bestrongagain.com/ws/*` (TV pair-room + cast) |

**Service control** (any of them):

```bash
sudo systemctl status   <name>.service
sudo systemctl restart  <name>.service
sudo journalctl -u <name>.service -n 100
```

---

## Frontends

| Domain | Where it lives | Repo | Deploy command |
|---|---|---|---|
| `app.bestrongagain.com` | EC2 `/var/www/bestrongagain/` (nginx static) | [bsa-coach-platform](https://github.com/Glen-collab/bsa-coach-platform) | `npm run build && scp -r dist/* ec2:/tmp/dist-new/ && sudo cp -r /tmp/dist-new/* /var/www/bestrongagain/` |
| `bestrongagain.netlify.app` | Netlify (auto-deploys on push to `main`) | [Glen-collab/WorkoutTracker](https://github.com/Glen-collab/WorkoutTracker) | `git push origin main` (Netlify takes it from there) |
| `leaderboard.bestrongagain.com` | EC2 `/var/www/leaderboard/` | [Glen-collab/leaderboard](https://github.com/Glen-collab/leaderboard) | `npm run build && scp -r dist/* ec2:/tmp/lb-dist/ && sudo cp -r /tmp/lb-dist/* /var/www/leaderboard/` |
| `calendar.bestrongagain.com` | EC2 `/var/www/calendar/` | (calendar repo) | similar scp pattern |
| `chat.bestrongagain.com` | EC2 (chatbot frontend — same repo as backend) | (chatbot repo) | similar |

WorkoutTracker is the only frontend NOT on EC2. Netlify gives it a CDN
edge cache + auto-deploy-on-push. Don't move it onto EC2 unless Netlify
becomes a real problem.

---

## Subdomain → service routing (nginx on EC2)

Configs live at `/etc/nginx/conf.d/`:

```
bestrongagain.conf                  → app.bestrongagain.com (api → :5000, /ws/ → :8765, static → /var/www/bestrongagain/)
calendar.bestrongagain.com.conf     → calendar.bestrongagain.com (api → :5051, static → /var/www/calendar/)
chat.bestrongagain.com.conf         → chat.bestrongagain.com (api → :5050, static → /var/www/bestrongagain/ or chat dist)
leaderboard.bestrongagain.com.conf  → leaderboard.bestrongagain.com (api → :5052, static → /var/www/leaderboard/)
polly-connect.conf                  → polly-connect endpoints
```

After editing nginx config: `sudo nginx -t && sudo systemctl reload nginx`.

---

## Database

| DB | What | Where | Connection string |
|---|---|---|---|
| Postgres `bestrongagain` | BSA platform: users, programs, devices, logs, kiosk state, etc. | RDS in same VPC | In `/opt/bestrongagain/.env` as `DATABASE_URL` |
| SQLite `leaderboard.db` | Youth leaderboard: athletes, metrics, results, notes, waivers | `/opt/leaderboard-api/server/leaderboard.db` | File-based, no string |

Postgres migrations live in [bsa-coach-platform/migrations/](../migrations/) and are applied via:

```bash
scp migrations/0XX_name.sql ec2-user@3.19.135.182:~/
ssh ec2-user@3.19.135.182 "PGPASSWORD='...' psql -h <rds-host> -U bsa_admin -d bestrongagain -f ~/0XX_name.sql"
```

SQLite "migrations" for leaderboard happen as `db.exec()` on boot (see
`leaderboard/server/db.js`).

---

## Auth models (intentionally not unified — each app's right shape)

| App | Mechanism | Tokens |
|---|---|---|
| BSA platform | JWT in `Authorization: Bearer` header | Issued by `auth.py login()`, 24-hour expiry |
| WorkoutTracker | Email + access_code (no JWT — programs are semi-public) | Saved in localStorage on each device |
| Leaderboard | Shared username/password (`Barbell` + 2026 viewer / maxes coach / parent magic-link) | HTTP-only cookie set by `auth.js`, 365-day expiry |
| BSA chatbot | Anthropic API key (server-side) + member email passed from BSA app | No client token |
| Polly | Magic-link via email | HTTP-only cookie |

Cross-app reads now work via CORS (allow-list of subdomains, see
`leaderboard/server/index.js` and similar).

---

## Pis (Glen's gym hardware)

| Hardware | Purpose | Repo | Network reach |
|---|---|---|---|
| Pi 4 (gym TV kiosk) | Loads `bestrongagain.netlify.app/tv/static` to display the workout | [Glen-collab/bsa-tv-kiosk](https://github.com/Glen-collab/bsa-tv-kiosk) | `192.168.1.36` at home, dynamic at gym, Tailscale `bsa-tv-bsa-tv` (`100.107.197.36`) anywhere |
| Future: Pi 4 retro kiosk | NES/SNES on a second TV | (planned in `bsa-tv-kiosk/docs/RETRO_GAMES_PLAN.md`) | TBD |

**Pi update flow** (bsa-tv-kiosk has install.sh that's idempotent):

```bash
ssh pi@bsa-tv-bsa-tv  # via Tailscale, works from anywhere
cd ~/bsa-tv-kiosk && git pull && sudo bash install.sh
sudo pkill chromium  # kiosk respawn loop relaunches with fresh JS
```

---

## Where to find secrets

- `/opt/bestrongagain/.env` — DATABASE_URL, SECRET_KEY, STRIPE_*, GMAIL_APP_PASSWORD, ANTHROPIC_API_KEY (reused for chatbot)
- `/opt/bsa-chatbot/.env` — ANTHROPIC_API_KEY
- `/opt/leaderboard-api/server/.env` — JWT_SECRET, DB_PATH override
- `/opt/calendar-api/server/.env` — same shape
- AWS credentials: `~/.aws/credentials` on Glen's laptop (or in `Desktop/AWS.txt` 😬 — rotate someday)
- Tailscale auth: per-device, no shared secret

⚠️ Glen's `Desktop/AWS.txt` has the AWS access key in plaintext. Rotate
when you have time and store via 1Password instead.

---

## Adding a new service — checklist

1. Pick a port that's not in use (5053+ is open)
2. `/opt/<name>/` working directory with venv + code
3. systemd unit at `/etc/systemd/system/<name>.service` — model on existing one
4. nginx conf at `/etc/nginx/conf.d/<subdomain>.conf` — model on existing one
5. Cert via `sudo certbot --nginx -d <subdomain>` (free Let's Encrypt, auto-renew set up)
6. `sudo systemctl daemon-reload && sudo systemctl enable --now <name>` + `sudo nginx -t && sudo systemctl reload nginx`
7. Add a row to this doc
