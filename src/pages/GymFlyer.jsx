import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import QRCode from 'qrcode';
import { useAuth } from '../hooks/useAuth';

// Printable gym flyer for the $5.99 "Tracker Only" tier. Each coach gets their
// OWN flyer — the QR + link carry their referral code, so sign-ups credit them.
// Screen view has a Print button + controls; @media print strips everything
// except the flyer itself (one clean Letter page).
export default function GymFlyer() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const code = user?.referral_code || '';
  const link = `${window.location.origin}/register/${code}?tier=tracker`;
  const linkLabel = `${window.location.host}/register/${code}?tier=tracker`;
  const [qr, setQr] = useState('');

  useEffect(() => {
    if (!code) return;
    QRCode.toDataURL(link, { errorCorrectionLevel: 'H', margin: 1, width: 900, color: { dark: '#14532d', light: '#ffffff' } })
      .then(setQr)
      .catch(() => setQr(''));
  }, [link, code]);

  return (
    <div style={st.screen}>
      {/* Print-only CSS: hide chrome, show just the flyer at full page. */}
      <style>{`
        @media print {
          @page { size: letter; margin: 0; }
          html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; }
          .no-print { display: none !important; }
          /* Pin the flyer to one exact Letter page and undo the screen-only
             scale — otherwise mobile "Save as PDF" can apply the 0.86 transform
             and print it shrunk/shifted. overflow:hidden guarantees one page. */
          .flyer {
            box-shadow: none !important;
            margin: 0 !important;
            transform: none !important;
            width: 8.5in !important;
            height: 11in !important;
            overflow: hidden !important;
          }
        }
        @media screen { .flyer { transform: scale(0.86); transform-origin: top center; } }
      `}</style>

      <div className="no-print" style={st.bar}>
        <button onClick={() => navigate(-1)} style={st.back}>← Back</button>
        <div style={st.barTitle}>Your Gym Flyer</div>
        <button onClick={() => window.print()} style={st.print} disabled={!qr}>🖨️ Print / Save PDF</button>
      </div>

      {!code && (
        <div className="no-print" style={st.warn}>
          No referral code on your account yet — contact the admin so your flyer can credit your sign-ups.
        </div>
      )}

      {/* The flyer — Letter sized */}
      <div className="flyer" style={st.page}>
        <div style={st.brand}>Be Strong Again</div>
        <div style={st.exclusive}>★ Gym Members Only</div>
        <h1 style={st.h1}>Track Every<br />Workout</h1>
        <div style={st.price}><b style={st.priceBig}>$5.99</b>/month</div>
        <p style={st.sub}>Your own workout log — no coaching, just the app.</p>

        <div style={st.card}>
          <div style={st.scan}>Scan to Sign Up</div>
          {qr
            ? <img src={qr} alt="Sign-up QR code" style={st.qr} />
            : <div style={{ ...st.qr, display: 'grid', placeItems: 'center', color: '#9ca3af' }}>Generating…</div>}
          <div style={st.url}>{linkLabel}</div>
        </div>

        <ul style={st.bullets}>
          {[
            'Log every set, rep, and weight — right from your phone',
            'Watch your numbers and progress climb over time',
            'Full exercise video library built in',
            'Works on any phone — nothing to install',
            'Just $5.99/mo. Cancel anytime.',
          ].map((t) => (
            <li key={t} style={st.li}><span style={st.check}>✓</span>{t}</li>
          ))}
        </ul>

        <div style={st.foot}>
          Scan with your phone camera to get started
          <small style={st.footSmall}>Ask the front desk if you need a hand.</small>
        </div>
      </div>
    </div>
  );
}

const st = {
  screen: { minHeight: '100vh', background: '#eef1f4', paddingBottom: '40px' },
  bar: { position: 'sticky', top: 0, zIndex: 5, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', padding: '12px 16px', background: '#fff', boxShadow: '0 2px 10px rgba(0,0,0,0.08)' },
  barTitle: { fontWeight: 800, fontSize: '15px', color: '#333' },
  back: { background: 'none', border: 'none', color: '#667eea', fontWeight: 700, fontSize: '15px', cursor: 'pointer' },
  print: { background: 'linear-gradient(135deg, #16a34a, #15803d)', color: '#fff', border: 'none', borderRadius: '10px', padding: '10px 16px', fontWeight: 800, fontSize: '14px', cursor: 'pointer' },
  warn: { maxWidth: '600px', margin: '16px auto', background: '#fef3c7', border: '1px solid #fde68a', color: '#92400e', padding: '12px 16px', borderRadius: '10px', fontSize: '14px', textAlign: 'center' },

  page: { width: '8.5in', minHeight: '11in', margin: '20px auto', padding: '0.6in 0.7in', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', boxSizing: 'border-box', WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact', fontFamily: "'Segoe UI', Arial, sans-serif", boxShadow: '0 18px 50px rgba(0,0,0,0.18)', background: 'linear-gradient(160deg, #16a34a 0%, #15803d 42%, #ffffff 42%, #ffffff 100%)' },
  brand: { color: '#eafff0', fontSize: '15px', fontWeight: 800, letterSpacing: '4px', textTransform: 'uppercase', marginBottom: '6px' },
  exclusive: { display: 'inline-block', background: '#0b3d23', color: '#fff', fontSize: '12px', fontWeight: 800, letterSpacing: '2px', padding: '6px 14px', borderRadius: '999px', textTransform: 'uppercase', marginBottom: '14px' },
  h1: { color: '#fff', fontSize: '44px', fontWeight: 900, margin: '2px 0 4px', lineHeight: 1.05 },
  price: { color: '#eafff0', fontSize: '22px', fontWeight: 800, marginBottom: '2px' },
  priceBig: { fontSize: '30px', color: '#fff' },
  sub: { color: '#dffbe8', fontSize: '16px', margin: '0 0 18px' },
  card: { background: '#fff', borderRadius: '22px', boxShadow: '0 18px 50px rgba(0,0,0,0.22)', padding: '26px', width: '100%', maxWidth: '5.3in', marginTop: '4px' },
  scan: { color: '#15803d', fontSize: '20px', fontWeight: 900, letterSpacing: '1px', margin: '0 0 12px', textTransform: 'uppercase' },
  qr: { width: '3.1in', height: '3.1in', display: 'block', margin: '0 auto' },
  url: { fontFamily: "'Consolas', monospace", fontSize: '12px', color: '#6b7280', marginTop: '12px', wordBreak: 'break-all' },
  bullets: { textAlign: 'left', maxWidth: '5.3in', width: '100%', margin: '22px auto 0', padding: 0 },
  li: { fontSize: '16px', color: '#14532d', margin: '9px 0', listStyle: 'none', paddingLeft: '30px', position: 'relative', fontWeight: 600 },
  check: { position: 'absolute', left: 0, top: '-1px', color: '#16a34a', fontWeight: 900, fontSize: '18px' },
  foot: { marginTop: 'auto', paddingTop: '24px', color: '#15803d', fontSize: '13px', fontWeight: 700 },
  footSmall: { display: 'block', color: '#9ca3af', fontWeight: 500, marginTop: '3px' },
};
