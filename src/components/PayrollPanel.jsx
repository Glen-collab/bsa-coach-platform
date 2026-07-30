import { useState, useEffect } from 'react';
import { api } from '../utils/api';

// Monthly coach payroll. Preview is a dry run and always safe; Run Payroll
// transfers real money, so it sits behind an explicit typed confirmation
// rather than a single click.
//
// Defaults to LAST month — you settle a month once it's finished, and running
// the current month mid-way would pay out a partial period.
const money = (c) => `$${((c || 0) / 100).toFixed(2)}`;

function lastMonth() {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export default function PayrollPanel() {
  const [month, setMonth] = useState(lastMonth());
  const [plan, setPlan] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmText, setConfirmText] = useState('');

  const load = async (m = month) => {
    setBusy(true); setError(''); setResult(null);
    try {
      setPlan(await api.settlementPreview(m));
    } catch (e) {
      setError(e.message || 'Could not load the payroll preview');
      setPlan(null);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async () => {
    setBusy(true); setError('');
    try {
      const r = await api.settlementRun(month);
      setResult(r);
      setConfirmText('');
      await load(month);   // refresh — paid rows drop out of the pending plan
    } catch (e) {
      setError(e.message || 'Payout failed');
    } finally {
      setBusy(false);
    }
  };

  const payable = (plan?.earners || []).filter((e) => e.net_cents > 0 && e.payable);
  const blocked = (plan?.earners || []).filter((e) => e.net_cents > 0 && !e.payable);
  const totalPayable = payable.reduce((s, e) => s + e.net_cents, 0);
  const armed = confirmText.trim().toUpperCase() === 'PAY';

  const s = {
    row: { display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 16 },
    input: { padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14 },
    btn: { padding: '8px 14px', borderRadius: 8, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 14 },
    card: { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: 16, marginBottom: 16 },
    th: { textAlign: 'left', padding: '8px 10px', fontSize: 12, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '.03em' },
    td: { padding: '10px', borderTop: '1px solid #f3f4f6', fontSize: 14 },
    warn: { background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 10, padding: 12, marginBottom: 16, fontSize: 14 },
    err: { background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 10, padding: 12, marginBottom: 16, fontSize: 14, color: '#991b1b' },
    ok: { background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 10, padding: 12, marginBottom: 16, fontSize: 14 },
  };

  return (
    <div>
      <p style={{ color: '#6b7280', fontSize: 14, marginTop: 0 }}>
        What each coach and referrer earned. Preview is safe to open any time — it moves nothing.
        Run Payroll sends one Stripe transfer per person and marks those earnings paid.
      </p>

      <div style={s.row}>
        <label style={{ fontSize: 14, fontWeight: 600 }}>Month</label>
        <input style={s.input} type="month" value={month}
               onChange={(e) => { setMonth(e.target.value); load(e.target.value); }} />
        <button style={{ ...s.btn, background: '#e5e7eb', color: '#111' }}
                onClick={() => load()} disabled={busy}>
          {busy ? 'Working…' : 'Refresh preview'}
        </button>
      </div>

      {error && <div style={s.err}>{error}</div>}

      {result && (
        <div style={s.ok}>
          <strong>Payout run complete.</strong>{' '}
          {result.summary?.transfers || 0} transfer(s), {money(result.summary?.paid_cents)} sent.
          {result.summary?.held?.length > 0 && (
            <div style={{ marginTop: 8 }}>
              Held back:{' '}
              {result.summary.held.map((h) => `${h.name} (${money(h.net_cents)} — ${h.reason})`).join('; ')}
            </div>
          )}
        </div>
      )}

      {plan && (
        <>
          <div style={s.card}>
            <div style={{ fontSize: 13, color: '#6b7280' }}>Ready to pay for {plan.month}</div>
            <div style={{ fontSize: 30, fontWeight: 800, color: '#15803d' }}>{money(totalPayable)}</div>
            <div style={{ fontSize: 13, color: '#6b7280' }}>
              across {payable.length} {payable.length === 1 ? 'person' : 'people'}
              {plan.totals?.withheld_cents > 0 && ` · ${money(plan.totals.withheld_cents)} withheld for platform minimums`}
            </div>
          </div>

          {blocked.length > 0 && (
            <div style={s.warn}>
              <strong>{blocked.length} earner(s) can't be paid yet</strong> — they haven't finished
              Stripe Connect onboarding. Their earnings stay pending and will be picked up by a
              later run, so nothing is lost.
              <ul style={{ margin: '8px 0 0 18px' }}>
                {blocked.map((e) => (
                  <li key={e.earner_id}>{e.name} ({e.email}) — {money(e.net_cents)} waiting</li>
                ))}
              </ul>
            </div>
          )}

          <table style={{ width: '100%', borderCollapse: 'collapse', background: '#fff', borderRadius: 12, overflow: 'hidden', border: '1px solid #e5e7eb' }}>
            <thead>
              <tr style={{ background: '#f9fafb' }}>
                <th style={s.th}>Who</th>
                <th style={s.th}>Earned</th>
                <th style={s.th}>Platform min.</th>
                <th style={s.th}>Net payout</th>
                <th style={s.th}>Active clients</th>
                <th style={s.th}>Status</th>
              </tr>
            </thead>
            <tbody>
              {(plan.earners || []).length === 0 && (
                <tr><td style={s.td} colSpan={6}>Nothing pending for this month.</td></tr>
              )}
              {(plan.earners || []).map((e) => (
                <tr key={e.earner_id}>
                  <td style={s.td}>
                    <div style={{ fontWeight: 600 }}>{e.name}</div>
                    <div style={{ fontSize: 12, color: '#6b7280' }}>{e.email}</div>
                  </td>
                  <td style={s.td}>{money(e.gross_cents)}</td>
                  <td style={s.td}>{e.deduction_cents ? `−${money(e.deduction_cents)}` : '—'}</td>
                  <td style={{ ...s.td, fontWeight: 700 }}>{money(e.net_cents)}</td>
                  <td style={s.td}>{e.active_clients}</td>
                  <td style={s.td}>
                    {e.payable
                      ? <span style={{ color: '#15803d' }}>ready</span>
                      : <span style={{ color: '#b45309' }}>no Stripe account</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div style={{ ...s.card, marginTop: 16, borderColor: '#fca5a5' }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Run payroll for {plan.month}</div>
            <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 10 }}>
              This sends {money(totalPayable)} in real Stripe transfers. Type <strong>PAY</strong> to
              enable it. Running twice is safe — anyone already paid is skipped.
            </div>
            <div style={s.row}>
              <input style={s.input} value={confirmText} placeholder="type PAY"
                     onChange={(ev) => setConfirmText(ev.target.value)} />
              <button
                style={{ ...s.btn,
                         background: armed && totalPayable > 0 ? '#dc2626' : '#e5e7eb',
                         color: armed && totalPayable > 0 ? '#fff' : '#9ca3af',
                         cursor: armed && totalPayable > 0 ? 'pointer' : 'not-allowed' }}
                disabled={!armed || busy || totalPayable <= 0}
                onClick={run}>
                {busy ? 'Sending…' : `Run Payroll — ${money(totalPayable)}`}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
