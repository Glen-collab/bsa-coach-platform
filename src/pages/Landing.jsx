import { useState } from 'react';
import { Link } from 'react-router-dom';

const s = {
  hero: { background: 'linear-gradient(135deg, #1a1a2e 0%, #0f1729 50%, #16213e 100%)', padding: '80px 24px 60px', textAlign: 'center', color: '#fff' },
  heroTitle: { fontSize: 'clamp(26px, 5vw, 42px)', fontWeight: '800', marginBottom: '16px', lineHeight: '1.25' },
  heroAccent: { color: '#B37602' },
  heroSub: { fontSize: '17px', color: '#9ca3af', maxWidth: '620px', margin: '0 auto 32px', lineHeight: '1.7' },
  heroCta: { display: 'inline-block', padding: '16px 40px', background: 'linear-gradient(135deg, #B37602, #8a5b00)', color: '#fff', borderRadius: '12px', fontSize: '18px', fontWeight: '700', textDecoration: 'none', marginRight: '12px' },
  heroCtaOutline: { display: 'inline-block', padding: '16px 40px', background: 'transparent', color: '#B37602', border: '2px solid #B37602', borderRadius: '12px', fontSize: '18px', fontWeight: '700', textDecoration: 'none' },
  section: { maxWidth: '960px', margin: '0 auto', padding: '60px 24px' },
  sectionAlt: { background: '#f8f9fa', padding: '60px 24px' },
  sectionDark: { background: 'linear-gradient(135deg, #1a1a2e, #16213e)', padding: '60px 24px', color: '#fff' },
  sectionTitle: { fontSize: '26px', fontWeight: '700', textAlign: 'center', marginBottom: '12px', color: '#1a1a2e' },
  sectionTitleLight: { fontSize: '26px', fontWeight: '700', textAlign: 'center', marginBottom: '12px', color: '#fff' },
  sectionSub: { fontSize: '15px', color: '#888', textAlign: 'center', maxWidth: '600px', margin: '0 auto 40px', lineHeight: '1.6' },
  sectionSubLight: { fontSize: '15px', color: '#9ca3af', textAlign: 'center', maxWidth: '600px', margin: '0 auto 40px', lineHeight: '1.6' },
  grid3: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '24px', maxWidth: '960px', margin: '0 auto' },
  grid2: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '24px', maxWidth: '960px', margin: '0 auto' },
  card: { background: '#fff', borderRadius: '16px', padding: '28px 24px', boxShadow: '0 4px 20px rgba(0,0,0,0.06)', border: '1px solid #f0f0f0' },
  cardDark: { background: 'rgba(255,255,255,0.05)', borderRadius: '16px', padding: '28px 24px', border: '1px solid rgba(255,255,255,0.1)' },
  cardIcon: { fontSize: '32px', marginBottom: '12px' },
  cardTitle: { fontSize: '17px', fontWeight: '700', marginBottom: '8px', color: '#1a1a2e' },
  cardTitleLight: { fontSize: '17px', fontWeight: '700', marginBottom: '8px', color: '#fff' },
  cardText: { fontSize: '14px', color: '#666', lineHeight: '1.6' },
  cardTextLight: { fontSize: '14px', color: '#9ca3af', lineHeight: '1.6' },
  quote: { fontStyle: 'italic', fontSize: '15px', color: '#B37602', lineHeight: '1.6', borderLeft: '3px solid #B37602', paddingLeft: '16px', margin: '16px 0' },
  tierCard: { background: '#fff', borderRadius: '16px', padding: '28px 24px', border: '2px solid #f0f0f0', textAlign: 'center' },
  tierFeatured: { border: '2px solid #B37602', position: 'relative' },
  tierBadge: { position: 'absolute', top: '-12px', left: '50%', transform: 'translateX(-50%)', background: '#B37602', color: '#fff', padding: '4px 16px', borderRadius: '20px', fontSize: '11px', fontWeight: '700' },
  tierName: { fontSize: '20px', fontWeight: '700', marginBottom: '4px' },
  tierPrice: { fontSize: '32px', fontWeight: '800', color: '#B37602', margin: '8px 0 4px' },
  tierKeep: { fontSize: '14px', color: '#16a34a', fontWeight: '700', marginBottom: '16px' },
  tierList: { listStyle: 'none', padding: 0, textAlign: 'left', marginBottom: '16px' },
  tierItem: { padding: '6px 0', fontSize: '13px', color: '#555', borderBottom: '1px solid #f5f5f5' },
  tierExpect: { background: '#faf5ff', borderRadius: '10px', padding: '14px', textAlign: 'left', marginBottom: '12px' },
  tierExpectTitle: { fontSize: '12px', fontWeight: '700', color: '#764ba2', textTransform: 'uppercase', marginBottom: '6px' },
  tierExpectText: { fontSize: '13px', color: '#555', lineHeight: '1.5', margin: 0 },
  gateBox: { background: '#1a1a2e', borderRadius: '16px', padding: '40px 32px', maxWidth: '480px', margin: '0 auto', textAlign: 'center', color: '#fff' },
  gateInput: { width: '100%', padding: '14px 16px', border: '2px solid #333', borderRadius: '10px', fontSize: '16px', background: '#0f1729', color: '#fff', textAlign: 'center', letterSpacing: '4px', outline: 'none', marginBottom: '16px', boxSizing: 'border-box' },
  gateBtn: { width: '100%', padding: '14px', border: 'none', borderRadius: '10px', background: 'linear-gradient(135deg, #B37602, #8a5b00)', color: '#fff', fontSize: '16px', fontWeight: '600', cursor: 'pointer' },
  steps: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '28px', maxWidth: '900px', margin: '0 auto' },
  step: { textAlign: 'center', padding: '8px' },
  stepNum: { width: '44px', height: '44px', borderRadius: '50%', background: '#B37602', color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px', fontWeight: '700', marginBottom: '10px' },
  stepTitle: { fontSize: '15px', fontWeight: '700', marginBottom: '4px', color: '#1a1a2e' },
  stepText: { fontSize: '13px', color: '#777', lineHeight: '1.5' },
  footer: { background: '#0f1729', padding: '24px', textAlign: 'center', color: '#555', fontSize: '13px' },
};

