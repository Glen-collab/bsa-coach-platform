// ProposeExerciseModal.jsx — coach suggests a new exercise not in the bundled library.
// Submits to /api/media/custom-exercises (status=pending). Admin reviews + approves.

import { useState } from 'react';
import { api } from '../utils/api';

const s = {
  backdrop: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '16px' },
  modal: { background: '#fff', borderRadius: '14px', padding: '20px', maxWidth: '480px', width: '100%', display: 'flex', flexDirection: 'column', gap: '12px', boxShadow: '0 10px 40px rgba(0,0,0,0.2)' },
  title: { fontSize: '20px', fontWeight: '800', color: '#1a1a2e', marginBottom: '4px' },
  sub: { fontSize: '13px', color: '#666' },
  label: { fontSize: '12px', fontWeight: '600', color: '#444', marginBottom: '4px', textTransform: 'uppercase' },
  input: { padding: '10px 12px', border: '1px solid #d1d5db', borderRadius: '8px', fontSize: '14px', width: '100%', boxSizing: 'border-box' },
  textarea: { padding: '10px 12px', border: '1px solid #d1d5db', borderRadius: '8px', fontSize: '14px', width: '100%', boxSizing: 'border-box', minHeight: '72px', resize: 'vertical', fontFamily: 'inherit' },
  select: { padding: '10px 12px', border: '1px solid #d1d5db', borderRadius: '8px', fontSize: '14px', width: '100%', boxSizing: 'border-box', background: '#fff' },
  buttons: { display: 'flex', gap: '10px', marginTop: '8px', justifyContent: 'flex-end', flexWrap: 'wrap' },
  btn: { padding: '10px 18px', borderRadius: '8px', border: 'none', fontSize: '14px', fontWeight: '600', cursor: 'pointer', minHeight: '44px' },
  btnPrimary: { background: 'linear-gradient(135deg, #B37602, #8a5b00)', color: '#fff' },
  btnDisabled: { background: '#d1d5db', color: '#fff', cursor: 'not-allowed' },
  btnSecondary: { background: '#e5e7eb', color: '#333' },
  error: { background: '#fee2e2', color: '#991b1b', padding: '8px', borderRadius: '6px', fontSize: '13px' },
  success: { background: '#d1fae5', color: '#065f46', padding: '8px', borderRadius: '6px', fontSize: '13px' },
};

export default function ProposeExerciseModal({ onClose, onSubmitted }) {
  const [name, setName] = useState('');
  const [library, setLibrary] = useState('custom');
  const [category, setCategory] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);
  const [done, setDone] = useState(false);

  const canSubmit = name.trim().length >= 2 && !saving;

  const submit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    setErr(null);
    try {
      await api.proposeExercise({
        name: name.trim(),
        source_library: library,
        category: category.trim() || null,
        description: description.trim() || null,
      });
      setDone(true);
      onSubmitted?.();
      setTimeout(() => onClose?.(), 1400);
    } catch (e) {
      setErr(e.message || 'Submit failed. Try again.');
      setSaving(false);
    }
  };

  return (
    <div style={s.backdrop} onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div style={s.modal}>
        <div style={s.title}>Propose a New Exercise</div>
        <div style={s.sub}>
          Admin will review and approve. Once approved, every coach will be able to upload their own video for it.
        </div>

        {done && <div style={s.success}>✓ Submitted. Admin will review.</div>}
        {err && <div style={s.error}>{err}</div>}

        <div>
          <div style={s.label}>Exercise Name*</div>
          <input style={s.input} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Cable Lateral Raise" autoFocus />
        </div>

        <div>
          <div style={s.label}>Library</div>
          <select style={s.select} value={library} onChange={(e) => setLibrary(e.target.value)}>
            <option value="custom">Custom (doesn't fit the others)</option>
            <option value="exerciseLibrary">Strength</option>
            <option value="martialArtsLibrary">Martial Arts</option>
            <option value="mobilityExercises">Mobility</option>
            <option value="warmupExercises">Warm-up</option>
          </select>
        </div>

        <div>
          <div style={s.label}>Category (optional)</div>
          <input style={s.input} value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. Shoulders, Kicks, Hip Mobility" />
        </div>

        <div>
          <div style={s.label}>Notes to Admin (optional)</div>
          <textarea style={s.textarea} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Why this exercise, any form cues, etc." />
        </div>

        <div style={s.buttons}>
          <button style={{ ...s.btn, ...s.btnSecondary }} onClick={onClose} disabled={saving}>Cancel</button>
          <button style={{ ...s.btn, ...(canSubmit ? s.btnPrimary : s.btnDisabled) }} onClick={submit} disabled={!canSubmit}>
            {saving ? 'Submitting…' : 'Submit for Review'}
          </button>
        </div>
      </div>
    </div>
  );
}
