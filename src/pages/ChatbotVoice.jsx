// ChatbotVoice.jsx — coach-facing form for white-label chatbot persona.
// Edits a row in users.chatbot_config (JSONB). Empty / unset config = the
// default Glen voice. Filling it out makes the BSA chatbot speak as this
// coach for ALL their clients (Workout Tracker chat + Trainer Dashboard
// AI summaries + future surfaces).

import { useEffect, useState } from 'react';
import { api } from '../utils/api';
import useMediaQuery from '../hooks/useMediaQuery';

const buildStyles = (isMobile) => ({
  page: { maxWidth: '900px', margin: '0 auto', padding: isMobile ? '16px 12px' : '32px 24px' },
  title: { fontSize: isMobile ? '22px' : '28px', fontWeight: '800', marginBottom: '4px' },
  sub: { fontSize: '14px', color: '#666', marginBottom: '20px', lineHeight: '1.5' },

  section: { background: '#fff', borderRadius: '14px', padding: isMobile ? '14px' : '20px', marginBottom: '16px', boxShadow: '0 2px 10px rgba(0,0,0,0.05)' },
  sectionTitle: { fontSize: isMobile ? '16px' : '18px', fontWeight: '700', color: '#1a1a2e', marginBottom: '4px' },
  sectionHelp: { fontSize: '13px', color: '#666', marginBottom: '14px', lineHeight: '1.45' },

  field: { marginBottom: '14px' },
  label: { display: 'block', fontSize: '12px', fontWeight: '700', color: '#555', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: '6px' },
  hint: { fontSize: '12px', color: '#888', marginTop: '4px' },
  input: { width: '100%', padding: '10px 12px', border: '1.5px solid #d1d5db', borderRadius: '8px', fontSize: '15px', boxSizing: 'border-box', fontFamily: 'inherit' },
  textarea: { width: '100%', padding: '10px 12px', border: '1.5px solid #d1d5db', borderRadius: '8px', fontSize: '14px', boxSizing: 'border-box', fontFamily: 'inherit', resize: 'vertical', minHeight: '110px', lineHeight: '1.45' },

  toggleRow: { display: 'flex', alignItems: 'flex-start', gap: '10px', padding: '10px 12px', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '10px', marginBottom: '10px' },
  toggleBox: { width: '20px', height: '20px', flexShrink: 0, marginTop: '2px' },
  toggleText: { flex: 1, fontSize: '13px', color: '#1a1a2e', lineHeight: '1.4' },
  toggleTitle: { fontWeight: '700' },
  toggleHelp: { fontSize: '12px', color: '#666', marginTop: '2px' },

  saveRow: { display: 'flex', gap: '10px', marginTop: '18px' },
  saveBtn: {
    flex: 1, padding: '13px', border: 'none', borderRadius: '10px',
    background: 'linear-gradient(135deg, #667eea, #764ba2)', color: '#fff',
    fontSize: '16px', fontWeight: '700', cursor: 'pointer',
  },
  saveBtnBusy: { opacity: 0.7, cursor: 'wait' },
  msg: { padding: '10px 12px', borderRadius: '8px', fontSize: '13px', marginTop: '10px' },
  msgOk: { background: '#ecfdf5', color: '#065f46' },
  msgErr: { background: '#fef2f2', color: '#b91c1c' },
});

