"""
Regenerate boxing_kickboxing_forms.pdf — full BSA curriculum.

Each belt has:
  - Form combos (I-pattern progression)
  - Sparring combos (3 live-sparring drills)
  - Defensive combos (3 reads, slips, catches)
  - Break / Challenge (Van Damme-flavored test)

Run: python scripts/build_forms_pdf.py → docs/boxing_kickboxing_forms.pdf
"""

from reportlab.lib.pagesizes import LETTER
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.lib import colors
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, PageBreak, Table, TableStyle, KeepTogether,
)
from reportlab.lib.enums import TA_CENTER
from pathlib import Path

OUT = Path(__file__).parent.parent / "docs" / "boxing_kickboxing_forms.pdf"

# ── BOXING BELTS (Ancient Greek) ─────────────────────────────────────
# Each: (belt, name, script, meaning, theme, forms, sparring, defense, challenge)
BOXING_BELTS = [
    ("White", "Arche", "Ἀρχή", "Beginning, first principle", "Line Basics",
     [  # Forms
        "Jab", "Cross", "Turn 180 → Jab-Cross",
        "Step left → Jab-Cross", "Pivot right → Cross-Jab", "Step back → Jab-Cross",
     ],
     [  # Sparring combos
        "Single jab to touch — measure distance and return",
        "Jab-Cross — straight down the pipe",
        "Jab-Cross-step back — hit and leave",
     ],
     [  # Defensive combos
        "Step back + parry jab with rear hand",
        "Catch the cross with lead palm, return jab",
        "Bend knees → slip right under jab",
     ],
     "Snap 10 jabs through a sheet of paper held mid-air. Paper must tear, not bend."
     ),
    ("High White", "Askesis", "Ἄσκησις", "Disciplined training — Glen's tattoo", "Distance Control",
     [
        "Jab-Jab-Cross", "Cross-Hook-Cross",
        "Turn 180 → Jab-Cross-Hook", "Step left → Jab-Cross-Cross", "Pivot right → Jab-Hook-Cross",
     ],
     [
        "Double-jab to close distance, land the cross",
        "Jab-Cross-pivot out of range",
        "Jab → measure → step-in cross",
     ],
     [
        "Slip-slip-jab (slip two jabs, counter)",
        "Pull back from cross → lead-hand counter",
        "Frame-step (push off shoulder) to reset distance",
     ],
     "60-second fighting-stance plank while alternating jab-cross on a heavy bag — form must not break."
     ),
    ("Yellow", "Pygme", "Πυγμή", "The fist — root of pygmachia (boxing)", "Angle Entry",
     [
        "Jab-Cross-Hook", "Jab → Pivot → Cross-Hook",
        "Turn 180 → Jab-Cross-Uppercut", "Step left → Hook-Cross-Jab", "Pivot right → Cross-Hook-Cross",
     ],
     [
        "Jab, step to the 45° left, cross-hook",
        "Feint jab → pivot right → cross",
        "Jab-Cross-lead-Hook to the body",
     ],
     [
        "Roll under hook, come up with a hook",
        "Shoulder-roll the cross (rear-shoulder pull)",
        "L-step to clear opponent's power hand, jab out",
     ],
     "Water gallon on a pedestal — single cross must burst it cleanly. No wind-up."
     ),
    ("High Yellow", "Palaistra", "Παλαίστρα", "The training ground", "Combo Flow",
     [
        "Double-Jab-Cross-Hook", "Jab-Cross-Hook-Cross",
        "Turn 180 → Jab-Hook-Uppercut-Cross", "Step left → Jab-Cross-Hook-Uppercut",
     ],
     [
        "Jab-Cross-Hook-Cross (1-2-3-2) at pace",
        "Jab-Hook (head) — Hook (body) — Cross",
        "Double-Jab to set rhythm → power Cross",
     ],
     [
        "Parry-parry-jab against a jab-cross feed",
        "Slip-slip-cross (double slip then counter)",
        "Catch hook with high guard, pivot out",
     ],
     "Three water gallons in a 90° arc — break all three with one cross each under 3 seconds."
     ),
    ("Green", "Techne", "Τέχνη", "Craft, acquired skill", "Broken Rhythm",
     [
        "Jab ⏸ Cross-Hook", "Cross-Hook-Cross-Hook",
        "Turn 180 → Jab-Cross-Hook-Cross", "Pivot right → Jab-Hook-Cross-Jab",
     ],
     [
        "Jab, pause (read opponent), cross-hook on their blink",
        "Half-beat cross off the jab (rhythm trick)",
        "Jab-Cross-hesitate-Hook (sell the end of the combo)",
     ],
     [
        "Slip cross, catch hook, counter-cross",
        "Pull counter — lean back from hook, come over the top with cross",
        "Shell-up, walk them into a pivot-out",
     ],
     "Break a single 1-inch pine board with a cross — power + accuracy test."
     ),
    ("High Green", "Kairos", "Καιρός", "Perfect timing, the ripe moment", "Counter Timing",
     [
        "Slip → Jab-Cross-Hook", "Jab-Cross → Slip → Cross-Hook",
        "Turn 180 → Cross-Hook-Jab-Cross", "Pivot right → Hook-Cross-Uppercut-Cross",
     ],
     [
        "Slip opponent's jab → hit them with yours as they reset",
        "Cross-counter — right hand over the top of their jab",
        "Jab-into-pocket → lean-back cross",
     ],
     [
        "Catch-and-pitch (catch jab with rear hand, fire jab back)",
        "Double slip → hook counter",
        "Parry + pivot (redirect + angle change in one motion)",
     ],
     "Break 2 boards stacked — cross must pass through both in one punch."
     ),
    ("Blue", "Agon", "Ἀγών", "The contest — Glen's tattoo", "Pressure",
     [
        "Jab-Jab-Cross-Hook-Cross", "Cross-Hook-Cross-Jab-Hook",
        "Turn 180 → Jab-Cross-Hook-Uppercut-Cross",
     ],
     [
        "5-punch pressure chain — don't let them breathe",
        "Walk them into the ropes with jab-cross-jab-hook",
        "Double jab → cross-hook-cross body combo",
     ],
     [
        "Cover-and-pivot (high guard, step off line)",
        "Clinch-break → knee distance → cross (illegal in boxing but test the habit)",
        "Back-foot pivot + jab-out on aggressor",
     ],
     "Break 3 boards stacked — full-power cross. This is the 'you're a real puncher now' test."
     ),
    ("High Blue", "Sophrosyne", "Σωφροσύνη", "Self-discipline, sound mind", "Inside Fighting",
     [
        "Jab-Cross-Hook-Uppercut-Hook", "Hook-Cross-Hook-Cross-Jab",
        "Turn 180 → Cross-Hook-Uppercut-Hook-Cross",
     ],
     [
        "Uppercut-Hook-Cross from the pocket (inside range)",
        "Body-head shift: Hook body → Hook head → Cross",
        "Short cross + hook from forehead-range",
     ],
     [
        "Under-roll the hook, answer with uppercut",
        "Philly shell → lean away from cross → hook",
        "Inside parry + shoulder bump → reset space",
     ],
     "Break a thin (1.5-inch) ice slab with a cross — the Van Damme 'calm under pressure' test."
     ),
    ("Red", "Andreia", "Ἀνδρεία", "Courage under pressure", "Fight Simulation",
     [
        "Jab-Cross-Hook-Cross-Uppercut-Hook", "Pivot → Jab-Hook-Cross-Hook-Cross",
        "Turn 180 → Cross-Hook-Jab-Uppercut-Cross-Hook",
     ],
     [
        "6-punch finishing combo on hurt opponent",
        "Hook-off-the-jab (replace jab with hook mid-combo)",
        "Body-body-head: Cross body → Hook body → Hook head",
     ],
     [
        "Counter the aggressor's cross while moving backward",
        "Slip-pivot-hook counter",
        "Check-hook (pivot + hook as they step in)",
     ],
     "Break a 2-inch ice block. Andreia = courage to commit to full power."
     ),
    ("High Red", "Nike", "Νίκη", "Victory", "Control",
     [
        "Jab-Cross-Hook-Cross-Hook-Cross", "Turn 180 → Jab-Cross-Hook-Uppercut-Hook-Cross",
        "Step left → Cross-Hook-Jab-Cross-Hook",
     ],
     [
        "Dictate the range entire round — switch pressure/counter at will",
        "Jab-Cross → pivot → Cross from new angle",
        "Set up the knockout punch with 3 feints",
     ],
     [
        "Mirror opponent's footwork — never on the same timing",
        "Feint-draw-counter (fake a strike, draw theirs, counter)",
        "Controlled retreat: 4-step backward pivot while jabbing",
     ],
     "Stack 2 ice blocks — break both in a single cross. Victory = decisive power."
     ),
    ("Deputy", "Arete", "Ἀρετή", "Excellence — Glen's tattoo", "Power",
     [
        "7-8 punch chains with pivots and turns",
        "Free-form power progressions — instructor-led",
     ],
     [
        "8-punch continuous pressure chain",
        "Fighter-vs-fighter sparring — 3 full rounds",
        "Demonstrate all 4 punches at KO power on pads",
     ],
     [
        "Defensive rounds — absorb pressure, counter when you choose",
        "Demonstrate all 5 core defenses in one flowing drill",
        "5-minute no-hit round (dodge/block only)",
     ],
     "Break 3 stacked ice blocks + a water gallon in one flowing sequence. Excellence = power + precision + rhythm."
     ),
    ("Black", "Olympias", "Ὀλυμπίας", "The Olympic, the summit", "Master Flow",
     [
        "Free I-pattern chain — no repeats",
        "Must include: jab entry, hook rotation, uppercut inside, pivot exit",
     ],
     [
        "Open sparring — any combo, any range, any rhythm",
        "Teach a lower belt student one full combo + correct their form",
        "3 consecutive sparring rounds with black-belt-equivalent opponents",
     ],
     [
        "Free-form defensive rounds — no preset rules",
        "Demonstrate a counter for every punch in the system",
        "Give a live form critique of a lower belt — reading their movement",
     ],
     "Signature break — student chooses: wood stack, ice stack, water gallons, or combination. Must be announced and demonstrated as a flow."
     ),
]

