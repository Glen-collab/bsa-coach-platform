"""
email_helper.py — Shared email sending for BSA Coach Platform
"""
import os
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

TRAINER_EMAIL = "wisco.barbell@gmail.com"
APP_URL = "https://app.bestrongagain.com"
TRACKER_URL = "https://bestrongagain.netlify.app"

# Starter program codes by fitness level
STARTER_CODES = {
    "bodyweight": "4982",
    "bands": "6073",
    "small_gym": "5975",
}


def send_email(to, subject, html_body, reply_to=None):
    """Send email via Gmail SMTP. Returns True on success."""
    try:
        gmail_user = os.environ.get("GMAIL_USER", TRAINER_EMAIL)
        gmail_pass = os.environ.get("GMAIL_APP_PASSWORD", "")
        if not gmail_pass:
            print("No GMAIL_APP_PASSWORD set — skipping email")
            return False

        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = f"Be Strong Again <{gmail_user}>"
        msg["To"] = to
        if reply_to:
            msg["Reply-To"] = reply_to
        msg.attach(MIMEText(html_body, "html"))

        with smtplib.SMTP_SSL("smtp.gmail.com", 465) as server:
            server.login(gmail_user, gmail_pass)
            server.sendmail(gmail_user, to, msg.as_string())
        return True
    except Exception as e:
        print(f"Email error: {e}")
        return False


def notify_admin_new_signup(first_name, last_name, email, referral_code, referred_by=None):
    """Email Glen when someone new registers."""
    referred_text = f"<p><strong>Referred by:</strong> {referred_by}</p>" if referred_by else "<p><strong>Referred by:</strong> Direct signup (no referral)</p>"
    send_email(
        TRAINER_EMAIL,
        f"New Signup: {first_name} {last_name}",
        f"""
        <h2>New User Registration</h2>
        <p><strong>Name:</strong> {first_name} {last_name}</p>
        <p><strong>Email:</strong> {email}</p>
        <p><strong>Referral Code:</strong> {referral_code}</p>
        {referred_text}
        <p><a href="{APP_URL}/dashboard">View in Admin Dashboard</a></p>
        <hr><p style="color:#888;font-size:12px;">Be Strong Again Coach Platform</p>
        """,
        reply_to=email
    )


def notify_admin_coach_application(first_name, last_name, email, experience, why_coach):
    """Email Glen when someone applies as coach."""
    send_email(
        TRAINER_EMAIL,
        f"Coach Application: {first_name} {last_name}",
        f"""
        <h2>New Coach Application</h2>
        <p><strong>Name:</strong> {first_name} {last_name}</p>
        <p><strong>Email:</strong> {email}</p>
        <h3>Experience</h3>
        <p>{experience}</p>
        <h3>Why They Want to Coach</h3>
        <p>{why_coach}</p>
        <p><a href="{APP_URL}/dashboard">Review in Admin Dashboard</a></p>
        <hr><p style="color:#888;font-size:12px;">Be Strong Again Coach Platform</p>
        """,
        reply_to=email
    )


def notify_coach_approved(email, first_name, referral_code):
    """Email the coach when they're approved."""
    send_email(
        email,
        "You're Approved as a Coach — Be Strong Again",
        f"""
        <h2>Welcome to the team, {first_name}!</h2>
        <p>Your coach application has been approved. You're now officially a Be Strong Again coach.</p>

        <h3>Your Referral Link</h3>
        <p style="background:#f8f9fa;padding:16px;border-radius:10px;font-size:16px;font-weight:700;word-break:break-all;">
            {APP_URL}/register/{referral_code}
        </p>
        <p>Share this link with prospects. When they sign up through your link, they're your client.</p>

        <h3>Next Steps</h3>
        <ol style="line-height:2;">
            <li><strong>Log in</strong> to <a href="{APP_URL}/login">your coach dashboard</a></li>
            <li><strong>Set up Stripe Connect</strong> — so you can receive payouts</li>
            <li><strong>Share your referral link</strong> — start bringing clients onto the platform</li>
            <li><strong>Build programs</strong> in the <a href="https://workoutbuild.netlify.app">Workout Builder</a></li>
        </ol>

        <h3>How You Get Paid</h3>
        <ul style="line-height:2;">
            <li>You keep <strong>80%</strong> of every client's subscription</li>
            <li>10% goes to the platform (app, videos, hosting, billing)</li>
            <li>10% goes to whoever recruited you</li>
            <li>Recruit other coaches? You earn <strong>10%</strong> of their client revenue</li>
        </ul>

        <p>Questions? Reply to this email — it goes straight to Glen.</p>
        <hr><p style="color:#888;font-size:12px;">Be Strong Again Coach Platform</p>
        """,
        reply_to=TRAINER_EMAIL
    )


