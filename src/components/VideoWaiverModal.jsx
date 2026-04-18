// VideoWaiverModal.jsx — one-time video content license agreement.
// Rendered by MediaLibrary when the current user hasn't accepted the current waiver
// version. Once they check the box + click Agree, POSTs to /api/media/waiver/accept
// and calls onAccept() so the parent can unlock uploads.

import { useState } from 'react';
import { api } from '../utils/api';

const s = {
  backdrop: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 1000, padding: '16px',
  },
  modal: {
    background: '#fff', borderRadius: '14px', padding: '20px',
    maxWidth: '560px', width: '100%', maxHeight: '90vh',
    display: 'flex', flexDirection: 'column', gap: '12px',
    boxShadow: '0 10px 40px rgba(0,0,0,0.2)',
  },
  title: { fontSize: '20px', fontWeight: '800', color: '#1a1a2e', marginBottom: '4px' },
  sub: { fontSize: '13px', color: '#666', marginBottom: '8px' },
  terms: {
    fontSize: '13px', lineHeight: '1.55', color: '#333',
    background: '#f8f9fa', border: '1px solid #e5e7eb',
    borderRadius: '8px', padding: '12px',
    overflowY: 'auto', flex: '1 1 auto', maxHeight: '45vh',
  },
  termsP: { marginBottom: '10px' },
  agree: { display: 'flex', alignItems: 'flex-start', gap: '8px', fontSize: '13px', color: '#222', marginTop: '4px', cursor: 'pointer' },
  buttons: { display: 'flex', gap: '10px', marginTop: '8px', justifyContent: 'flex-end', flexWrap: 'wrap' },
  btn: {
    padding: '10px 18px', borderRadius: '8px', border: 'none',
    fontSize: '14px', fontWeight: '600', cursor: 'pointer',
    minHeight: '44px',
  },
  btnPrimary: { background: 'linear-gradient(135deg, #B37602, #8a5b00)', color: '#fff' },
  btnPrimaryDisabled: { background: '#d1d5db', color: '#fff', cursor: 'not-allowed' },
  btnSecondary: { background: '#e5e7eb', color: '#333' },
  error: { background: '#fee2e2', color: '#991b1b', padding: '10px', borderRadius: '8px', fontSize: '13px' },
};

export default function VideoWaiverModal({ onAccept, onCancel }) {
  const [checked, setChecked] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  const handleAgree = async () => {
    if (!checked) return;
    setSaving(true);
    setErr(null);
    try {
      await api.waiverAccept();
      onAccept?.();
    } catch (e) {
      setErr(e.message || 'Failed to save. Try again.');
      setSaving(false);
    }
  };

  return (
    <div style={s.backdrop} onClick={(e) => { if (e.target === e.currentTarget) onCancel?.(); }}>
      <div style={s.modal}>
        <div style={s.title}>Video Use Agreement</div>
        <div style={s.sub}>Please review and accept before uploading.</div>

        <div style={s.terms}>
          <p style={s.termsP}>
            By uploading video content ("Content") to the Be Strong Again platform, you ("Coach") grant
            <b> Be Strong Again </b> and its operator <b>Glen Rogers</b> a <b>perpetual, irrevocable,
            worldwide, royalty-free, sublicensable license</b> to host, stream, display, reproduce,
            modify (for format, captioning, and trimming), distribute, and publicly perform the Content
            across any Be Strong Again properties — including but not limited to the workout tracker,
            coach dashboard, marketing materials, social media, training programs, and derivative
            products.
          </p>
          <p style={s.termsP}>
            You retain ownership of the Content. You warrant that you have all rights necessary to upload
            it, including rights to any likenesses, music, and third-party material depicted, and that
            the Content does not infringe any third party's rights.
          </p>
          <p style={s.termsP}>
            You may remove individual videos from the platform at any time (status = "removed"), but Be
            Strong Again's license to copies already incorporated into training programs, materials, or
            marketing produced prior to removal survives.
          </p>
          <p style={s.termsP}>
            Be Strong Again may flag or remove uploads at its sole discretion for quality, safety, or
            compliance reasons. Promotion of a video to "Featured Global" (visible to anonymous users)
            is at the admin's discretion and does not change the license above.
          </p>
          <p style={s.termsP}>
            This Agreement is governed by the laws of the State of Wisconsin. If any provision is found
            unenforceable, the remainder stays in force.
          </p>
        </div>

        {err && <div style={s.error}>{err}</div>}

        <label style={s.agree}>
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => setChecked(e.target.checked)}
            style={{ marginTop: '2px', transform: 'scale(1.15)' }}
          />
          <span>
            I have read and agree to the Video Use Agreement above, and I confirm I have all rights to
            the video content I will upload.
          </span>
        </label>

        <div style={s.buttons}>
          <button type="button" style={{ ...s.btn, ...s.btnSecondary }} onClick={onCancel} disabled={saving}>
            Cancel
          </button>
          <button
            type="button"
            style={{ ...s.btn, ...(checked && !saving ? s.btnPrimary : s.btnPrimaryDisabled) }}
            onClick={handleAgree}
            disabled={!checked || saving}
          >
            {saving ? 'Saving…' : 'I Agree — Enable Uploads'}
          </button>
        </div>
      </div>
    </div>
  );
}