const COACH_ACCESS_CODE = 'BSACOACH2026';

export default function Landing() {
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [accessCode, setAccessCode] = useState('');
  const [codeError, setCodeError] = useState('');

  const handleUnlock = () => {
    if (accessCode.toUpperCase().trim() === COACH_ACCESS_CODE) {
      setShowBreakdown(true);
      setCodeError('');
    } else {
      setCodeError('Invalid code. Reach out to us to get your coach access code.');
    }
  };

  return (
    <>
      {/* Hero */}
      <div style={s.hero}>
        <h1 style={s.heroTitle}>
          Trainers Come and Go.<br />
          <span style={s.heroAccent}>Be the One They Keep.</span>
        </h1>
        <p style={s.heroSub}>
          Your clients trust you. Give them a way to train with your guidance — whether they're
          across the gym or across the country. Keep 80% of every dollar your clients pay.
        </p>
        <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', flexWrap: 'wrap' }}>
          <Link to="/apply-coach" style={s.heroCta}>Apply as Coach</Link>
          <a href="#breakdown" style={s.heroCtaOutline} onClick={(e) => { e.preventDefault(); document.getElementById('breakdown').scrollIntoView({ behavior: 'smooth' }); }}>See the Numbers</a>
        </div>
      </div>

      {/* Real Scenarios */}
      <div style={s.section}>
        <h2 style={s.sectionTitle}>Sound Familiar?</h2>
        <p style={s.sectionSub}>Every trainer has these clients. Now you have a way to keep them.</p>
        <div style={s.grid3}>
          <div style={s.card}>
            <div style={s.cardIcon}>&#9992;&#65039;</div>
            <div style={s.cardTitle}>The Vacation Client</div>
            <div style={s.cardText}>They're going to Cancun for two weeks and ask "what should I do while I'm gone?" Now you hand them a travel workout in the app instead of scribbling on a napkin.</div>
          </div>
          <div style={s.card}>
            <div style={s.cardIcon}>&#127774;</div>
            <div style={s.cardTitle}>The Snowbird</div>
            <div style={s.cardText}>They train with you October through April, then disappear to Florida. Instead of losing them for 6 months, keep coaching them through the app for $200/month.</div>
          </div>
          <div style={s.card}>
            <div style={s.cardIcon}>&#127968;</div>
            <div style={s.cardTitle}>The At-Home Client</div>
            <div style={s.cardText}>They can't always make it to the gym. For $20/month they follow your program at home, watch your exercise videos, and stay accountable between sessions.</div>
          </div>
          <div style={s.card}>
            <div style={s.cardIcon}>&#128587;</div>
            <div style={s.cardTitle}>The One Who Left</div>
            <div style={s.cardText}>Budget got tight. They stopped coming. But they'd pay $20/month to keep following a program from someone they trust. You just didn't have a way to offer it — until now.</div>
          </div>
          <div style={s.card}>
            <div style={s.cardIcon}>&#128170;</div>
            <div style={s.cardTitle}>The DIY Person</div>
            <div style={s.cardText}>They want to train on their own but have no idea what to do. Basic tier — hand them a program, 950+ exercise videos handle the form, and you check in once in a while.</div>
          </div>
          <div style={s.card}>
            <div style={s.cardIcon}>&#127942;</div>
            <div style={s.cardTitle}>The Serious Athlete</div>
            <div style={s.cardText}>Competition prep, sport-specific training, the client who wants everything dialed in. Elite tier — full 1-on-1 attention, unlimited video reviews, nutrition guidance.</div>
          </div>
        </div>
      </div>

      {/* The Pitch */}
      <div style={s.sectionDark}>
        <div style={{ maxWidth: '700px', margin: '0 auto', textAlign: 'center' }}>
          <h2 style={s.sectionTitleLight}>Service First. Revenue Second.</h2>
          <p style={s.sectionSubLight}>
            This isn't about selling memberships. It's about keeping the connection with your clients
            no matter where they are or what their budget is. The revenue follows the relationship.
          </p>
          <div style={s.quote}>
            "Keep your client accountable at home for $20 a month. Get them to the coached level
            when they're ready. The app doesn't replace you — it extends you."
          </div>
          <div style={{ ...s.grid2, marginTop: '32px' }}>
            <div style={s.cardDark}>
              <div style={s.cardTitleLight}>Your Brand, Your Clients</div>
              <div style={s.cardTextLight}>Clients sign up under YOUR referral link. They're your clients — the platform just gives you the tools to serve them better.</div>
            </div>
            <div style={s.cardDark}>
              <div style={s.cardTitleLight}>No Upfront Cost</div>
              <div style={s.cardTextLight}>No monthly software fee. No setup cost. The platform takes a small cut only when you're making money. You earn first, we eat second.</div>
            </div>
          </div>
        </div>
      </div>

      {/* What You Get */}
      <div style={s.section}>
        <h2 style={s.sectionTitle}>What the Platform Gives You</h2>
        <p style={s.sectionSub}>Everything you need to coach remotely — already built.</p>
        <div style={s.grid3}>
          <div style={s.card}>
            <div style={s.cardIcon}>&#127909;</div>
            <div style={s.cardTitle}>950+ Exercise Videos</div>
            <div style={s.cardText}>Your clients see proper form demos right inside their workout. You don't have to record a single video.</div>
          </div>
          <div style={s.card}>
            <div style={s.cardIcon}>&#128221;</div>
            <div style={s.cardTitle}>Program Builder</div>
            <div style={s.cardText}>Build multi-week programs with supersets, circuits, conditioning, percentage-based lifts — save and reuse templates.</div>
          </div>
          <div style={s.card}>
            <div style={s.cardIcon}>&#128202;</div>
            <div style={s.cardTitle}>Progress Tracking</div>
            <div style={s.cardText}>Clients log weights and reps. You see volume stats, weekly charts, completion rates. Know what they did without asking.</div>
          </div>
          <div style={s.card}>
            <div style={s.cardIcon}>&#128176;</div>
            <div style={s.cardTitle}>Automated Billing</div>
            <div style={s.cardText}>Stripe handles payments. Clients subscribe, you get paid. No invoices, no chasing, no awkward conversations.</div>
          </div>
          <div style={s.card}>
            <div style={s.cardIcon}>&#128279;</div>
            <div style={s.cardTitle}>Your Referral Link</div>
            <div style={s.cardText}>Get a unique code. Share it on social, text it to prospects. When they sign up through your link, they're under you.</div>
          </div>
          <div style={s.card}>
            <div style={s.cardIcon}>&#128101;</div>
            <div style={s.cardTitle}>Bring Other Trainers</div>
            <div style={s.cardText}>Know a trainer who'd benefit from this? Refer them. You earn a bonus on every client they bring to the platform.</div>
          </div>
        </div>
      </div>

      {/* How It Works */}
      <div style={s.sectionAlt}>
        <h2 style={s.sectionTitle}>How Your Clients Get Started</h2>
        <p style={s.sectionSub}>You share your link. The platform handles the rest.</p>
        <div style={s.steps}>
          <div style={s.step}>
            <div style={s.stepNum}>1</div>
            <div style={s.stepTitle}>Share Your Link</div>
            <div style={s.stepText}>Text, email, post it — your referral link brings them straight to sign up under you.</div>
          </div>
          <div style={s.step}>
            <div style={s.stepNum}>2</div>
            <div style={s.stepTitle}>They Pick a Level</div>
            <div style={s.stepText}>$20 Basic for self-guided. $200 Coached for real coaching. $400 Elite for full attention. Or a free 2-week trial.</div>
          </div>
          <div style={s.step}>
            <div style={s.stepNum}>3</div>
            <div style={s.stepTitle}>Build Their Program</div>
            <div style={s.stepText}>Use the builder to create their workout. Hand them an access code. They start training in the app immediately.</div>
          </div>
          <div style={s.step}>
            <div style={s.stepNum}>4</div>
            <div style={s.stepTitle}>Coach & Get Paid</div>
            <div style={s.stepText}>Deliver the service. Stripe deposits hit your account automatically. Focus on coaching, not admin.</div>
          </div>
        </div>
      </div>

      {/* Breakdown — Gated */}
      <div id="breakdown" style={s.section}>
        <h2 style={s.sectionTitle}>The Numbers</h2>
        <p style={s.sectionSub}>How much you keep, what clients expect at each level, and how referrals work.</p>

        {!showBreakdown ? (
          <div style={s.gateBox}>
            <div style={{ fontSize: '32px', marginBottom: '12px' }}>&#128274;</div>
            <div style={{ fontSize: '18px', fontWeight: '700', marginBottom: '8px' }}>Coach Access Only</div>
            <p style={{ fontSize: '14px', color: '#9ca3af', marginBottom: '20px', lineHeight: '1.5' }}>
              Enter your coach access code to see the full breakdown.
              Don't have one? <Link to="/apply-coach" style={{ color: '#B37602' }}>Apply as a coach</Link> to get started.
            </p>
            <input
              style={s.gateInput}
              type="text"
              placeholder="Enter code"
              value={accessCode}
              onChange={(e) => setAccessCode(e.target.value.toUpperCase())}
              onKeyDown={(e) => e.key === 'Enter' && handleUnlock()}
            />
            {codeError && <div style={{ color: '#ef4444', fontSize: '13px', marginBottom: '12px' }}>{codeError}</div>}
            <button style={s.gateBtn} onClick={handleUnlock}>Unlock</button>
          </div>
        ) : (
          <>
            {/* Simple Split */}
            <div style={{ ...s.card, maxWidth: '700px', margin: '0 auto 32px', textAlign: 'center' }}>
              <h3 style={{ fontSize: '22px', fontWeight: '700', marginBottom: '16px' }}>The Split is Simple</h3>
              <div style={{ display: 'flex', gap: '16px', justifyContent: 'center', flexWrap: 'wrap', marginBottom: '20px' }}>
                <div style={{ background: '#16a34a', borderRadius: '12px', padding: '20px 28px', color: '#fff', textAlign: 'center' }}>
                  <div style={{ fontSize: '36px', fontWeight: '800' }}>80%</div>
                  <div style={{ fontSize: '12px', opacity: 0.85, fontWeight: '600' }}>YOU KEEP</div>
                </div>
                <div style={{ background: '#1a1a2e', borderRadius: '12px', padding: '20px 28px', color: '#fff', textAlign: 'center' }}>
                  <div style={{ fontSize: '36px', fontWeight: '800' }}>10%</div>
                  <div style={{ fontSize: '12px', opacity: 0.85, fontWeight: '600' }}>PLATFORM FEE</div>
                </div>
                <div style={{ background: '#B37602', borderRadius: '12px', padding: '20px 28px', color: '#fff', textAlign: 'center' }}>
                  <div style={{ fontSize: '36px', fontWeight: '800' }}>10%</div>
                  <div style={{ fontSize: '12px', opacity: 0.85, fontWeight: '600' }}>TO YOUR UPLINE</div>
                </div>
              </div>
              <p style={{ fontSize: '14px', color: '#666', lineHeight: '1.6', maxWidth: '560px', margin: '0 auto' }}>
                10% goes to the platform — that covers the video library, app development, hosting, billing, and support.
                10% goes to whoever brought you onto the platform. No software fees, no setup costs. The platform earns when you earn.
                And when YOU recruit another trainer, you earn that same 10% from their clients.
              </p>
            </div>

            {/* Tier Breakdown */}
            <h3 style={{ ...s.sectionTitle, fontSize: '20px', marginBottom: '8px' }}>Three Levels of Service</h3>
            <p style={s.sectionSub}>What clients pay, what you keep, and what they expect from you.</p>

            <div style={s.grid3}>
              {/* Basic */}
              <div style={s.tierCard}>
                <div style={s.tierName}>Basic</div>
                <div style={s.tierPrice}>$20</div>
                <div style={{ fontSize: '13px', color: '#888', marginBottom: '8px' }}>per month</div>
                <div style={s.tierKeep}>You keep $16</div>
                <ul style={s.tierList}>
                  <li style={s.tierItem}>Your workout program in the app</li>
                  <li style={s.tierItem}>950+ exercise video library</li>
                  <li style={s.tierItem}>Progress tracking</li>
                  <li style={s.tierItem}>Community access</li>
                </ul>
                <div style={s.tierExpect}>
                  <div style={s.tierExpectTitle}>What You Provide</div>
                  <p style={s.tierExpectText}>
                    Build their program, hand them a code. Check in with a "great job" email every couple weeks.
                    This is your passive tier — build once, collect monthly. Perfect for at-home clients
                    and people between in-person sessions.
                  </p>
                </div>
              </div>

              {/* Coached */}
              <div style={{ ...s.tierCard, ...s.tierFeatured }}>
                <div style={s.tierBadge}>Where the Money Is</div>
                <div style={s.tierName}>Coached</div>
                <div style={s.tierPrice}>$200</div>
                <div style={{ fontSize: '13px', color: '#888', marginBottom: '8px' }}>per month</div>
                <div style={s.tierKeep}>You keep $160</div>
                <ul style={s.tierList}>
                  <li style={s.tierItem}>Everything in Basic</li>
                  <li style={s.tierItem}>You as their dedicated coach</li>
                  <li style={s.tierItem}>Custom programs for their goals</li>
                  <li style={s.tierItem}>Weekly video feedback on form</li>
                  <li style={s.tierItem}>Direct messaging</li>
                  <li style={s.tierItem}>Program adjustments as they progress</li>
                </ul>
                <div style={s.tierExpect}>
                  <div style={s.tierExpectTitle}>What You Provide</div>
                  <p style={s.tierExpectText}>
                    Custom programming. Check in 1-2 times per week. Review their logged workouts.
                    Video review their form when they ask. Adjust their program based on progress.
                    This is real coaching — your snowbirds, your remote clients, your travelers.
                  </p>
                </div>
              </div>

              {/* Elite */}
              <div style={s.tierCard}>
                <div style={s.tierName}>Elite</div>
                <div style={s.tierPrice}>$400</div>
                <div style={{ fontSize: '13px', color: '#888', marginBottom: '8px' }}>per month</div>
                <div style={s.tierKeep}>You keep $320</div>
                <ul style={s.tierList}>
                  <li style={s.tierItem}>Everything in Coached</li>
                  <li style={s.tierItem}>True 1-on-1 attention</li>
                  <li style={s.tierItem}>Unlimited video reviews</li>
                  <li style={s.tierItem}>Competition / goal-specific prep</li>
                  <li style={s.tierItem}>Nutrition guidance</li>
                  <li style={s.tierItem}>Priority response</li>
                </ul>
                <div style={s.tierExpect}>
                  <div style={s.tierExpectTitle}>What You Provide</div>
                  <p style={s.tierExpectText}>
                    Full attention. Messaging 2-3 times per week minimum. Proactive program changes.
                    Video reviews every session if they want it. Nutrition check-ins.
                    These are your serious athletes and competition clients.
                  </p>
                </div>
              </div>
            </div>

            {/* Referral Bonus */}
            <div style={{ ...s.card, marginTop: '32px', maxWidth: '700px', margin: '32px auto 0' }}>
              <h3 style={{ fontSize: '18px', fontWeight: '700', marginBottom: '16px', color: '#1a1a2e' }}>Referral Bonus</h3>
              <div style={{ fontSize: '14px', color: '#555', lineHeight: '1.8' }}>
                <p style={{ marginBottom: '12px' }}>Every coach pays 10% to the platform and 10% to whoever recruited them. When YOU recruit a trainer, that second 10% goes to you. One level. That's it.</p>
                <div style={{ background: '#f8f9fa', borderRadius: '10px', padding: '16px', marginBottom: '12px', fontFamily: 'monospace', fontSize: '13px', lineHeight: '2' }}>
                  You refer Coach Mike<br />
                  Mike signs up a Coached client ($200/mo)<br />
                  Mike keeps $160 (80%)<br />
                  Platform gets $20 (10%)<br />
                  You get $20 (10%) — you recruited Mike
                </div>
                <p style={{ marginBottom: '12px' }}>Mike refers Coach Lisa. Lisa signs a client:</p>
                <div style={{ background: '#f8f9fa', borderRadius: '10px', padding: '16px', marginBottom: '12px', fontFamily: 'monospace', fontSize: '13px', lineHeight: '2' }}>
                  Lisa keeps $160 (80%)<br />
                  Platform gets $20 (10%)<br />
                  Mike gets $20 (10%) — he recruited Lisa<br />
                  You get nothing from Lisa's clients — one level only
                </div>
                <p style={{ marginBottom: '0', color: '#888', fontSize: '13px' }}>
                  This isn't a pyramid. You earn from trainers YOU personally bring to the platform. Everyone pays the same split. The real money is always in your own clients.
                </p>
              </div>
            </div>

            {/* Real Talk */}
            <div style={{ ...s.card, marginTop: '24px', maxWidth: '700px', margin: '24px auto 0', background: '#faf5ff', border: '1px solid #e8d5f5' }}>
              <h3 style={{ fontSize: '18px', fontWeight: '700', marginBottom: '12px', color: '#5a3e8e' }}>Real Talk — What This Looks Like</h3>
              <div style={{ fontSize: '14px', color: '#555', lineHeight: '1.8' }}>
                <p style={{ marginBottom: '8px' }}>You have 15 in-person clients. Five of them travel regularly. Three moved away. Two want at-home programming for the days they can't make it in.</p>
                <p style={{ marginBottom: '12px' }}>That's 10 people you're currently losing touch with. Put them on the platform:</p>
                <div style={{ background: '#fff', borderRadius: '10px', padding: '16px', marginBottom: '12px', fontSize: '13px', lineHeight: '2' }}>
                  5 travelers on Basic ($20/mo x 80%) = $80/mo<br />
                  3 who moved on Coached ($200/mo x 80%) = $480/mo<br />
                  2 at-home on Basic ($20/mo x 80%) = $32/mo<br />
                  <strong style={{ color: '#16a34a' }}>= $592/month you weren't making before</strong>
                </div>
                <p style={{ marginBottom: '0', fontStyle: 'italic', color: '#888' }}>
                  That's not new clients. That's clients you already have who are slipping through the cracks.
                  The platform just gives you a way to keep serving them.
                </p>
              </div>
            </div>

            {/* Coach Only vs Coach + Recruiter */}
            <div style={{ ...s.card, marginTop: '32px', maxWidth: '800px', margin: '32px auto 0' }}>
              <h3 style={{ fontSize: '18px', fontWeight: '700', marginBottom: '20px', color: '#1a1a2e', textAlign: 'center' }}>Coach Only vs. Coach + Recruiter</h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '20px' }}>

                {/* Coach Only */}
                <div style={{ background: '#f8f9fa', borderRadius: '12px', padding: '20px', border: '1px solid #e5e7eb' }}>
                  <div style={{ fontSize: '15px', fontWeight: '700', color: '#1a1a2e', marginBottom: '12px', textAlign: 'center' }}>Coach Only</div>
                  <div style={{ fontSize: '13px', color: '#555', lineHeight: '2' }}>
                    5 Basic clients ($16 each) = $80<br />
                    10 Coached clients ($160 each) = $1,600<br />
                    2 Elite clients ($320 each) = $640<br />
                  </div>
                  <div style={{ borderTop: '2px solid #e5e7eb', marginTop: '12px', paddingTop: '12px', textAlign: 'center' }}>
                    <div style={{ fontSize: '11px', fontWeight: '600', color: '#888', textTransform: 'uppercase' }}>Monthly Income</div>
                    <div style={{ fontSize: '28px', fontWeight: '800', color: '#1a1a2e' }}>$2,320</div>
                    <div style={{ fontSize: '12px', color: '#888' }}>100% from your own coaching</div>
                  </div>
                </div>

                {/* Coach + Recruiter */}
                <div style={{ background: '#faf5ff', borderRadius: '12px', padding: '20px', border: '2px solid #B37602' }}>
                  <div style={{ fontSize: '15px', fontWeight: '700', color: '#B37602', marginBottom: '12px', textAlign: 'center' }}>Coach + Recruiter</div>
                  <div style={{ fontSize: '13px', color: '#555', lineHeight: '2' }}>
                    Same 17 clients above = $2,320<br />
                    <span style={{ color: '#B37602', fontWeight: '600' }}>+ 3 coaches you recruited:</span><br />
                    Coach A: 8 Coached clients ($20 each to you) = $160<br />
                    Coach B: 12 Coached clients ($20 each to you) = $240<br />
                    Coach C: 5 Coached + 2 Elite ($20 + $40 each) = $180<br />
                  </div>
                  <div style={{ borderTop: '2px solid #B37602', marginTop: '12px', paddingTop: '12px', textAlign: 'center' }}>
                    <div style={{ fontSize: '11px', fontWeight: '600', color: '#888', textTransform: 'uppercase' }}>Monthly Income</div>
                    <div style={{ fontSize: '28px', fontWeight: '800', color: '#B37602' }}>$2,900</div>
                    <div style={{ fontSize: '12px', color: '#888' }}>$580/mo passive from 3 coaches you recruited</div>
                  </div>
                </div>
              </div>
              <p style={{ fontSize: '13px', color: '#888', textAlign: 'center', marginTop: '16px', lineHeight: '1.5' }}>
                The coaching income is the same either way — 80% of your clients. The referral bonus is what happens
                on top when you help another trainer get set up on the platform. You're not managing their clients.
                You just brought them in.
              </p>
            </div>

            {/* The 90% Truth */}
            <div style={{ ...s.card, marginTop: '24px', maxWidth: '800px', margin: '24px auto 0', background: '#f0fdf4', border: '1px solid #bbf7d0' }}>
              <h3 style={{ fontSize: '16px', fontWeight: '700', marginBottom: '8px', color: '#16a34a' }}>How You Get to 90%</h3>
              <p style={{ fontSize: '14px', color: '#555', lineHeight: '1.7', margin: 0 }}>
                Every coach keeps 80% and pays 10% to the platform + 10% to their upline.
                When you recruit a coach, their 10% upline fee comes to you — that's your referral bonus.
                So your effective take on your OWN clients is 80%, but when you add the 10% flowing in
                from each coach you recruited, your overall revenue per dollar on the platform approaches 90%.
                The more coaches you bring in, the closer you get. That's the real incentive to grow — not just coach.
              </p>
            </div>

            {/* CTA */}
            <div style={{ textAlign: 'center', marginTop: '40px' }}>
              <Link to="/apply-coach" style={s.heroCta}>Apply as Coach</Link>
            </div>
          </>
        )}
      </div>

      {/* Footer */}
      <div style={s.footer}>
        Be Strong Again &middot; Trainers come and go. Clients come and go. Service is forever.
      </div>
    </>
  );
}