def notify_coach_denied(email, first_name, notes=""):
    """Email the coach when their application is denied."""
    reason = f"<p><strong>Feedback:</strong> {notes}</p>" if notes else ""
    send_email(
        email,
        "Coach Application Update — Be Strong Again",
        f"""
        <h2>Hi {first_name},</h2>
        <p>Thank you for your interest in coaching on the Be Strong Again platform.
        After reviewing your application, we're not able to approve it at this time.</p>
        {reason}
        <p>This doesn't mean the door is closed. If your situation changes or you have
        additional experience to share, we'd love to hear from you again.</p>
        <p>In the meantime, you can still use the platform as a member and train with
        any of our programs.</p>
        <p>Best,<br>Glen Rogers<br>Be Strong Again</p>
        <hr><p style="color:#888;font-size:12px;">Be Strong Again Coach Platform</p>
        """,
        reply_to=TRAINER_EMAIL
    )


def send_welcome_email(email, first_name):
    """Send welcome email to new user with free bodyweight workout."""
    code = STARTER_CODES["bodyweight"]
    app_link = f"{TRACKER_URL}/?code={code}&email={email}"
    send_email(
        email,
        f"Welcome {first_name} — your free workout is ready",
        f"""
        <div style="font-family: -apple-system, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background: linear-gradient(135deg, #1a1a2e, #16213e); padding: 32px 24px; text-align: center; border-radius: 12px 12px 0 0;">
                <h1 style="color: #fff; margin: 0 0 8px; font-size: 24px;">Hey {first_name}!</h1>
                <p style="color: #9ca3af; margin: 0; font-size: 15px;">Your account is set up. Let's get you moving.</p>
            </div>
            <div style="background: #fff; padding: 28px 24px; border: 1px solid #e5e7eb; border-radius: 0 0 12px 12px;">
                <p style="font-size: 15px; color: #444; line-height: 1.7; margin-top: 0;">
                    I've got a <strong>free 2-week bodyweight workout</strong> ready for you.
                    No equipment needed, no gym required. Just you and your phone.
                </p>
                <p style="font-size: 15px; color: #444; line-height: 1.7;">
                    Two days a week. Controlled movements, full range of motion, and consistency.
                    Every exercise has a video showing you exactly how to do it.
                </p>
                <div style="background: #f8f9fa; border-radius: 12px; padding: 20px; text-align: center; margin: 24px 0;">
                    <div style="font-size: 12px; font-weight: 600; color: #888; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 6px;">Your Access Code</div>
                    <div style="font-size: 32px; font-weight: 800; color: #B37602; letter-spacing: 4px; margin-bottom: 12px;">{code}</div>
                    <a href="{app_link}" style="display: inline-block; padding: 14px 32px; background: linear-gradient(135deg, #B37602, #8a5b00); color: #fff; text-decoration: none; border-radius: 10px; font-weight: 700; font-size: 16px;">Open Workout App</a>
                </div>
                <p style="font-size: 14px; color: #666; line-height: 1.6;">
                    Tap the button above — your code and email are already filled in.
                    Just enter your name and you're training.
                </p>
                <p style="font-size: 14px; color: #666; line-height: 1.6;">
                    Want something more personalized? A program built for your goals,
                    your equipment, your schedule? That's what coaching is for. But
                    start here first. See how you feel.
                </p>
                <p style="font-size: 15px; color: #444; margin-bottom: 0;">
                    — Glen<br>
                    <span style="font-size: 13px; color: #888;">Be Strong Again</span>
                </p>
            </div>
            <p style="text-align: center; color: #999; font-size: 12px; margin-top: 16px;">
                Reply to this email anytime — it comes straight to me.
            </p>
        </div>
        """,
        reply_to=TRAINER_EMAIL
    )