# ── KICKBOXING / MUAY THAI BELTS (Thai) ──────────────────────────────
KICKBOXING_BELTS = [
    ("White", "Wai Khru", "ไหว้ครู", "Respect to teacher — the opening ritual", "Respect + Line Basics",
     [
        "Jab | Cross | Front Kick",
        "Turn 180 → Jab-Cross-Front Kick", "Step left → Round Kick", "Pivot right → Jab-Cross",
     ],
     [
        "Jab-Cross-Teep to measure distance",
        "Front Kick to push back, follow with Jab-Cross",
        "Round Kick to the body — single shot",
     ],
     [
        "Teep (push kick) to stop forward pressure",
        "Check (lift knee) against low round kick",
        "Block cross with cupped glove, counter jab",
     ],
     "60-second stance hold + 10 perfect teeps, each from full chamber. Balance test."
     ),
    ("High White", "Ram Muay", "ร่ายมวย", "The pre-fight dance showing learned form", "Form Shown",
     [
        "Jab-Cross-Round Kick", "Jab-Cross-Front Kick-Cross",
        "Turn 180 → Jab-Cross-Round Kick", "Step left → Hook-Cross-Front Kick",
     ],
     [
        "Jab-Cross-Round Kick (1-2-kick) at pace",
        "Teep-Jab-Cross combo (kick first, then hands)",
        "Feint low kick → Cross up top",
     ],
     [
        "Parry jab + teep counter to stomach",
        "Angle-off after opponent's round kick → Cross",
        "Catch round kick + sweep (beginner-safe)",
     ],
     "Demonstrate the Ram Muay ritual + 5 perfect round kicks on a pad at full power."
     ),
    ("Yellow", "Mae Mai", "แม่ไม้", "Mother techniques — 15 foundational movements", "Low Kick Intro",
     [
        "Jab-Cross-Hook-Low Kick", "Jab-Cross-Round Kick-Cross",
        "Turn 180 → Jab-Hook-Round Kick", "Pivot → Cross-Hook-Low Kick-Jab",
     ],
     [
        "Jab-Cross-Low Kick (leg destruction intro)",
        "Low Kick off-the-jab (switch-up)",
        "Cross-Hook-Low Kick body-head-leg combo",
     ],
     [
        "Check low kick + counter round kick",
        "Long guard — push the jab away with extended lead arm",
        "Sidestep the round kick + jab",
     ],
     "10 low kicks on a heavy bag in 30 seconds — bag must rock on every kick."
     ),
    ("High Yellow", "Look Mai", "ลูกไม้", "Child techniques — variations on Mae Mai", "Knee + Elbow Intro",
     [
        "Jab-Cross-Hook-Knee", "Cross-Hook-Round Kick-Knee",
        "Turn 180 → Jab-Cross-Elbow-Knee", "Step left → Hook-Cross-Round Kick",
     ],
     [
        "Clinch-Knee-Knee break (intro to clinch game)",
        "Jab-Cross-Elbow (hands to elbow transition)",
        "Round Kick → catch + knee combo",
     ],
     [
        "Frame against the plum (clinch defense basics)",
        "Elbow block against overhead strike",
        "Double-thai-pad defense against round kick",
     ],
     "Straight-knee break a coconut held by a partner (or substitute: 2 water jugs stacked)."
     ),
    ("Green", "Muay Lak", "มวยหลัก", "Stable boxing — grounded, disciplined style", "Grounded Technique",
     [
        "Jab-Cross-Low Kick-Cross", "Hook-Cross-Knee-Elbow",
        "Turn 180 → Cross-Hook-Knee-Round Kick",
     ],
     [
        "Heavy low-kick game — 5 low kicks per minute",
        "Cross-Hook-Knee (hands into clinch into knee)",
        "Teep + Cross (disruption + finish)",
     ],
     [
        "Pummel for underhook inside the clinch",
        "Push-off the collar tie with frame",
        "Catch-kick + Sweep (low-commitment takedown)",
     ],
     "Break a 1-inch pine board with a horizontal elbow. Elbow must be sharp, not swinging."
     ),
    ("High Green", "Muay Kiew", "มวยเกี้ยว", "Clever boxing — deception, timing, tactics", "Clinch Intro",
     [
        "Jab-Cross-Clinch-Knee-Knee", "Hook-Cross-Elbow-Knee-Kick",
        "Turn 180 → Jab-Cross-Hook-Knee-Elbow",
     ],
     [
        "Fake teep → Round Kick the other side",
        "Clinch entry + 3 curving knees + elbow exit",
        "Switch Kick (lead switch → rear-side round)",
     ],
     [
        "Neutralize plum with forearm in throat",
        "Redirect opponent's knee by rotating hips",
        "Snake arm through clinch to reverse positions",
     ],
     "Clinch-knee a water jug held at chest height by partner — jug must split on contact."
     ),
    ("Blue", "Hanuman", "หนุมาน", "Monkey god — acrobatic, fierce technique", "8-Limb Pressure",
     [
        "Jab-Cross-Teep-Switch Round Kick",
        "Cross-Hook-Low Kick-Cross-Round Kick",
        "Turn 180 → Jab-Cross-Elbow-Knee-Round Kick",
        "Step left → Teep-Cross-Hook-Switch Kick",
        "Pivot right → Cross-Hook-Knee-Elbow",
     ],
     [
        "5-strike 8-limb chain — no repeats",
        "Switch-kick counter-attack (lead leg becomes rear)",
        "Teep-feint → Spinning Back Kick",
     ],
     [
        "Double collar tie → spin opponent → exit combo",
        "Oblique kick defense — lift knee + push",
        "Roll with thrown round kick to avoid full force",
     ],
     "Flying knee onto a suspended foam target at head height. Hanuman = airborne ferocity."
     ),
    ("High Blue", "Erawan", "เอราวัณ", "Three-headed elephant — devastating power", "Clinch War",
     [
        "Jab-Cross-Clinch (plum) → Knee-Knee-Knee",
        "Jab-Cross → Collar tie → Curving Knee-Straight Knee-Elbow break",
        "Turn 180 → Teep → Clinch → Jumping Knee",
        "Step left → Hook-Cross → Plum → Knee-Knee-Horizontal Elbow exit",
        "Pivot right → Round Kick → Catch → Sweep → Cross",
     ],
     [
        "Clinch-battle rounds — 3 minutes pure clinch-and-knee",
        "Plum → 5-knee chain → Elbow finish",
        "Entry off jab: Jab-Cross-Plum-Knee-Knee",
     ],
     [
        "Break a plum with forehead + lift under armpit",
        "Pummel inside-outside rotation (hand fighting)",
        "Off-balance opponent with leg post + elbow",
     ],
     "Break 2 stacked pine boards with a horizontal elbow. Erawan = tusks of power."
     ),
    ("Red", "Nai Khanom Tom", "นายขนมต้ม", "Warrior spirit — the POW hero who beat 10 Burmese (1767)", "Muay Boran / Ong-Bak Flow",
     [
        "Jab-Cross-Hook → Kao Loi (flying knee)",
        "Teep-Switch Round Kick → Spinning Elbow",
        "Turn 180 → Cross-Hook → Hanuman Kulas (jumping axe elbow to head)",
        "Pivot → Low Kick-Low Kick-Body Kick-Head Round Kick",
        "Cross-Diagonal Elbow → Knee → Spinning Back Elbow exit",
     ],
     [
        "Kao Loi (flying knee) from pocket range",
        "Spinning Elbow off a caught kick",
        "Ong-Bak 4-level chain: leg → body → head → spinning",
     ],
     [
        "Catch kick → spin off into counter-kick",
        "Lean-back from high round kick → sweep standing leg",
        "Drop under spinning elbow → uppercut",
     ],
     "Round kick through a 2-inch ice slab. Shin conditioning + warrior commitment."
     ),
    ("High Red", "Muay Boran", "มวยโบราณ", "Ancient ring mastery — battlefield muay", "Ring Generalship",
     [
        "Teep (measure) → Jab-Cross-Low Kick → Cross-Head Kick",
        "Leg destruction: Low Kick × 3 → Cross-Hook-Head Kick",
        "Turn 180 → Teep (defensive) → Slip → Cross-Elbow-Knee",
        "Step left → Jab-Cross → Catch kick → Sweep → Cross",
        "Pivot right → Check kick → Round Kick-Round Kick-Cross-Elbow",
     ],
     [
        "Full-round dominance — dictate ALL ranges",
        "5-minute ring-general round — no combo repeated",
        "Answer every attack with a counter-attack (not a defense)",
     ],
     [
        "Defensive mastery round — 3 min, take no clean strikes",
        "Demonstrate every one of the 15 Mae Mai in sparring",
        "Chain 3 defenses into 1 counter-attack",
     ],
     "Kao Loi (flying knee) through 2 stacked ice blocks at chest height."
     ),
    ("Deputy", "Kru Muay", "ครูมวย", "The muay teacher", "Teacher's Mastery",
     [
        "Erawan Stabs Tusks: Jab-Cross-Hook-Spinning Back Elbow → Knee → Cross",
        "Hanuman Presents the Ring: Cross-Low Kick → Catch → Elbow → Knee → Sweep",
        "Monkey Guards the Stump: Check → Teep → Jumping Knee → Spinning Elbow",
        "Turn 180 → Teep-Cross-Hook-Low Kick-Switch Kick-Flying Knee",
        "Full chain: Jab-Cross-Hook-Elbow-Knee-Round Kick-Teep-Cross",
     ],
     [
        "Teach one named Muay Boran technique to a lower belt",
        "3 full sparring rounds against Kru Muay-equivalent opponents",
        "Demonstrate 3 ring strategies in 3 separate rounds",
     ],
     [
        "Give a live sparring critique in real time",
        "Demonstrate defense against all 8 weapons in one flow",
        "Catch-and-sweep a round kick, elbow, knee, and cross in one round",
     ],
     "Free-form break sequence on 4 targets — fist, elbow, knee, shin — each on a different medium (wood, ice, water jug, coconut)."
     ),
    ("Black", "Ajarn", "อาจารย์", "Master — grandmaster's free form", "Free 8-Limb Combat / Sak Yant Flow",
     [
        "Must use all 8 weapons (2 fists, 2 elbows, 2 knees, 2 shins)",
        "Must include one signature: flying knee, spinning elbow, or jumping axe elbow",
        "Must include a clinch entry + exit",
        "Must include a defensive recovery (check, teep, slip, or catch)",
        "Must return to guard on a pivot or angle step",
     ],
     [
        "Open 8-limb sparring — fully free-form",
        "Ong-Bak signature sequence demonstrated live on pads",
        "Teach + correct form for 3 different belt-level students",
     ],
     [
        "Defensive flow — no clean strikes taken in 3 rounds",
        "Counter every attack with a different response",
        "Demonstrate all 15 Mae Mai defenses + variations",
     ],
     "Ong-Bak-style master's challenge — student chooses the breaks + stations. Must flow 3 stations continuously, one strike per station, no resets."
     ),
]

