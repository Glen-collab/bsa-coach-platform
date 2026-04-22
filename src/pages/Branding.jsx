// Branding.jsx — coach-facing gym branding editor.
// Gym name + logo (drag-drop, stored as base64) + 2 brand colors.
// Everything pushes to /api/coaches/brand. The TV kiosk polls /tv-config
// every 60s and applies the brand automatically — no extra wiring needed.

import { useEffect, useRef, useState } from 'react';
import { api } from '../utils/api';
import useMediaQuery from '../hooks/useMediaQuery';

const DEFAULT_PRIMARY = '#667eea';
const DEFAULT_ACCENT  = '#764ba2';
const MAX_LOGO_BYTES  = 300_000; // raw file size before base64 (~400KB base64)

const buildStyles = (isMobile) => ({
  page: { maxWidth: '900px', margin: '0 auto', padding: isMobile ? '16px 12px' : '32px 24px' },
  title: { fontSize: isMobile ? '22px' : '28px', fontWeight: '800', marginBottom: '4px' },
  sub: { fontSize: '14px', color: '#666', marginBottom: '20px', lineHeight: '1.5' },

  section: { background: '#fff', borderRadius: '14px', padding: isMobile ? '14px' : '20px', marginBottom: '16px', boxShadow: '0 2px 10px rgba(0,0,0,0.05)' },
  sectionTitle: { fontSize: isMobile ? '16px' : '18px', fontWeight: '700', color: '#1a1a2e', marginBottom: '12px' },

  field: { marginBottom: '14px' },
  label: { display: 'block', fontSize: '12px', fontWeight: '700', color: '#555', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: '6px' },
  input: { width: '100%', padding: '10px 12px', border: '1.5px solid #d1d5db', borderRadius: '8px', fontSize: '15px', boxSizing: 'border-box' },

  colorRow: { display: 'flex', alignItems: 'center', gap: '10px' },
  colorSwatch: { width: '46px', height: '46px', borderRadius: '8px', border: '1.5px solid #d1d5db', cursor: 'pointer', padding: 0 },
  colorHex: { flex: 1, padding: '10px 12px', border: '1.5px solid #d1d5db', borderRadius: '8px', fontSize: '15px', fontFamily: 'ui-monospace,Consolas,monospace' },
  colorClear: { padding: '8px 12px', border: '1px solid #d1d5db', background: '#fff', borderRadius: '8px', fontSize: '12px', color: '#555', cursor: 'pointer' },

  drop: {
    border: '2px dashed #a3aed0', borderRadius: '12px', padding: '30px',
    textAlign: 'center', color: '#555', background: '#f7f8fc', cursor: 'pointer',
    transition: 'border-color .15s, background .15s',
  },
  dropActive: { borderColor: '#667eea', background: '#eef0ff' },
  dropHint: { fontSize: '13px', color: '#888', marginTop: '8px' },

  logoPreview: { display: 'flex', alignItems: 'center', gap: '14px', marginTop: '10px' },
  logoImg: { maxWidth: '120px', maxHeight: '80px', objectFit: 'contain', background: '#1a1a2e', padding: '10px', borderRadius: '8px' },
  logoRemove: { padding: '6px 12px', border: '1px solid #e5e7eb', background: '#fff', borderRadius: '8px', fontSize: '13px', cursor: 'pointer', color: '#b91c1c' },

  // Live preview panel — mimics the TV header bar
  previewWrap: { marginTop: '18px' },
  previewHeader: {
    display: 'flex', alignItems: 'center', gap: '14px',
    padding: '18px 20px', borderRadius: '12px',
    background: '#0f0c29',
    minHeight: '78px', overflow: 'hidden',
  },
  previewLogo: { maxHeight: '50px', maxWidth: '120px', objectFit: 'contain' },
  previewName: { color: '#fff', fontSize: '22px', fontWeight: '800', letterSpacing: '0.2px' },
  previewPill: { display: 'inline-block', padding: '4px 10px', borderRadius: '999px', fontSize: '12px', fontWeight: '700' },

  saveRow: { display: 'flex', gap: '10px', marginTop: '18px' },
  saveBtn: {
    flex: 1, padding: '13px', border: 'none', borderRadius: '10px',
    background: 'linear-gradient(135deg, #667eea, #764ba2)', color: '#fff',
    fontSize: '16px', fontWeight: '700', cursor: 'pointer',
  },
  saveBtnBusy: { opacity: 0.7, cursor: 'wait' },
  note: { fontSize: '12px', color: '#888', marginTop: '8px' },
});