def send_subscription_email(email, first_name, tier, access_code=None):
    """Send email when user subscribes to a tier with their program code."""
    tier_names = {"basic": "Basic", "coached": "Coached", "elite": "Elite"}
    tier_name = tier_names.get(tier, tier.title())

    # Use starter code based on tier if no specific code provided
    if not access_code:
        if tier == "basic":
            access_code = STARTER_CODES["bodyweight"]
        elif tier == "coached":
            access_code = STARTER_CODES["bands"]
        elif tier == "elite":
            access_code = STARTER_CODES["small_gym"]
        else:
            access_code = STARTER_CODES["bodyweight"]

    app_link = f"{TRACKER_URL}/?code={access_code}&email={email}"

    tier_details = {
        "basic": "You've got access to workout programs and our library of 950+ exercise videos. Your coach will check in with you every couple weeks to make sure you're on track.",
        "coached": "You've got a dedicated coach who will build custom programs for your goals, check in with you 1-2 times per week, review your form on video, and adjust your programming as you progress. This is real coaching.",
        "elite": "You've got the full experience — 1-on-1 programming, unlimited video reviews, 2-3 check-ins per week, nutrition guidance, and priority attention. Your coach is fully dialed in to your goals.",
    }
    detail = tier_details.get(tier, tier_details["basic"])

    send_email(
        email,
        f"You're in, {first_name} — {tier_name} plan activated",
        f"""
        <div style="font-family: -apple-system, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background: linear-gradient(135deg, #1a1a2e, #16213e); padding: 32px 24px; text-align: center; border-radius: 12px 12px 0 0;">
                <h1 style="color: #B37602; margin: 0 0 8px; font-size: 24px;">{tier_name} Plan — Active</h1>
                <p style="color: #9ca3af; margin: 0; font-size: 15px;">Welcome to Be Strong Again, {first_name}.</p>
            </div>
            <div style="background: #fff; padding: 28px 24px; border: 1px solid #e5e7eb; border-radius: 0 0 12px 12px;">
                <p style="font-size: 15px; color: #444; line-height: 1.7; margin-top: 0;">
                    {detail}
                </p>

                <div style="background: #f8f9fa; border-radius: 12px; padding: 20px; text-align: center; margin: 24px 0;">
                    <div style="font-size: 12px; font-weight: 600; color: #888; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 6px;">Your Access Code</div>
                    <div style="font-size: 32px; font-weight: 800; color: #B37602; letter-spacing: 4px; margin-bottom: 12px;">{access_code}</div>
                    <a href="{app_link}" style="display: inline-block; padding: 14px 32px; background: linear-gradient(135deg, #B37602, #8a5b00); color: #fff; text-decoration: none; border-radius: 10px; font-weight: 700; font-size: 16px;">Open Workout App</a>
                </div>

                <p style="font-size: 14px; color: #666; line-height: 1.6;">
                    Tap the button — your code and email are already filled in. Enter your name and start training.
                    Every exercise has a coaching video showing you proper form.
                </p>

                <h3 style="font-size: 15px; color: #1a1a2e; margin-bottom: 8px;">What happens next:</h3>
                <ol style="font-size: 14px; color: #555; line-height: 2; padding-left: 20px;">
                    <li>Open the app and load your starter program</li>
                    <li>Complete the workouts — track your weights and reps as you go</li>
                    <li>Your coach will review your progress and build your next program</li>
                </ol>

                <p style="font-size: 15px; color: #444; margin-bottom: 0;">
                    — Glen<br>
                    <span style="font-size: 13px; color: #888;">Be Strong Again</span>
                </p>
            </div>
            <p style="text-align: center; color: #999; font-size: 12px; margin-top: 16px;">
                Reply to this email anytime — it comes straight to your coach.
            </p>
        </div>
        """,
        reply_to=TRAINER_EMAIL
    )


def notify_new_subscription(coach_email, coach_name, client_name, client_email, tier):
    """Email the coach when a client subscribes under them."""
    send_email(
        coach_email,
        f"New Client: {client_name} — {tier.title()} tier",
        f"""
        <h2>You have a new client!</h2>
        <p><strong>Client:</strong> {client_name} ({client_email})</p>
        <p><strong>Tier:</strong> {tier.title()}</p>
        <p>Log in to your <a href="{APP_URL}/dashboard">coach dashboard</a> to see their details.</p>
        <h3>What to do next:</h3>
        <ul style="line-height:2;">
            <li><strong>Basic ($20):</strong> Build them a program and send their access code. Check in every couple weeks.</li>
            <li><strong>Coached ($200):</strong> Custom program, check in 1-2x per week, video form reviews.</li>
            <li><strong>Elite ($400):</strong> Full 1-on-1 attention, 2-3x per week messaging, proactive adjustments.</li>
        </ul>
        <p>Build their program: <a href="https://workoutbuild.netlify.app">Workout Builder</a></p>
        <hr><p style="color:#888;font-size:12px;">Be Strong Again Coach Platform</p>
        """,
        reply_to=client_email
    )