# ── Colors ────────────────────────────────────────────────────────────
BELT_COLORS = {
    "White": colors.HexColor("#ffffff"), "High White": colors.HexColor("#f5f5f5"),
    "Yellow": colors.HexColor("#FFD700"), "High Yellow": colors.HexColor("#FFC107"),
    "Green": colors.HexColor("#4CAF50"), "High Green": colors.HexColor("#388E3C"),
    "Blue": colors.HexColor("#2196F3"), "High Blue": colors.HexColor("#1565C0"),
    "Red": colors.HexColor("#F44336"), "High Red": colors.HexColor("#C62828"),
    "Deputy": colors.HexColor("#333333"), "Black": colors.HexColor("#000000"),
}

styles = getSampleStyleSheet()
title_style = ParagraphStyle("TitleBig", parent=styles["Title"], fontSize=26, leading=30,
                             alignment=TA_CENTER, spaceAfter=6, textColor=colors.HexColor("#1a1a2e"))
subtitle_style = ParagraphStyle("Sub", parent=styles["Normal"], fontSize=12, alignment=TA_CENTER,
                                spaceAfter=18, textColor=colors.HexColor("#666666"))
section_title = ParagraphStyle("Sec", parent=styles["Heading1"], fontSize=20, leading=24,
                               spaceAfter=6, textColor=colors.HexColor("#B37602"))