export default function ChatbotVoice() {
  const isMobile = useMediaQuery('(max-width: 720px)');
  const s = buildStyles(isMobile);

  const [voiceName, setVoiceName] = useState('');
  const [gymName, setGymName]     = useState('');
  const [singleCoach, setSingleCoach] = useState(true);
  const [secName, setSecName]     = useState('');
  const [secRole, setSecRole]     = useState('');
  const [bizUrl, setBizUrl]       = useState('');
  const [bizPitch, setBizPitch]   = useState('');
  const [philosophy, setPhilosophy] = useState('');
  const [advocare, setAdvocare]   = useState(false);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [msg, setMsg]         = useState({ kind: '', text: '' });

  useEffect(() => {
    (async () => {
      try {
        const c = await api.getChatbotConfig();
        setVoiceName(c.coach_voice_name || '');
        setGymName(c.gym_name || '');
        setSingleCoach(c.single_coach !== false);
        setSecName(c.secondary_coach_name || '');
        setSecRole(c.secondary_coach_role || '');
        setBizUrl(c.business_url || '');
        setBizPitch(c.business_pitch || '');
        setPhilosophy(c.coach_philosophy || '');
        setAdvocare(!!c.advocare_enabled);
      } catch (e) {
        setMsg({ kind: 'err', text: e.message || 'Could not load config.' });
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function save() {
    setSaving(true);
    setMsg({ kind: '', text: '' });
    try {
      await api.setChatbotConfig({
        coach_voice_name: voiceName,
        gym_name: gymName,
        single_coach: singleCoach,
        secondary_coach_name: singleCoach ? '' : secName,
        secondary_coach_role: singleCoach ? '' : secRole,
        business_url: bizUrl,
        business_pitch: bizPitch,
        coach_philosophy: philosophy,
        advocare_enabled: advocare,
      });
      setMsg({ kind: 'ok', text: 'Saved. Your clients will see this voice on their next chat.' });
    } catch (e) {
      setMsg({ kind: 'err', text: e.message || 'Could not save.' });
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: '#888' }}>Loading…</div>;

  return (
    <div style={s.page}>
      <div style={s.title}>Chatbot Voice</div>
      <div style={s.sub}>
        Customize how the BSA chatbot speaks to your clients. Leave anything blank to fall back
        to defaults. Saved settings apply to the Workout Tracker chat your clients see and the
        AI summaries you generate from the Trainer Dashboard.
      </div>

      <div style={s.section}>
        <div style={s.sectionTitle}>Who's speaking</div>
        <div style={s.sectionHelp}>The name your clients will see when the bot replies.</div>

        <div style={s.field}>
          <label style={s.label}>Coach voice name</label>
          <input
            style={s.input}
            value={voiceName}
            onChange={(e) => setVoiceName(e.target.value)}
            placeholder="e.g. Coach Steve"
            maxLength={60}
          />
          <div style={s.hint}>This is how the bot signs off and refers to itself.</div>
        </div>

        <div style={s.field}>
          <label style={s.label}>Gym name <span style={{ fontWeight: 400, color: '#888' }}>(optional)</span></label>
          <input
            style={s.input}
            value={gymName}
            onChange={(e) => setGymName(e.target.value)}
            placeholder="e.g. Steve's Strength Lab"
            maxLength={120}
          />
        </div>

        <div style={s.toggleRow}>
          <input
            type="checkbox"
            checked={singleCoach}
            onChange={(e) => setSingleCoach(e.target.checked)}
            style={s.toggleBox}
            id="single-coach-toggle"
          />
          <div style={s.toggleText}>
            <span style={s.toggleTitle}>Single coach mode</span>
            <div style={s.toggleHelp}>
              On = every reply speaks in your voice. Off = you can add a second coach below
              (training questions go to you, their lane goes to them).
            </div>
          </div>
        </div>

        {!singleCoach && (
          <>
            <div style={s.field}>
              <label style={s.label}>Partner / second coach name</label>
              <input
                style={s.input}
                value={secName}
                onChange={(e) => setSecName(e.target.value)}
                placeholder="e.g. Ali"
                maxLength={60}
              />
            </div>
            <div style={s.field}>
              <label style={s.label}>Partner's lane</label>
              <input
                style={s.input}
                value={secRole}
                onChange={(e) => setSecRole(e.target.value)}
                placeholder="e.g. nutrition + AdvoCare"
                maxLength={120}
              />
            </div>
          </>
        )}
      </div>

      <div style={s.section}>
        <div style={s.sectionTitle}>Where to send clients</div>
        <div style={s.sectionHelp}>
          When the chatbot recommends ordering or signing up for something,
          this is the link it points at.
        </div>

        <div style={s.field}>
          <label style={s.label}>Business URL <span style={{ fontWeight: 400, color: '#888' }}>(optional)</span></label>
          <input
            style={s.input}
            value={bizUrl}
            onChange={(e) => setBizUrl(e.target.value)}
            placeholder="https://your-site.com"
            maxLength={300}
          />
        </div>

        <div style={s.field}>
          <label style={s.label}>One-line pitch</label>
          <input
            style={s.input}
            value={bizPitch}
            onChange={(e) => setBizPitch(e.target.value)}
            placeholder="e.g. 1-on-1 strength training packages"
            maxLength={300}
          />
        </div>

        <div style={s.toggleRow}>
          <input
            type="checkbox"
            checked={advocare}
            onChange={(e) => setAdvocare(e.target.checked)}
            style={s.toggleBox}
            id="advocare-toggle"
          />
          <div style={s.toggleText}>
            <span style={s.toggleTitle}>I also sell AdvoCare</span>
            <div style={s.toggleHelp}>
              Enables the PC pitch + basket card logic for nutrition questions.
              Leave off if AdvoCare isn't part of your business.
            </div>
          </div>
        </div>
      </div>

      <div style={s.section}>
        <div style={s.sectionTitle}>Your coaching voice</div>
        <div style={s.sectionHelp}>
          A short paragraph the model uses to sound like you. Plain text — your philosophy,
          how you talk to clients, signature phrases. Skip if you're not sure; the bot will
          default to a direct, no-nonsense training voice.
        </div>
        <textarea
          style={s.textarea}
          value={philosophy}
          onChange={(e) => setPhilosophy(e.target.value)}
          placeholder="e.g. Direct, no fluff. I tell clients the truth about progress — show up consistently, train hard, and you'll see the work pay off. I focus on form first, then load. I write like I talk in the gym."
          maxLength={2000}
        />
        <div style={s.hint}>{philosophy.length} / 2000</div>
      </div>

      <div style={s.saveRow}>
        <button
          style={{ ...s.saveBtn, ...(saving ? s.saveBtnBusy : {}) }}
          onClick={save}
          disabled={saving || !voiceName.trim()}
        >
          {saving ? 'Saving…' : 'Save chatbot voice'}
        </button>
      </div>

      {msg.text && (
        <div style={{ ...s.msg, ...(msg.kind === 'ok' ? s.msgOk : s.msgErr) }}>
          {msg.text}
        </div>
      )}
    </div>
  );
}
