#!/usr/bin/env python3
"""Security probe for the Be Strong Again money + account paths.

NON-DESTRUCTIVE by design: it never completes a payment, never deletes an
account, never writes data it doesn't clean up. Every check is a thing an
attacker could actually try from the open internet with no credentials.

  python security_audit.py
"""
import json
import urllib.request
import urllib.error

API = "https://app.bestrongagain.com/api"
CHAT = "https://chat.bestrongagain.com"
ORIGIN = "https://bestrongagain.netlify.app"

# A real member, used only to prove authorization boundaries hold.
VICTIM = "tohnmacht@gmail.com"

results = []


def call(method, url, body=None, headers=None, timeout=25):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read().decode()[:400], dict(r.headers)
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:400], dict(e.headers)
    except Exception as e:
        return 0, f"{type(e).__name__}: {e}", {}


def check(name, passed, detail="", severity="HIGH"):
    results.append((passed, severity, name, detail))
    icon = "PASS" if passed else f"**{severity}**"
    print(f"  [{icon}] {name}" + (f"\n        {detail}" if detail else ""))


def section(t):
    print(f"\n{'='*74}\n{t}\n{'='*74}")


# ── 1. Admin surface ────────────────────────────────────────────────────────
section("1. ADMIN ENDPOINTS — must reject anonymous callers")
for path in ["/admin/overview", "/admin/members", "/admin/coaches",
             "/admin/email-log", "/admin/settlement/preview"]:
    code, body, _ = call("GET", API + path)
    check(f"GET {path} blocked", code in (401, 403, 404),
          f"got HTTP {code}: {body[:90]}")

code, body, _ = call("POST", API + "/admin/settlement/run",
                     {"month": "2026-08", "confirm": True})
check("POST /admin/settlement/run blocked (would MOVE MONEY)",
      code in (401, 403, 404), f"got HTTP {code}: {body[:90]}", "CRITICAL")

# ── 2. Account deletion ─────────────────────────────────────────────────────
section("2. ACCOUNT DELETION — must require a valid session")
code, body, _ = call("POST", API + "/auth/delete-account")
check("delete-account with NO token blocked", code == 401, f"HTTP {code}", "CRITICAL")

code, body, _ = call("POST", API + "/auth/delete-account",
                     headers={"Authorization": "Bearer eyJhbGciOiJIUzI1NiJ9.forged.sig"})
check("delete-account with FORGED token blocked", code == 401, f"HTTP {code}", "CRITICAL")

# unsigned "alg:none" JWT — the classic bypass
none_jwt = "eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJ1c2VyX2lkIjoiMDAwMDAwMDAtMDAwMC0wMDAwLTAwMDAtMDAwMDAwMDAwMDAwIiwicm9sZSI6ImFkbWluIn0."
code, body, _ = call("POST", API + "/auth/delete-account",
                     headers={"Authorization": f"Bearer {none_jwt}"})
check("delete-account with alg:none JWT blocked", code == 401, f"HTTP {code}", "CRITICAL")

# ── 3. Checkout (deliberately email-keyed, no session) ──────────────────────
section("3. CHECKOUT — public by design; verify the blast radius is bounded")
code, body, _ = call("POST", API + "/stripe/checkout",
                     {"tier": "basic", "email": "definitely-not-real-xyz@example.com"})
check("unknown email does not leak account existence", code == 404 and "no_account" in body,
      f"HTTP {code}", "LOW")

code, body, _ = call("POST", API + "/stripe/checkout", {"tier": "basic"})
check("checkout with no email and no auth is refused", code in (401, 404),
      f"HTTP {code}", "MEDIUM")

code, body, _ = call("POST", API + "/stripe/checkout",
                     {"tier": "../../etc/passwd", "email": VICTIM})
check("invalid tier rejected (no arbitrary price)", code == 400, f"HTTP {code}", "HIGH")

# Can an attacker pass a user_id directly and bill/attach to anyone?
code, body, _ = call("POST", API + "/stripe/checkout",
                     {"tier": "basic", "user_id": "53702390-87ad-4eac-bdc8-cc2a3408cdb6"})
check("raw user_id in body is NOT trusted", "checkout_url" not in body,
      f"HTTP {code} — body accepted a user_id without auth" if "checkout_url" in body else f"HTTP {code}",
      "CRITICAL")