intro_body = ParagraphStyle("Intro", parent=styles["Normal"], fontSize=11, leading=16, spaceAfter=10)
belt_heading = ParagraphStyle("BeltH", parent=styles["Heading2"], fontSize=14, leading=18,
                              spaceBefore=12, spaceAfter=2, textColor=colors.HexColor("#1a1a2e"))
belt_meaning = ParagraphStyle("BeltM", parent=styles["Normal"], fontSize=10, leading=13,
                              spaceAfter=6, textColor=colors.HexColor("#666666"))
sublabel = ParagraphStyle("Sublabel", parent=styles["Normal"], fontSize=10, leading=13, spaceBefore=4,
                          spaceAfter=2, textColor=colors.HexColor("#B37602"))
combo_style = ParagraphStyle("Combo", parent=styles["Normal"], fontSize=9.5, leading=12.5,
                             leftIndent=14, spaceAfter=1, textColor=colors.HexColor("#222222"))
challenge_style = ParagraphStyle("Chall", parent=styles["Normal"], fontSize=10, leading=13,
                                 leftIndent=14, spaceBefore=2, spaceAfter=6,
                                 textColor=colors.HexColor("#7c2d12"), italic=True)


def belt_swatch(color_name):
    bg = BELT_COLORS.get(color_name, colors.grey)
    border = colors.HexColor("#888888") if color_name in ("White", "High White") else bg
    t = Table([[""]], colWidths=[22], rowHeights=[14])
    t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), bg),
                           ("BOX", (0, 0), (-1, -1), 0.5, border)]))
    return t


