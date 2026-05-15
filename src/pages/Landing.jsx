// Member-facing landing / get-started page. Visually mirrors
// MemberDashboard so a paying customer feels they're already inside the
// product after one tap of "Start Today". Single scroll, hero above the
// fold, every CTA → /register/GLENM7NUS?tier=basic (or coached/elite).
//
// Coach-recruitment pitch is preserved at /become-a-coach (CoachPitch.jsx).

import { Link } from 'react-router-dom';
import useMediaQuery from '../hooks/useMediaQuery';

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
  tierUnit: { fontSize: '13px', color: '#888', textAlign: 'center', marginBottom: '18px' },
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
          videos, and message me direct — for twenty bucks a month.
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
          Most people start at Basic. Upgrade anytime when you want more of my time.
        </p>
        <div style={s.tiers}>
          <div style={s.tier}>
            <div style={s.tierName}>Basic</div>
            <div style={s.tierPrice}>$20</div>
            <div style={s.tierUnit}>per month</div>
            <ul style={s.tierList}>
              <li style={s.tierItem}><span style={s.tierCheck}>✓</span> Daily program</li>
              <li style={s.tierItem}><span style={s.tierCheck}>✓</span> Full video library</li>
              <li style={s.tierItem}><span style={s.tierCheck}>✓</span> Chat with Coach Glen</li>
              <li style={s.tierItem}><span style={s.tierCheck}>✓</span> Progress tracking</li>
              <li style={s.tierItem}><span style={s.tierCheck}>✓</span> Travel workouts</li>
            </ul>
            <Link to={startLink('basic')} style={s.tierBtn}>Start with Basic</Link>
          </div>

          <div style={{ ...s.tier, ...s.tierFeatured }}>
            <div style={s.tierBadge}>Most Popular</div>
            <div style={s.tierName}>Coached</div>
            <div style={s.tierPrice}>$200</div>
            <div style={s.tierUnit}>per month</div>
            <ul style={s.tierList}>
              <li style={s.tierItem}><span style={s.tierCheck}>✓</span> Everything in Basic</li>
              <li style={s.tierItem}><span style={s.tierCheck}>✓</span> Weekly coach check-in</li>
              <li style={s.tierItem}><span style={s.tierCheck}>✓</span> Program tweaks to fit your life</li>
              <li style={s.tierItem}><span style={s.tierCheck}>✓</span> Form review on submitted clips</li>
              <li style={s.tierItem}><span style={s.tierCheck}>✓</span> Priority chat response</li>
            </ul>
            <Link to={startLink('coached')} style={s.tierBtn}>Get Coached</Link>
          </div>

          <div style={s.tier}>
            <div style={s.tierName}>Elite</div>
            <div style={s.tierPrice}>$400</div>
            <div style={s.tierUnit}>per month</div>
            <ul style={s.tierList}>
              <li style={s.tierItem}><span style={s.tierCheck}>✓</span> Everything in Coached</li>
              <li style={s.tierItem}><span style={s.tierCheck}>✓</span> Unlimited form reviews</li>
              <li style={s.tierItem}><span style={s.tierCheck}>✓</span> Nutrition guidance</li>
              <li style={s.tierItem}><span style={s.tierCheck}>✓</span> 1:1 video call monthly</li>
              <li style={s.tierItem}><span style={s.tierCheck}>✓</span> Custom programming</li>
            </ul>
            <Link to={startLink('elite')} style={{ ...s.tierBtn, ...s.tierBtnQuiet }}>Go Elite</Link>
          </div>
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