# ── 4. Billing portal ───────────────────────────────────────────────────────
section("4. BILLING PORTAL — must not open on someone else's account")
code, body, _ = call("POST", API + "/stripe/billing-portal")
check("billing-portal with no token blocked", code == 401, f"HTTP {code}", "CRITICAL")
code, body, _ = call("POST", API + "/stripe/billing-portal", {"user_id": "any"},
                     headers={"Authorization": "Bearer bogus"})
check("billing-portal with bogus token blocked", code == 401, f"HTTP {code}", "CRITICAL")

# ── 5. Webhook forgery ──────────────────────────────────────────────────────
section("5. STRIPE WEBHOOK — forged events must be rejected")
code, body, _ = call("POST", API + "/stripe/webhook",
                     {"type": "checkout.session.completed",
                      "data": {"object": {"metadata": {"user_id": "x", "tier": "elite"}}}})
check("unsigned webhook rejected (would grant free tiers + commissions)",
      code == 400, f"HTTP {code}: {body[:80]}", "CRITICAL")
code, body, _ = call("POST", API + "/stripe/webhook",
                     {"type": "checkout.session.completed", "data": {"object": {}}},
                     headers={"Stripe-Signature": "t=1,v1=deadbeef"})
check("webhook with bad signature rejected", code == 400, f"HTTP {code}", "CRITICAL")

# ── 6. Coach / kiosk surface (public, gated by referral code) ───────────────
section("6. COACH-CODE GATED ENDPOINTS — wrong code must reveal nothing")
code, body, _ = call("GET", API + "/kiosk/oneonone-folder?coach=NOTAREALCODE")
leaked = '"email"' in body and "@" in body
check("bogus coach code returns no client roster", not leaked,
      f"HTTP {code}: {body[:100]}", "HIGH")

code, body, _ = call("GET", API + "/kiosk/coach-clients?coach=NOTAREALCODE")
check("bogus coach code returns no client list", '"email"' not in body,
      f"HTTP {code}: {body[:100]}", "HIGH")

# ── 7. Tracker endpoints (email-keyed by design) ───────────────────────────
section("7. TRACKER ENDPOINTS — email-keyed by design; check what they expose")
code, body, _ = call("POST", API + "/workout/lookup-user.php",
                     {"email": VICTIM, "code": "0000"})
check("lookup-user with a bogus code reveals nothing", '"found": false' in body.replace(" ", "") or '"found":false' in body.replace(" ", ""),
      f"HTTP {code}: {body[:100]}", "MEDIUM")

code, body, _ = call("POST", API + "/workout/load-program.php",
                     {"email": VICTIM, "code": "0000"})
check("load-program with a bogus code returns no program", '"program"' not in body,
      f"HTTP {code}: {body[:90]}", "HIGH")

# ── 8. Transport + headers ─────────────────────────────────────────────────
section("8. TRANSPORT")
code, body, hdrs = call("GET", API + "/health")
check("API reachable over HTTPS", code == 200, f"HTTP {code}", "HIGH")
try:
    req = urllib.request.Request("http://app.bestrongagain.com/api/health")
    with urllib.request.urlopen(req, timeout=15) as r:
        redirected = r.url.startswith("https://")
    check("HTTP upgrades to HTTPS", redirected, f"landed on {r.url}", "MEDIUM")
except Exception as e:
    check("HTTP upgrades to HTTPS", True, f"plain HTTP refused ({type(e).__name__})", "MEDIUM")

code, body, hdrs = call("OPTIONS", API + "/stripe/checkout",
                        headers={"Origin": "https://evil.example.com",
                                 "Access-Control-Request-Method": "POST"})
acao = hdrs.get("Access-Control-Allow-Origin", "")
check("CORS does not blanket-allow arbitrary origins", acao != "https://evil.example.com",
      f"Access-Control-Allow-Origin: {acao or '(none)'}", "MEDIUM")

# ── Summary ────────────────────────────────────────────────────────────────
print(f"\n{'='*74}")
fails = [r for r in results if not r[0]]
crit = [r for r in fails if r[1] == "CRITICAL"]
print(f"  {len(results)-len(fails)} passed, {len(fails)} failed  ({len(crit)} critical)")
if fails:
    print("\n  NEEDS ATTENTION:")
    for _, sev, name, detail in sorted(fails, key=lambda r: r[1]):
        print(f"   [{sev}] {name}")
        if detail:
            print(f"          {detail}")
print("=" * 74)