def belt_section(belt_color, name, script, meaning, theme, forms, sparring, defense, challenge):
    header_text = f'<b>{belt_color} — {name}</b> ({script}) · <i>{theme}</i>'
    header_para = Paragraph(header_text, belt_heading)
    tbl = Table([[belt_swatch(belt_color), header_para]], colWidths=[30, 460])
    tbl.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                             ("LEFTPADDING", (0, 0), (-1, -1), 0),
                             ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                             ("BOTTOMPADDING", (0, 0), (-1, -1), 2)]))
    elements = [tbl, Paragraph(f"— {meaning}", belt_meaning)]
    elements.append(Paragraph("FORM COMBOS", sublabel))
    for c in forms:
        elements.append(Paragraph(f"• {c}", combo_style))
    elements.append(Paragraph("SPARRING COMBOS", sublabel))
    for c in sparring:
        elements.append(Paragraph(f"• {c}", combo_style))
    elements.append(Paragraph("DEFENSIVE COMBOS", sublabel))
    for c in defense:
        elements.append(Paragraph(f"• {c}", combo_style))
    elements.append(Paragraph("BREAK / CHALLENGE", sublabel))
    elements.append(Paragraph(challenge, challenge_style))
    elements.append(Spacer(1, 4))
    return KeepTogether(elements)


