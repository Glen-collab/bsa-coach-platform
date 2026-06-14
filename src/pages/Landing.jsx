// Member-facing landing / get-started page. Visually mirrors
// MemberDashboard so a paying customer feels they're already inside the
// product after one tap of "Start Today". Single scroll, hero above the
// fold, every CTA → /register/GLENM7NUS?tier=basic (or coached/elite).
//
// Coach-recruitment pitch is preserved at /become-a-coach (CoachPitch.jsx).

import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import useMediaQuery from '../hooks/useMediaQuery';
import { formatScore } from '../utils/challengeFormat';

const REFERRAL_CODE = 'GLENM7NUS'; // Glen's own — all direct signups
const startLink = (tier = 'basic') => `/register/${REFERRAL_CODE}?tier=${tier}`;

const buildStyles = (isMobile) => ({
  page: { background: '#fff', color: '#1a1a2e', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' },

  // HERO — same green primary card vocabulary as MemberDashboard's "Start Your Workout"
  hero: {
    background: 'linear-gradient(135deg, #16a34a 0%, #15803d 60%, #14532d 100%)',
    color: '#fff',
    padding: isMobile ? '64px 20px 56px' : '96px 24px 80px',
    textAlign: 'center',
  },
  brandRow: { fontSize: '13px', fontWeight: 700, letterSpacing: '3px', opacity: 0.8, marginBottom: '14px', textTransform: 'uppercase' },
  heroTitle: {
    fontSize: isMobile ? '34px' : '52px',
    fontWeight: 900,
    lineHeight: 1.1,
    margin: '0 0 18px',
    letterSpacing: '-0.5px',
  },
  heroSub: {
    fontSize: isMobile ? '16px' : '18px',
    lineHeight: 1.55,
    maxWidth: '560px',
    margin: '0 auto 32px',
    opacity: 0.95,
  },
  heroCta: {
    display: 'inline-block',
    padding: isMobile ? '16px 32px' : '18px 44px',
    background: '#fff',
    color: '#15803d',
    borderRadius: '12px',
    fontSize: isMobile ? '17px' : '19px',
    fontWeight: 800,
    textDecoration: 'none',
    letterSpacing: '0.3px',
    boxShadow: '0 8px 24px rgba(0,0,0,0.2)',
  },
  heroNote: { fontSize: '13px', opacity: 0.85, marginTop: '14px' },

  // Sections
  section: { maxWidth: '960px', margin: '0 auto', padding: isMobile ? '56px 20px' : '80px 24px' },
  sectionAlt: { background: '#f7f8fa' },
  sectionTitle: { fontSize: isMobile ? '24px' : '30px', fontWeight: 800, textAlign: 'center', margin: '0 0 14px', letterSpacing: '-0.3px' },
  sectionLead: { fontSize: '15px', color: '#566', textAlign: 'center', maxWidth: '560px', margin: '0 auto 36px', lineHeight: 1.6 },

  // HOW IT WORKS — numbered steps
  steps: { display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)', gap: isMobile ? '20px' : '32px' },
  step: { textAlign: 'center', padding: '12px' },
  stepNum: {
    width: '52px', height: '52px', borderRadius: '50%',
    background: 'linear-gradient(135deg, #16a34a, #15803d)',
    color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    fontSize: '22px', fontWeight: 800,
    marginBottom: '14px',
    boxShadow: '0 4px 12px rgba(22,163,74,0.3)',
  },
  stepTitle: { fontSize: '17px', fontWeight: 800, marginBottom: '6px' },
  stepText: { fontSize: '14px', color: '#677', lineHeight: 1.6 },

  // WHAT YOU GET — cards
  perks: { display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(2, 1fr)', gap: '14px' },
  perk: { display: 'flex', gap: '14px', alignItems: 'flex-start', padding: '18px', background: '#fff', borderRadius: '12px', boxShadow: '0 2px 10px rgba(0,0,0,0.05)' },
  perkIcon: { fontSize: '26px', flexShrink: 0, lineHeight: 1 },
  perkText: { display: 'flex', flexDirection: 'column' },
  perkTitle: { fontSize: '15px', fontWeight: 800, marginBottom: '2px' },
  perkBody: { fontSize: '13px', color: '#677', lineHeight: 1.5 },

  // PRICING
  tiers: { display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)', gap: '16px' },
  tier: {
    background: '#fff', borderRadius: '14px', padding: '24px 20px',
    border: '2px solid #ececf0', position: 'relative',
    display: 'flex', flexDirection: 'column',
  },
  tierFeatured: { border: '2px solid #16a34a', boxShadow: '0 12px 30px rgba(22,163,74,0.15)' },
  tierBadge: {
    position: 'absolute', top: '-12px', left: '50%', transform: 'translateX(-50%)',
    background: 'linear-gradient(135deg, #16a34a, #15803d)', color: '#fff',
    fontSize: '11px', fontWeight: 800, letterSpacing: '1.5px',
    padding: '4px 14px', borderRadius: '999px',
    textTransform: 'uppercase',
  },
  tierName: { fontSize: '18px', fontWeight: 800, marginBottom: '4px', textAlign: 'center' },
  tierPrice: { fontSize: '34px', fontWeight: 900, color: '#15803d', textAlign: 'center', margin: '6px 0 2px', letterSpacing: '-1px' },
  tierUnit: { fontSize: '13px', color: '#888', textAlign: 'center', marginBottom: '10px' },
  tierTagline: {
    fontSize: '13px', color: '#15803d', textAlign: 'center',
    fontStyle: 'italic', fontWeight: 600, marginBottom: '14px',
    minHeight: '34px', // keeps the three cards aligned even when one wraps
  },
  tierList: { listStyle: 'none', padding: 0, margin: '0 0 18px', flex: 1 },
  tierItem: { fontSize: '14px', padding: '6px 0', color: '#445', display: 'flex', gap: '8px', alignItems: 'flex-start' },
  tierCheck: { color: '#16a34a', fontWeight: 800, flexShrink: 0 },
  tierBtn: {
    display: 'block', textAlign: 'center',
    padding: '13px', background: 'linear-gradient(135deg, #16a34a, #15803d)', color: '#fff',
    borderRadius: '10px', fontWeight: 800, textDecoration: 'none', fontSize: '15px',
  },
  tierBtnQuiet: {
    background: '#fff', color: '#15803d', border: '2px solid #16a34a',
  },

  // FAQ
  faq: { display: 'flex', flexDirection: 'column', gap: '12px', maxWidth: '700px', margin: '0 auto' },
  faqItem: { background: '#fff', padding: '18px 20px', borderRadius: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.04)' },
  faqQ: { fontSize: '15px', fontWeight: 800, marginBottom: '6px' },
  faqA: { fontSize: '14px', color: '#566', lineHeight: 1.6, margin: 0 },

  // Final CTA
  finalBlock: {
    background: 'linear-gradient(135deg, #1a1a2e, #0f1729)',
    color: '#fff',
    padding: isMobile ? '60px 20px' : '80px 24px',
    textAlign: 'center',
  },
  finalTitle: { fontSize: isMobile ? '28px' : '36px', fontWeight: 900, margin: '0 0 14px', letterSpacing: '-0.3px' },
  finalSub: { fontSize: '15px', opacity: 0.85, maxWidth: '500px', margin: '0 auto 26px', lineHeight: 1.6 },
  finalCta: {
    display: 'inline-block', padding: '16px 40px',
    background: 'linear-gradient(135deg, #16a34a, #15803d)', color: '#fff',
    borderRadius: '12px', fontSize: '17px', fontWeight: 800,
    textDecoration: 'none', letterSpacing: '0.3px',
    boxShadow: '0 8px 24px rgba(22,163,74,0.35)',
  },

  // Footer
  footer: { padding: '28px 24px', textAlign: 'center', fontSize: '12px', color: '#aaa', background: '#0a0f1f' },
  footerLink: { color: '#9ca3af', textDecoration: 'none', borderBottom: '1px dotted #555' },
});

function ChallengeLeaderboard({ s, isMobile, startLink }) {
  const [challenges, setChallenges] = useState([]);
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    fetch('https://app.bestrongagain.com/api/challenges/all-public')
      .then(r => r.json())
      .then(d => { if (d.success && d.challenges?.length) setChallenges(d.challenges); })
      .catch(() => {});
  }, []);

  if (!challenges.length) return null;

  const data = challenges[idx];
  const hasPrev = idx < challenges.length - 1;
  const hasNext = idx > 0;
  const medals = ['🥇', '🥈', '🥉'];

  return (
    <section style={{
      background: 'linear-gradient(135deg, #1a1a2e 0%, #0f1729 100%)',
      padding: isMobile ? '56px 20px' : '80px 24px',
      textAlign: 'center',
    }}>
      <div style={{ maxWidth: '640px', margin: '0 auto' }}>
        {/* GET IN THE GAME badge */}
        <div style={{
          display: 'inline-block',
          background: 'linear-gradient(135deg, #fbbf24, #d97706)',
          padding: isMobile ? '10px 24px' : '12px 32px',
          borderRadius: '8px',
          marginBottom: '20px',
          boxShadow: '0 4px 20px rgba(251,191,36,0.35)',
        }}>
          <span style={{
            fontSize: isMobile ? '18px' : '24px',
            fontWeight: 900,
            color: '#1a1a2e',
            letterSpacing: '3px',
            textTransform: 'uppercase',
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Impact, sans-serif',
          }}>🔥 GET IN THE GAME</span>
        </div>

        {/* Arrow navigation */}
        {challenges.length > 1 && (
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '16px', marginBottom: '12px' }}>
            <button
              onClick={() => setIdx(i => i + 1)}
              disabled={!hasPrev}
              style={{
                width: '36px', height: '36px', borderRadius: '50%',
                border: '1px solid rgba(255,255,255,0.2)',
                background: hasPrev ? 'rgba(255,255,255,0.1)' : 'transparent',
                color: hasPrev ? '#fff' : 'rgba(255,255,255,0.2)',
                fontSize: '18px', cursor: hasPrev ? 'pointer' : 'default',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >◀</button>
            <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.5)', fontWeight: 600, minWidth: '80px' }}>
              {data.status === 'active' ? '🟢 ACTIVE' : `${new Date(data.start_date).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}`}
            </span>
            <button
              onClick={() => setIdx(i => i - 1)}
              disabled={!hasNext}
              style={{
                width: '36px', height: '36px', borderRadius: '50%',
                border: '1px solid rgba(255,255,255,0.2)',
                background: hasNext ? 'rgba(255,255,255,0.1)' : 'transparent',
                color: hasNext ? '#fff' : 'rgba(255,255,255,0.2)',
                fontSize: '18px', cursor: hasNext ? 'pointer' : 'default',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >▶</button>
          </div>
        )}

        <h2 style={{
          fontSize: isMobile ? '24px' : '32px', fontWeight: 900,
          color: '#fff', margin: '0 0 6px', letterSpacing: '-0.3px',
        }}>{data.title}</h2>
        {data.description && (
          <p style={{ fontSize: '15px', color: 'rgba(255,255,255,0.7)', margin: '0 0 8px', lineHeight: 1.5 }}>
            {data.description}
          </p>
        )}
        <div style={{ fontSize: '13px', color: 'rgba(255,255,255,0.5)', marginBottom: '24px' }}>
          {data.status === 'active' && data.days_left != null ? `${data.days_left} days left · ` : ''}
          {data.unit} · {data.lower_is_better ? 'Lowest wins' : 'Highest wins'}
          {data.total_participants > 0 && ` · ${data.total_participants} competed`}
        </div>

        {/* Standings */}
        {data.standings && data.standings.length > 0 ? (
          <div style={{
            background: 'rgba(255,255,255,0.05)',
            borderRadius: '16px',
            border: '1px solid rgba(251,191,36,0.2)',
            overflow: 'hidden',
            marginBottom: '24px',
          }}>
            {data.standings.map((row, i) => (
              <div key={i} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '14px 20px',
                borderBottom: i < data.standings.length - 1 ? '1px solid rgba(255,255,255,0.06)' : 'none',
                background: i === 0 ? 'rgba(251,191,36,0.08)' : 'transparent',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <span style={{ fontSize: '20px', width: '28px', textAlign: 'center' }}>
                    {medals[i] || <span style={{ fontSize: '14px', color: 'rgba(255,255,255,0.4)', fontWeight: 700 }}>#{row.rank}</span>}
                  </span>
                  <span style={{
                    fontSize: '15px', fontWeight: 700, color: '#fff',
                  }}>{row.first_name}</span>
                </div>
                <span style={{
                  fontSize: '16px', fontWeight: 800,
                  color: i === 0 ? '#fbbf24' : 'rgba(255,255,255,0.8)',
                }}>{formatScore(row.score, data.unit)}</span>
              </div>
            ))}
          </div>
        ) : (
          <div style={{
            background: 'rgba(255,255,255,0.05)',
            borderRadius: '16px',
            padding: '30px 20px',
            marginBottom: '24px',
            color: 'rgba(255,255,255,0.5)',
            fontSize: '15px',
          }}>
            No entries yet — be the first to post a score!
          </div>
        )}

        <Link to={startLink('basic')} style={{
          display: 'inline-block',
          padding: '14px 36px',
          background: 'linear-gradient(135deg, #fbbf24, #d97706)',
          color: '#1a1a2e',
          borderRadius: '12px',
          fontSize: '16px',
          fontWeight: 800,
          textDecoration: 'none',
          boxShadow: '0 6px 20px rgba(251,191,36,0.3)',
        }}>Join the Challenge — $20/mo</Link>
        <div style={{ marginTop: '10px', fontSize: '12px', color: 'rgba(255,255,255,0.4)' }}>
          Subscribe to submit your score and compete.
        </div>
      </div>
    </section>
  );
}

export default function Landing() {
  const isMobile = useMediaQuery('(max-width: 720px)');
  const s = buildStyles(isMobile);

  return (
    <div style={s.page}>
      {/* HERO */}
      <section style={s.hero}>
        <div style={s.brandRow}>Be Strong Again</div>
        <h1 style={s.heroTitle}>Train like you walked into my gym.</h1>
        <p style={s.heroSub}>
          Coach Glen's program in your phone. Real workouts, 1,000+ exercise
          videos, and a program that meets you where you're at — for twenty
          bucks a month.
        </p>
        <Link to={startLink('basic')} style={s.heroCta}>Start Today — $20</Link>
        <div style={s.heroNote}>Cancel anytime. First workout in under a minute.</div>
      </section>

      {/* HOW IT WORKS */}
      <section style={s.section}>
        <h2 style={s.sectionTitle}>Three steps. That's it.</h2>
        <p style={s.sectionLead}>
          No consult call. No discovery form. Sign up, pay, train.
        </p>
        <div style={s.steps}>
          <div style={s.step}>
            <div style={s.stepNum}>1</div>
            <div style={s.stepTitle}>Sign up</div>
            <div style={s.stepText}>Email, password, done.</div>
          </div>
          <div style={s.step}>
            <div style={s.stepNum}>2</div>
            <div style={s.stepTitle}>Pay $20</div>
            <div style={s.stepText}>Secure Stripe checkout. Card or wallet.</div>
          </div>
          <div style={s.step}>
            <div style={s.stepNum}>3</div>
            <div style={s.stepTitle}>Train</div>
            <div style={s.stepText}>Beginner-friendly program loads instantly.</div>
          </div>
        </div>
      </section>

      {/* WHAT YOU GET */}
      <section style={{ ...s.section, ...s.sectionAlt, maxWidth: 'none' }}>
        <div style={{ maxWidth: '960px', margin: '0 auto' }}>
          <h2 style={s.sectionTitle}>What twenty bucks gets you.</h2>
          <p style={s.sectionLead}>
            The same program I write for the people in my gym, the same form videos, the same coach. You just don't have to drive.
          </p>
          <div style={s.perks}>
            <div style={s.perk}>
              <div style={s.perkIcon}>🏋️</div>
              <div style={s.perkText}>
                <div style={s.perkTitle}>Daily Program</div>
                <div style={s.perkBody}>Built by a coach with 25 years in the gym, not an algorithm.</div>
              </div>
            </div>
            <div style={s.perk}>
              <div style={s.perkIcon}>📹</div>
              <div style={s.perkText}>
                <div style={s.perkTitle}>1,000+ Exercise Videos</div>
                <div style={s.perkBody}>Form, cues, and modifications for every move on your sheet.</div>
              </div>
            </div>
            <div style={s.perk}>
              <div style={s.perkIcon}>💬</div>
              <div style={s.perkText}>
                <div style={s.perkTitle}>Coach Glen in Chat</div>
                <div style={s.perkBody}>Stuck on a movement? Tweak a rep range? Message me. I read it.</div>
              </div>
            </div>
            <div style={s.perk}>
              <div style={s.perkIcon}>📊</div>
              <div style={s.perkText}>
                <div style={s.perkTitle}>Set-By-Set Progress</div>
                <div style={s.perkBody}>Every weight, every rep, every PR. Tracked so you can see momentum.</div>
              </div>
            </div>
            <div style={s.perk}>
              <div style={s.perkIcon}>🏃</div>
              <div style={s.perkText}>
                <div style={s.perkTitle}>Travel Workouts</div>
                <div style={s.perkBody}>On the road? Tap "Road Warrior" and you've got a session you can do anywhere.</div>
              </div>
            </div>
            <div style={s.perk}>
              <div style={s.perkIcon}>🚫</div>
              <div style={s.perkText}>
                <div style={s.perkTitle}>No Contract</div>
                <div style={s.perkBody}>Month to month. Cancel from your dashboard the second it stops working for you.</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* PRICING */}
      <section style={s.section}>
        <h2 style={s.sectionTitle}>Pick your level.</h2>
        <p style={s.sectionLead}>
          Three levels. Pick how much of me you want.
        </p>
        <div style={s.tiers}>
          <div style={s.tier}>
            <div style={s.tierName}>Basic</div>
            <div style={s.tierPrice}>$20</div>
            <div style={s.tierUnit}>per month</div>
            <div style={s.tierTagline}>"I got this. Just give me a program."</div>
            <ul style={s.tierList}>
              <li style={s.tierItem}><span style={s.tierCheck}>✓</span> Daily program built for general fitness</li>
              <li style={s.tierItem}><span style={s.tierCheck}>✓</span> Full video library + travel workouts</li>
              <li style={s.tierItem}><span style={s.tierCheck}>✓</span> Progress tracking — your numbers, your data</li>
              <li style={s.tierItem}><span style={s.tierCheck}>✓</span> Chat support when you need it (best-effort reply)</li>
              <li style={s.tierItem}><span style={s.tierCheck}>✓</span> You drive. Minimal hand-holding.</li>
            </ul>
            <Link to={startLink('basic')} style={s.tierBtn}>Start at $20</Link>
          </div>

          <div style={{ ...s.tier, ...s.tierFeatured }}>
            <div style={s.tierBadge}>Most Popular</div>
            <div style={s.tierName}>Coached</div>
            <div style={s.tierPrice}>$200</div>
            <div style={s.tierUnit}>per month</div>
            <div style={s.tierTagline}>"Build something for me — and check in now and then."</div>
            <ul style={s.tierList}>
              <li style={s.tierItem}><span style={s.tierCheck}>✓</span> Everything in Basic</li>
              <li style={s.tierItem}><span style={s.tierCheck}>✓</span><span>Program is <strong>specific to you</strong> — your goals, your sport, your conditioning, your situation</span></li>
              <li style={s.tierItem}><span style={s.tierCheck}>✓</span> Periodic check-ins and program reviews — I reach out when your numbers tell me to</li>
              <li style={s.tierItem}><span style={s.tierCheck}>✓</span> Direct chat with Coach Glen — priority response</li>
              <li style={s.tierItem}><span style={s.tierCheck}>✓</span> Form review when you ask for it</li>
            </ul>
            <Link to={startLink('coached')} style={s.tierBtn}>Get Coached</Link>
          </div>

          <div style={s.tier}>
            <div style={s.tierName}>Elite</div>
            <div style={s.tierPrice}>$400</div>
            <div style={s.tierUnit}>per month</div>
            <div style={s.tierTagline}>"In the trenches with me."</div>
            <ul style={s.tierList}>
              <li style={s.tierItem}><span style={s.tierCheck}>✓</span> Everything in Coached</li>
              <li style={s.tierItem}><span style={s.tierCheck}>✓</span><span><strong>Weekly check-ins</strong> — every week I'm in your data, your week, your training</span></li>
              <li style={s.tierItem}><span style={s.tierCheck}>✓</span> Program tweaks every week as your numbers come in</li>
              <li style={s.tierItem}><span style={s.tierCheck}>✓</span> I follow your goals closely — sport-specific, body comp, performance</li>
              <li style={s.tierItem}><span style={s.tierCheck}>✓</span> Unlimited form reviews + nutrition guidance</li>
              <li style={s.tierItem}><span style={s.tierCheck}>✓</span> 1:1 video call monthly</li>
              <li style={s.tierItem}><span style={s.tierCheck}>✓</span> Direct line — I watch your progress like an in-person client</li>
            </ul>
            <Link to={startLink('elite')} style={{ ...s.tierBtn, ...s.tierBtnQuiet }}>Go Elite</Link>
          </div>
        </div>

        {/* Budget option — tracker only, $5.99/mo. A quiet line under the tiers
            so it's findable (it's the gym-flyer tier) without competing with
            the coaching plans that lead. */}
        <div style={{ textAlign: 'center', marginTop: '20px' }}>
          <span style={{ fontSize: isMobile ? '14px' : '15px', color: '#556' }}>
            Just want to log your own workouts?{' '}
          </span>
          <Link
            to={startLink('tracker')}
            style={{ color: '#15803d', fontWeight: 800, textDecoration: 'underline', fontSize: isMobile ? '14px' : '15px' }}
          >
            Get the tracker for $5.99/mo — no coaching →
          </Link>
        </div>

        {/* Free trial — prominent. It's only a week with no card, so it's a
            low-risk top-of-funnel grab; the paid tiers above still lead. No tier
            param => no checkout, just the 1-week trial + starter program. */}
        <div style={{
          textAlign: 'center', marginTop: '36px',
          padding: isMobile ? '30px 22px' : '40px 32px',
          background: 'linear-gradient(135deg, #16a34a, #15803d)',
          borderRadius: '18px', boxShadow: '0 14px 36px rgba(22,163,74,0.28)', color: '#fff',
        }}>
          <div style={{ fontSize: '13px', fontWeight: 800, letterSpacing: '2px', textTransform: 'uppercase', opacity: 0.9, marginBottom: '8px' }}>
            No card. No catch.
          </div>
          <div style={{ fontSize: isMobile ? '28px' : '36px', fontWeight: 900, lineHeight: 1.1, marginBottom: '10px' }}>
            Try it free for a week
          </div>
          <p style={{ fontSize: isMobile ? '15px' : '17px', opacity: 0.95, maxWidth: '520px', margin: '0 auto 22px', lineHeight: 1.5 }}>
            Full tracker access and a starter program — on the house. See if it's for you before you pay a dime.
          </p>
          <Link to={`/register/${REFERRAL_CODE}`} style={{
            display: 'inline-block', padding: isMobile ? '16px 30px' : '18px 40px', borderRadius: '12px',
            background: '#fff', color: '#15803d', fontWeight: 900,
            textDecoration: 'none', fontSize: isMobile ? '17px' : '19px',
            boxShadow: '0 8px 20px rgba(0,0,0,0.18)',
          }}>Start my free week →</Link>
        </div>
      </section>

      {/* FAQ */}
      <section style={{ ...s.section, ...s.sectionAlt, maxWidth: 'none' }}>
        <div style={{ maxWidth: '700px', margin: '0 auto' }}>
          <h2 style={s.sectionTitle}>Common questions.</h2>
          <p style={s.sectionLead}>Short answers because your time is the point.</p>
          <div style={s.faq}>
            <div style={s.faqItem}>
              <div style={s.faqQ}>Can I cancel anytime?</div>
              <p style={s.faqA}>Yes. One tap in your dashboard. No call, no email, no questions.</p>
            </div>
            <div style={s.faqItem}>
              <div style={s.faqQ}>I'm brand new to working out. Is that OK?</div>
              <p style={s.faqA}>Yes. Everyone starts on Beginner Adult — a bodyweight-friendly program built for people walking back into a gym.</p>
            </div>
            <div style={s.faqItem}>
              <div style={s.faqQ}>Do I need equipment?</div>
              <p style={s.faqA}>Bare minimum is bodyweight. If you have access to a gym or a few dumbbells, you'll progress faster — but you can start with nothing.</p>
            </div>
            <div style={s.faqItem}>
              <div style={s.faqQ}>How fast can I switch tiers?</div>
              <p style={s.faqA}>Instantly, both ways. Upgrade from Basic when you're ready. Downgrade when life gets busy.</p>
            </div>
            <div style={s.faqItem}>
              <div style={s.faqQ}>Is it really Coach Glen reading my messages?</div>
              <p style={s.faqA}>Yes. Not a bot, not a VA. The platform is small because the coaching is real.</p>
            </div>
          </div>
        </div>
      </section>

      {/* CHALLENGE LEADERBOARD — public */}
      <ChallengeLeaderboard s={s} isMobile={isMobile} startLink={startLink} />

      {/* FINAL CTA */}
      <section style={s.finalBlock}>
        <h2 style={s.finalTitle}>Stop overthinking it.</h2>
        <p style={s.finalSub}>
          The first workout is twenty bucks and forty seconds from now.
        </p>
        <Link to={startLink('basic')} style={s.finalCta}>Start Today — $20</Link>
      </section>

      {/* FOOTER */}
      <footer style={s.footer}>
        Be Strong Again ·{' '}
        <Link to="/login" style={s.footerLink}>Already a member? Log in</Link>
        {' · '}
        <Link to="/become-a-coach" style={s.footerLink}>Are you a trainer? Become a coach</Link>
      </footer>
    </div>
  );
}