function isHex(v) { return /^#[0-9a-fA-F]{6}$/.test(v || ''); }

export default function Branding() {
  const isMobile = useMediaQuery('(max-width: 720px)');
  const s = buildStyles(isMobile);

  const [gymName, setGymName] = useState('');
  const [logoData, setLogoData] = useState(null); // full `data:image/...;base64,...`
  const [primary, setPrimary] = useState('');
  const [accent, setAccent] = useState('');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await api.getBrand();
        setGymName(r.gym_name || '');
        setLogoData(r.logo_data || null);
        setPrimary(r.primary || '');
        setAccent(r.accent || '');
      } catch (e) {
        setMsg('Failed to load brand: ' + (e.message || 'error'));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const readFile = (file) => {
    if (!file) return;
    if (!/^image\/(png|jpe?g|svg\+xml|webp)$/.test(file.type)) {
      setMsg('Logo must be PNG, JPG, SVG, or WebP.');
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      setMsg(`Logo too big (${Math.round(file.size / 1024)}KB). Max ~300KB — crop or export smaller.`);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => { setLogoData(reader.result); setMsg(''); };
    reader.onerror = () => setMsg('Failed to read file.');
    reader.readAsDataURL(file);
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragActive(false);
    const f = e.dataTransfer?.files?.[0];
    if (f) readFile(f);
  };

  const save = async () => {
    if (primary && !isHex(primary)) { setMsg('Primary must be #RRGGBB hex.'); return; }
    if (accent && !isHex(accent))   { setMsg('Accent must be #RRGGBB hex.');   return; }
    setSaving(true); setMsg('');
    try {
      await api.setBrand({
        gym_name: gymName,
        logo_data: logoData,
        primary,
        accent,
      });
      setMsg('Saved — your TV will update within 60 seconds.');
    } catch (e) {
      setMsg('Save failed: ' + (e.message || 'error'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div style={{ padding: 30 }}>Loading branding…</div>;

  const effPrimary = primary || DEFAULT_PRIMARY;
  const effAccent  = accent  || DEFAULT_ACCENT;

  return (
    <div style={s.page}>
      <h1 style={s.title}>Gym Branding</h1>
      <p style={s.sub}>
        Customize how your gym's TV kiosk looks — logo, colors, and gym name.
        Changes push to every Pi assigned to you within 60 seconds.
        Leave a field blank to fall back to the default BSA look.
      </p>

      {/* Gym name */}
      <div style={s.section}>
        <div style={s.sectionTitle}>Gym Name</div>
        <div style={s.field}>
          <label style={s.label}>Display Name</label>
          <input
            style={s.input}
            type="text"
            placeholder="e.g., Glen's MA Academy"
            value={gymName}
            onChange={(e) => setGymName(e.target.value.slice(0, 120))}
          />
        </div>
      </div>

      {/* Logo */}
      <div style={s.section}>
        <div style={s.sectionTitle}>Logo</div>
        <div
          style={{ ...s.drop, ...(dragActive ? s.dropActive : {}) }}
          onClick={() => fileInputRef.current?.click()}
          onDragEnter={(e) => { e.preventDefault(); setDragActive(true); }}
          onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
          onDragLeave={() => setDragActive(false)}
          onDrop={onDrop}
        >
          {logoData
            ? <span>Drop a new file or click to replace</span>
            : <span>Drag-drop logo here, or click to browse</span>}
          <div style={s.dropHint}>PNG / JPG / SVG / WebP, max ~300KB</div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/svg+xml,image/webp"
            style={{ display: 'none' }}
            onChange={(e) => readFile(e.target.files?.[0])}
          />
        </div>
        {logoData && (
          <div style={s.logoPreview}>
            <img src={logoData} alt="Logo" style={s.logoImg} />
            <button style={s.logoRemove} onClick={() => setLogoData(null)}>Remove</button>
          </div>
        )}
      </div>

      {/* Colors */}
      <div style={s.section}>
        <div style={s.sectionTitle}>Brand Colors</div>
        <div style={s.field}>
          <label style={s.label}>Primary</label>
          <div style={s.colorRow}>
            <input style={s.colorSwatch} type="color" value={effPrimary} onChange={(e) => setPrimary(e.target.value)} />
            <input style={s.colorHex} type="text" placeholder="#667eea" value={primary} onChange={(e) => setPrimary(e.target.value)} />
            {primary && <button style={s.colorClear} onClick={() => setPrimary('')}>Clear</button>}
          </div>
        </div>
        <div style={s.field}>
          <label style={s.label}>Accent</label>
          <div style={s.colorRow}>
            <input style={s.colorSwatch} type="color" value={effAccent} onChange={(e) => setAccent(e.target.value)} />
            <input style={s.colorHex} type="text" placeholder="#764ba2" value={accent} onChange={(e) => setAccent(e.target.value)} />
            {accent && <button style={s.colorClear} onClick={() => setAccent('')}>Clear</button>}
          </div>
        </div>
      </div>

      {/* Preview */}
      <div style={s.section}>
        <div style={s.sectionTitle}>Preview</div>
        <div style={s.previewWrap}>
          <div style={{
            ...s.previewHeader,
            background: `linear-gradient(135deg, ${effPrimary}, ${effAccent})`,
          }}>
            {logoData && <img src={logoData} alt="Logo" style={s.previewLogo} />}
            <div style={s.previewName}>
              {gymName || 'Your Gym Name'}
            </div>
          </div>
          <div style={s.note}>This is how the header strip will look on the TV.</div>
        </div>
      </div>

      <div style={s.saveRow}>
        <button
          style={{ ...s.saveBtn, ...(saving ? s.saveBtnBusy : {}) }}
          onClick={save}
          disabled={saving}
        >
          {saving ? 'Saving…' : 'Save Branding'}
        </button>
      </div>
      {msg && <div style={{ ...s.note, color: msg.startsWith('Saved') ? '#065f46' : '#b91c1c' }}>{msg}</div>}
    </div>
  );
}