def build_pdf():
    doc = SimpleDocTemplate(str(OUT), pagesize=LETTER,
                            leftMargin=0.7 * inch, rightMargin=0.7 * inch,
                            topMargin=0.6 * inch, bottomMargin=0.6 * inch,
                            title="BSA — Boxing & Muay Thai Form Curriculum",
                            author="Be Strong Again")

    story = [
        Paragraph("Boxing &amp; Muay Thai", title_style),
        Paragraph("A belt-mapped form + sparring + breaking curriculum — by Be Strong Again", subtitle_style),
    ]

    # ── Boxing system intro ──
    story.append(Paragraph("Boxing — The Be Strong Again System", section_title))
    story.append(Paragraph(
        "Boxing has two origin stories: the <b>Ancient Greek Olympics</b> (688 BCE), where <i>pygmachia</i> was a "
        "contested sport between city-states, and the <b>English prize rings</b> of the 1700s, codified by the "
        "Marquess of Queensberry Rules in 1867 — rules that shape every modern bout. What the sport has never had "
        "is a <b>progression system</b>. A white belt in boxing doesn't exist. A blue belt in boxing doesn't exist. "
        "Technique is taught by apprenticeship and measured by sparring — nothing in between.",
        intro_body,
    ))
    story.append(Paragraph(
        "<b>The BSA Boxing system closes that gap.</b> Twelve belt levels. Twelve Greek names that trace a path from "
        "<i>Arche</i> (the beginning) through <i>Askesis</i> (disciplined training), <i>Agon</i> (the contest), "
        "<i>Arete</i> (excellence), to <i>Olympias</i> — the summit. The progression is anchored by the ancient Greek "
        "concept of sport: training, contest, excellence. At each belt, the student learns a set of <b>I-pattern forms</b> "
        "(every turn is 90° or 180°, every step teaches footwork alongside the punch), <b>three sparring combos</b> for "
        "live application, <b>three defensive responses</b>, and passes a <b>break-and-challenge test</b> — paper at "
        "white belt, ice blocks at blue, stacked ice at red, signature sequences at black.",
        intro_body,
    ))
    story.append(Paragraph(
        "The rank marker is the <b>Himantes</b> (ἱμάντες) — the leather hand-wrap Greek boxers wore in the "
        "Olympic pygmachia, color-coded to the student's level. Wraps are worn in every class.",
        intro_body,
    ))
    story.append(Spacer(1, 10))

    for belt in BOXING_BELTS:
        story.append(belt_section(*belt))
    story.append(PageBreak())

    # ── Muay Thai system intro ──
    story.append(Paragraph("Muay Thai &amp; Kickboxing — The Be Strong Again System", section_title))
    story.append(Paragraph(
        "Muay Thai is the heir of <b>Muay Boran</b> — ancient Siamese battlefield boxing used by soldiers when "
        "weapons were lost. Its most famous son is <b>Nai Khanom Tom</b>, a Thai prisoner of war who in 1767 defeated "
        "ten Burmese champions in sequence to win his freedom. The sport was modernized in the early 1900s with rings, "
        "rounds, and gloves — but the <b>eight-limb arsenal</b> (two fists, two elbows, two knees, two shins) and the "
        "clinch game remain the defining features. Kickboxing branched from Muay Thai in three national directions "
        "(Japan 1966, USA 1970s, Netherlands 1980s); the BSA system draws most heavily from the <b>Thai and Dutch</b> "
        "streams — low kicks, heavy combinations, clinch work.",
        intro_body,
    ))
    story.append(Paragraph(
        "Like the boxing curriculum, the Muay Thai progression maps the <b>same twelve belt colors</b> to twelve Thai "
        "concepts — but where the Greek path is philosophical (training → contest → excellence), the Thai path is "
        "<b>narrative</b>: <i>Wai Khru</i> (the student's bow to his teacher) → <i>Mae Mai</i> (mother techniques) → "
        "<i>Hanuman</i> (the monkey god's airborne ferocity) → <i>Nai Khanom Tom</i> (the warrior's undefeated "
        "spirit) → <i>Ajarn</i> (master). Each belt includes forms, sparring, defense, and a break test. Breaks "
        "lean into Muay Boran tradition and, at high belts, into the cinematic tradition of <b>Kickboxer</b> and "
        "<b>Bloodsport</b> — ice blocks, water jugs, flying-knee breaks, and full Ong-Bak-style master challenges.",
        intro_body,
    ))
    story.append(Paragraph(
        "The rank marker is the <b>Pra Jiad</b> (ประเจียด) — the sacred armband worn by Muay Thai fighters, "
        "traditionally given by the student's camp. Color-coded to level, worn on the upper arm during training "
        "and sparring. A separate <i>Mongkol</i> (head wreath) is blessed by a monk and worn only on fight day — "
        "not a rank marker.",
        intro_body,
    ))
    story.append(Paragraph(
        "<b>Lower belts</b> restrict to fists + kicks. <b>Knees and elbows</b> are introduced at High Yellow "
        "(Look Mai). <b>Full clinch</b> opens up at High Green (Muay Kiew). <b>Signature techniques</b> "
        "(flying knees, spinning elbows, the Ong-Bak jumping axe elbow) enter at Blue (Hanuman) and become the "
        "backbone of the Red, High Red, and Deputy belts.",
        intro_body,
    ))
    story.append(Spacer(1, 10))

    for belt in KICKBOXING_BELTS:
        story.append(belt_section(*belt))

    # Closing note
    story.append(Spacer(1, 14))
    story.append(Paragraph(
        "<b>Breaks and challenges are non-negotiable.</b> They are the public proof of the training. A student who "
        "cannot break the water jug at Yellow cannot move to Green. A student who cannot pass through the ice block "
        "at High Blue cannot move to Red. The progression is not a participation ladder — it is a commitment ladder. "
        "Every belt is earned. Every belt is defended. Every belt is a rite.",
        intro_body,
    ))

    doc.build(story)
    print(f"Wrote {OUT} — {OUT.stat().st_size // 1024} KB")


if __name__ == "__main__":
    build_pdf()
