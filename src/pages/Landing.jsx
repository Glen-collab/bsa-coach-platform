import { Link } from 'react-router-dom';

const s = {
  hero: { background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)', padding: '80px 24px', textAlign: 'center', color: '#fff' },
  heroTitle: { fontSize: 'clamp(28px, 5vw, 48px)', fontWeight: '800', marginBottom: '16px', lineHeight: '1.2' },
  heroSub: { fontSize: '18px', color: '#aaa', maxWidth: '600px', margin: '0 auto 32px', lineHeight: '1.6' },
  heroCta: { display: 'inline-block', padding: '16px 40px', background: 'linear-gradient(135deg, #B37602, #8a5b00)', color: '#fff', borderRadius: '12px', fontSize: '18px', fontWeight: '700', textDecoration: 'none' },
  section: { maxWidth: '960px', margin: '0 auto', padding: '60px 24px' },
  sectionTitle: { fontSize: '28px', fontWeight: '700', textAlign: 'center', marginBottom: '40px', color: '#1a1a2e' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '24px' },
  card: { background: '#fff', borderRadius: '16px', padding: '32px 24px', textAlign: 'center', boxShadow: '0 4px 20px rgba(0,0,0,0.08)', border: '2px solid #f0f0f0', transition: 'transform 0.2s, box-shadow 0.2s' },
  cardFeatured: { border: '2px solid #B37602', position: 'relative' },
  badge: { position: 'absolute', top: '-12px', left: '50%', transform: 'translateX(-50%)', background: '#B37602', color: '#fff', padding: '4px 16px', borderRadius: '20px', fontSize: '12px', fontWeight: '700' },
  cardTitle: { fontSize: '22px', fontWeight: '700', marginBottom: '4px' },
  cardPrice: { fontSize: '36px', fontWeight: '800', color: '#B37602', margin: '12px 0 4px' },
  cardInterval: { fontSize: '14px', color: '#888', marginBottom: '20px' },
  featureList: { listStyle: 'none', padding: 0, textAlign: 'left', marginBottom: '24px' },
  featureItem: { padding: '8px 0', fontSize: '14px', color: '#555', borderBottom: '1px solid #f0f0f0' },
  cardBtn: { display: 'inline-block', padding: '14px 32px', borderRadius: '10px', fontSize: '15px', fontWeight: '600', textDecoration: 'none', width: '100%', textAlign: 'center' },
  gold: { background: 'linear-gradient(135deg, #B37602, #8a5b00)', color: '#fff' },
  outline: { background: 'transparent', color: '#B37602', border: '2px solid #B37602' },
  howSection: { background: '#fff', padding: '60px 24px' },
  steps: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '32px', maxWidth: '800px', margin: '0 auto' },
  step: { textAlign: 'center' },
  stepNum: { width: '48px', height: '48px', borderRadius: '50%', background: '#B37602', color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px', fontWeight: '700', marginBottom: '12px' },
  stepTitle: { fontSize: '16px', fontWeight: '600', marginBottom: '6px' },
  stepText: { fontSize: '13px', color: '#777', lineHeight: '1.5' },
};

const tiers = [
  {
    name: 'Basic',
    price: '$20',
    features: [
      'Access to workout programs',
      'Exercise video library (950+ videos)',
      'Progress tracking',
      'Community Discord access',
      'Mobile-friendly app',
    ],
  },
  {
    name: 'Coached',
    price: '$200',
    featured: true,
    features: [
      'Everything in Basic',
      'Dedicated personal coach',
      'Custom-built programs',
      'Weekly video feedback',
      'Direct messaging with coach',
      'Program adjustments as you progress',
    ],
  },
  {
    name: 'Elite',
    price: '$400',
    features: [
      'Everything in Coached',
      '1-on-1 programming',
      'Unlimited video reviews',
      'Competition prep support',
      'Nutrition guidance',
      'Priority scheduling',
    ],
  },
];

export default function Landing() {
  return (
    <>
      {/* Hero */}
      <div style={s.hero}>
        <h1 style={s.heroTitle}>Train Smarter. Coach Better.</h1>
        <p style={s.heroSub}>
          Personalized training programs, exercise video coaching, and a platform that lets coaches build their business while clients build their strength.
        </p>
        <Link to="/register" style={s.heroCta}>Start Your Journey</Link>
      </div>

      {/* Pricing */}
      <div style={s.section}>
        <h2 style={s.sectionTitle}>Choose Your Path</h2>
        <div style={s.grid}>
          {tiers.map((tier) => (
            <div key={tier.name} style={{ ...s.card, ...(tier.featured ? s.cardFeatured : {}) }}>
              {tier.featured && <div style={s.badge}>Most Popular</div>}
              <div style={s.cardTitle}>{tier.name}</div>
              <div style={s.cardPrice}>{tier.price}</div>
              <div style={s.cardInterval}>per month</div>
              <ul style={s.featureList}>
                {tier.features.map((f, i) => (
                  <li key={i} style={s.featureItem}>{f}</li>
                ))}
              </ul>
              <Link
                to="/register"
                style={{ ...s.cardBtn, ...(tier.featured ? s.gold : s.outline) }}
              >
                Get Started
              </Link>
            </div>
          ))}
        </div>
      </div>

      {/* How It Works */}
      <div style={s.howSection}>
        <h2 style={{ ...s.sectionTitle, marginBottom: '40px' }}>How It Works</h2>
        <div style={s.steps}>
          <div style={s.step}>
            <div style={s.stepNum}>1</div>
            <div style={s.stepTitle}>Sign Up</div>
            <div style={s.stepText}>Create your account and choose a plan that fits your goals.</div>
          </div>
          <div style={s.step}>
            <div style={s.stepNum}>2</div>
            <div style={s.stepTitle}>Get Matched</div>
            <div style={s.stepText}>Coached and Elite members get paired with a certified trainer.</div>
          </div>
          <div style={s.step}>
            <div style={s.stepNum}>3</div>
            <div style={s.stepTitle}>Train</div>
            <div style={s.stepText}>Follow your program, track your lifts, watch coaching videos.</div>
          </div>
          <div style={s.step}>
            <div style={s.stepNum}>4</div>
            <div style={s.stepTitle}>Grow</div>
            <div style={s.stepText}>Love it? Become a coach and build your own team.</div>
          </div>
        </div>
      </div>

      {/* Coach CTA */}
      <div style={{ ...s.section, textAlign: 'center' }}>
        <h2 style={s.sectionTitle}>Are You a Coach?</h2>
        <p style={{ fontSize: '16px', color: '#666', maxWidth: '500px', margin: '0 auto 24px', lineHeight: '1.6' }}>
          Build your business on our platform. Get your own referral link, earn commissions on every sign-up, and manage your clients from one dashboard.
        </p>
        <Link to="/register" style={{ ...s.heroCta, fontSize: '16px', padding: '14px 32px' }}>Apply as Coach</Link>
      </div>

      {/* Footer */}
      <div style={{ background: '#1a1a2e', padding: '24px', textAlign: 'center', color: '#666', fontSize: '13px' }}>
        Be Strong Again &middot; bestrongagain.com
      </div>
    </>
  );
}
