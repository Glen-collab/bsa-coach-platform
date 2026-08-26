/**
 * CheckIn.jsx — /checkin
 *
 * A phone screen for checking clients in between sets. Everything here serves
 * one tap per person:
 *
 *  - Tapping a row checks in; tapping the NAME opens their card. Two targets,
 *    one row, so you never open a card just to log a visit.
 *  - The toggle is optimistic. The server call is idempotent by
 *    (client_id, attended_on), so a double-tap or a flaky connection can't
 *    produce a double check-in — the UI never waits to feel responsive.
 *  - The list defaults to whoever trains THIS weekday at THIS hour. That
 *    grouping is learned from the clock stamp on past check-ins; nobody
 *    configures a schedule.
 */
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { api } from '../utils/api';

const DAYN = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const COARSE = ['morning','afternoon','evening'];
const COARSE_LBL = { morning:'Morning', afternoon:'Afternoon', evening:'Evening' };
const SPORT_PRESETS = ['Football','Basketball','Baseball','Softball','Soccer','Wrestling',
  'Hockey','Volleyball','Track','Cross Country','Golf','Tennis','Swimming','Lacrosse',
  'Boxing','Powerlifting','In-home','General Fitness'];
const HOURS = [6,7,8,9,10,11,12,13,14,15,16,17,18,19,20];
const STATUS_LBL = {
  active: 'Active — on the check-in list',
  paused: 'Paused — membership on hold',
  former: 'No longer a client',
};
const BILLING_LBL = {
  monthly:'Monthly membership', package:'Session package', drop_in:'Drop-in, per session',
  one_on_one:'One-on-one / in-home', untracked:'Sessions only — no money tracked',
};

/* A session settles after this many separate days, or the instant a name is
   pinned to it by hand. See inSession() for why that matters. */
const SETTLE_AFTER = 3;

/* Why someone isn't here. Four, because the coach picking one is standing in a
   gym between sets and a longer list is a list he reads instead of taps. The
   backend stores the reason as free text, so adding a fifth is a line here and
   no migration. */
const AWAY_REASONS = [
  { key:'vacation', emoji:'🌴', label:'Vacation' },
  { key:'work',     emoji:'🏭', label:'Away for work' },
  { key:'injured',  emoji:'🩹', label:'Injured' },
  { key:'away',     emoji:'✈️', label:'Away' },
];
const awayOf = k => AWAY_REASONS.find(r => r.key === k) || { key:k, emoji:'✈️', label:k || 'Away' };

/* How the absence reads on the row: "Vacation · back Sep 1" — or, when nobody
   knows when they're back, just "Vacation · Florida". Never a bare "Away" with
   no handle on it, which tells the coach nothing he didn't already see. */
const awaySummary = a => {
  if (!a) return null;
  const bits = [awayOf(a.reason).label];
  if (a.back) bits.push(`back ${fmtShort(a.back)}`);
  else if (a.note) bits.push(a.note);
  if (a.back && a.note) bits.push(a.note);
  return bits.join(' · ');
};

const coarseOf = h => (h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening');
const hourLbl = h => `${h % 12 === 0 ? 12 : h % 12}${h < 12 ? 'am' : 'pm'}`;
const tagLbl = t => (t?.charAt(0) === 'h' ? hourLbl(+t.slice(1)) : COARSE_LBL[t] || t);
const sessKey = (d, b) => `${d}-${b}`;
const sessLabel = k => {
  const [d, b] = k.split('-');
  return `${DAYN[+d]} ${(COARSE_LBL[b] || b).toLowerCase()}`;
};
const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
};
function daysAgo(iso) {
  if (!iso) return null;
  const [y,m,d] = iso.split('-').map(Number);
  const n = new Date();
  return Math.round((Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()) - Date.UTC(y, m-1, d)) / 864e5);
}
function tenure(since) {
  if (!since) return '—';
  const yrs = (Date.now() - Date.parse(since)) / (365.25 * 864e5);
  return yrs < 1 ? `${Math.round(yrs*12)} months` : `${yrs.toFixed(yrs < 10 ? 1 : 0)} years`;
}
function untilAnniv(iso) {
  if (!iso) return null;
  const [, m, d] = iso.split('-').map(Number);
  const n = new Date();
  const t0 = Date.UTC(n.getFullYear(), n.getMonth(), n.getDate());
  let t = Date.UTC(n.getFullYear(), m-1, d);
  if (t < t0) t = Date.UTC(n.getFullYear()+1, m-1, d);
  return Math.round((t - t0) / 864e5);
}
function dueState(c) {
  // Only ever a judgement about someone we've actually recorded a payment for.
  // Everyone else is "unknown", not "owes" — flagging 141 people you've never
  // entered a payment for would make the flag worthless on day one.
  if (!c.dueOn) return null;
  if (c.billing !== 'monthly' && c.billing !== 'package') return null;
  const d = daysAgo(c.dueOn);
  if (d === null) return null;
  return d > 0 ? 'over' : d >= -3 ? 'soon' : 'ok';
}
function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString(undefined,
    { year:'numeric', month:'short', day:'numeric', timeZone:'UTC' });
}
/* Noon UTC, so a date-only string can never slide a day either way when the
   browser renders it in Central. */
function fmtShort(iso) {
  if (!iso) return '';
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString(undefined,
    { month:'short', day:'numeric', timeZone:'UTC' });
}
function fmtLong(iso) {
  if (!iso) return '';
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString(undefined,
    { month:'long', day:'numeric', timeZone:'UTC' });
}
const isoOf = (y, m, d) =>
  `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const addDaysISO = (iso, n) => {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return isoOf(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate());
};

export default function CheckIn() {
  const [data, setData] = useState(null);       // { clients, runs, checkedIn }
  const [err, setErr] = useState('');
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState({ now:true, day:null, sports:new Set(), times:new Set(), inOnly:false, owes:false, awayOnly:false });
  const [tagMode, setTagMode] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [card, setCard] = useState(null);       // client id
  const [awayFor, setAwayFor] = useState(null); // client id whose away sheet is open
  const [msgFor, setMsgFor] = useState(null);   // client id whose message sheet is open
  /* The day being entered. Almost always today; the exception is catching up on
     a session that ran last night, which is normal enough to deserve a control
     rather than a workaround. Taps land on THIS date, not on today. */
  const [viewDate, setViewDate] = useState(todayISO);
  const [toast, setToast] = useState('');
  const [flash, setFlash] = useState(() => new Set());
  const [newTag, setNewTag] = useState('');
  const [summary, setSummary] = useState(null);
  const [showSummary, setShowSummary] = useState(false);
  const toastT = useRef();

  const say = useCallback(msg => {
    setToast(msg);
    clearTimeout(toastT.current);
    toastT.current = setTimeout(() => setToast(''), 1700);
  }, []);

  const load = useCallback(async () => {
    try { setData(await api.checkinRoster(viewDate === todayISO() ? null : viewDate)); setErr(''); }
    catch (e) { setErr(e.message || 'Could not load the roster'); }
  }, [viewDate]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => () => clearTimeout(toastT.current), []);

  const clients = data?.clients || [];
  const runs = data?.runs || {};
  const checkedIn = data?.checkedIn || {};
  const isIn = id => !!checkedIn[id];

  const now = new Date();
  const isToday = viewDate === todayISO();
  // Parsed at noon UTC so a date-only string can't slide a day either way.
  const viewDow = new Date(`${viewDate}T12:00:00Z`).getUTCDay();
  const sess = useMemo(() => {
    const d = new Date();
    return { dow:d.getDay(), hour:d.getHours(), blk:coarseOf(d.getHours()), key:sessKey(d.getDay(), coarseOf(d.getHours())) };
  }, [data]);

  /* Moving off today drops the "now" filter for that day's regulars: there is
     no meaningful time block for a session that finished last night, and
     pretending otherwise would show the wrong group. Coming back to today
     restores the default. */
  useEffect(() => {
    setFilter(f => isToday
      ? { ...f, now:true, day:null }
      : { ...f, now:false, day:viewDow });
  }, [viewDate, isToday, viewDow]);

  const pinnedTo = useMemo(() => {
    const m = {};
    clients.forEach(c => (c.pinned || []).forEach(k => { m[k] = (m[k] || 0) + 1; }));
    return m;
  }, [clients]);

  const isSettled = key => (pinnedTo[key] || 0) > 0 || (runs[key] || 0) >= SETTLE_AFTER;

  /* Membership in the current session.
     The fallback to "everyone who trains this weekday" has to be decided per
     SESSION, not per person. Deciding it per person keeps padding a settled
     group with every other regular of that weekday, so the list never narrows
     and the whole feature is pointless. */
  const inSession = useCallback((c, s) => {
    if ((c.pinned || []).includes(s.key)) return true;
    const e = (c.sess || {})[s.key];
    if (e) {
      const hs = e.hours || {};
      const top = Object.keys(hs).sort((a, b) => hs[b] - hs[a])[0];
      const consistent = top != null && e.n >= 2 && hs[top] / e.n >= 0.6;
      if (!consistent || Math.abs(+top - s.hour) <= 2) return true;
    }
    if (isSettled(s.key)) return false;
    return (c.d || []).includes(s.dow);
  }, [pinnedTo, runs]);

  const timeTags = useCallback(c => {
    const out = new Set();
    if (c.slot) { out.add(c.slot); if (c.slot.charAt(0) === 'h') out.add(coarseOf(+c.slot.slice(1))); }
    Object.entries(c.sess || {}).forEach(([k, e]) => {
      const [, b] = k.split('-');
      if (e.n >= 2) out.add(b);
      const hs = e.hours || {};
      const top = Object.keys(hs).sort((a, x) => hs[x] - hs[a])[0];
      if (top != null && e.n >= 2 && hs[top] / e.n >= 0.6) out.add(`h${top}`);
    });
    return out;
  }, []);

  const primaryTime = c => {
    const t = timeTags(c);
    for (const x of t) if (x.charAt(0) === 'h') return x;
    for (const b of COARSE) if (t.has(b)) return b;
    return null;
  };

  const sportCounts = useMemo(() => {
    const m = {};
    clients.forEach(c => (c.sports || []).forEach(s => { m[s] = (m[s] || 0) + 1; }));
    return Object.keys(m).sort((a, b) => m[b] - m[a] || a.localeCompare(b)).map(s => [s, m[s]]);
  }, [clients]);

  const timeCounts = useMemo(() => {
    const m = {};
    clients.forEach(c => timeTags(c).forEach(t => { m[t] = (m[t] || 0) + 1; }));
    const coarse = COARSE.filter(t => m[t]).map(t => [t, m[t]]);
    const hrs = Object.keys(m).filter(t => t.charAt(0) === 'h')
      .sort((a, b) => +a.slice(1) - +b.slice(1)).map(t => [t, m[t]]);
    return coarse.concat(hrs);
  }, [clients, timeTags]);

  const regularsOn = d => clients.filter(c => (c.d || []).includes(d)).length;

  const matches = (c, needle) => {
    if (c.n.toLowerCase().includes(needle)) return true;
    if ((c.s || '').toLowerCase().includes(needle)) return true;
    if ((c.sports || []).some(s => s.toLowerCase().includes(needle))) return true;
    for (const t of timeTags(c)) if (tagLbl(t).toLowerCase().includes(needle) || t.includes(needle)) return true;
    if ((c.d || []).some(d => DAYN[d].toLowerCase().includes(needle))) return true;
    return false;
  };

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let set = clients;
    if (needle) set = set.filter(c => matches(c, needle));
    else {
      if (filter.inOnly) set = set.filter(c => isIn(c.id));
      if (filter.owes) set = set.filter(c => dueState(c) === 'over');
      if (filter.awayOnly) set = set.filter(c => c.away);
      /* Someone on a beach is not in today's session, and leaving them in the
         list is the same noise the grouping exists to remove. They stay
         reachable through the Away chip and through search, and they come
         straight back the moment they're checked in. */
      if (filter.now) set = set.filter(c => (inSession(c, sess) && !c.away) || isIn(c.id));
      if (filter.day !== null) set = set.filter(c => (c.d || []).includes(filter.day) || isIn(c.id));
      if (filter.sports.size) set = set.filter(c => (c.sports || []).some(s => filter.sports.has(s)));
      if (filter.times.size) set = set.filter(c => { const t = timeTags(c); for (const x of filter.times) if (t.has(x)) return true; return false; });
    }
    return [...set].sort((a, b) => {
      const ai = isIn(a.id), bi = isIn(b.id);
      if (!tagMode && ai !== bi) return ai ? 1 : -1;
      // Within the checked-in group, order by when they actually arrived —
      // most recent first, so the person you just tapped lands on top.
      if (!tagMode && ai && bi) {
        const at = checkedIn[a.id]?.at || '', bt = checkedIn[b.id]?.at || '';
        if (at !== bt) return at < bt ? 1 : -1;
        return a.n.localeCompare(b.n);
      }
      if (needle) return a.n.localeCompare(b.n);
      return (daysAgo(a.last) ?? 9e9) - (daysAgo(b.last) ?? 9e9) || a.n.localeCompare(b.n);
    });
  }, [clients, q, filter, checkedIn, tagMode, inSession, sess, timeTags]);

  /* ── actions ───────────────────────────────────────────────────────── */
  const toggle = async c => {
    const wasIn = isIn(c.id);
    setData(d => {                                    // optimistic — the tap must feel instant
      const next = { ...d.checkedIn };
      if (wasIn) delete next[c.id];
      // A back-dated visit carries no clock stamp, so don't pretend one here
      // either — the row would show an arrival time that vanishes on reload.
      else next[c.id] = { at: isToday ? new Date().toISOString() : null, paid: null };
      return { ...d, checkedIn: next };
    });
    say(wasIn ? `Undone — ${c.n}`
      : `✓ ${c.n} · ${isToday ? hourLbl(new Date().getHours()) : fmtShort(viewDate)}`);
    try {
      const r = await api.checkinToggle(c.id, isToday ? {} : { date: viewDate });
      setData(d => {
        const next = { ...d.checkedIn };
        if (r.checked_in) next[c.id] = { at: r.at, paid: next[c.id]?.paid ?? null };
        else delete next[c.id];
        // A shared pool changes for everyone in it, so the server returns the
        // new figure for each member — otherwise their cards keep showing the
        // number they were loaded with and it looks like nothing was deducted.
        let cl = r.balances
          ? d.clients.map(x => x.id in r.balances ? { ...x, remaining: r.balances[x.id] } : x)
          : d.clients;
        // They walked in, so the server ended the vacation. Drop the badge here
        // too, otherwise the row keeps insisting they're in Florida.
        if (r.away_cleared) cl = cl.map(x => x.id === c.id ? { ...x, away: null } : x);
        return { ...d, checkedIn: next, clients: cl };
      });
      if (r.away_cleared) say(`✓ ${c.n} — back from ${awayOf(c.away?.reason).label.toLowerCase()}`);
    } catch (e) {
      setData(d => {                                  // roll back and say so
        const next = { ...d.checkedIn };
        if (wasIn) next[c.id] = { at: null, paid: null }; else delete next[c.id];
        return { ...d, checkedIn: next };
      });
      say(`Didn't save — ${e.message || 'try again'}`);
    }
  };

  /* Marking someone away, and clearing it. Optimistic like every other write on
     this screen — the tap must land before the network does. */
  const setAway = async (id, body) => {
    const c = clients.find(x => x.id === id);
    if (!body) return endAway(id);
    setAwayFor(null);
    setData(d => ({ ...d, clients: d.clients.map(x => x.id === id
      ? { ...x, away: { reason: body.reason, note: body.note,
                        since: body.starts_on,
                        back: body.ends_on ? addDaysISO(body.ends_on, 1) : null } }
      : x) }));
    say(`${awayOf(body.reason).emoji} ${c ? c.n : 'Marked'} — ${awayOf(body.reason).label.toLowerCase()}`);
    try { await api.checkinSetAway(id, body); }
    catch (e) { say(`Didn't save — ${e.message}`); load(); }
  };

  const endAway = async (id) => {
    const c = clients.find(x => x.id === id);
    setAwayFor(null);
    setData(d => ({ ...d, clients: d.clients.map(x => x.id === id ? { ...x, away: null } : x) }));
    say(`${c ? c.n : 'They'} — back`);
    try { await api.checkinEndAway(id); }
    catch (e) { say(`Didn't save — ${e.message}`); load(); }
  };

  /* `optimistic` is true for a text: the phone has already been handed the
     message and there is no undoing that, so the log write must not be allowed
     to look like a failure to send. An email is the opposite — nothing has left
     until the server says so. */
  const sendMessage = async (id, body, optimistic) => {
    const c = clients.find(x => x.id === id);
    const who = c?.to?.name || 'them';
    if (optimistic) {
      say(`Opening Messages — ${who}`);
      api.checkinMessage(id, body).catch(() => {});
      setMsgFor(null);
      return true;
    }
    try {
      const r = await api.checkinMessage(id, body);
      say(`✉ Sent to ${r.to || who}`);
      return true;
    } catch (e) { say(e.message || "Couldn't send"); return false; }
  };

  /* Reloads rather than patching local state: `to` is worked out on the server
     (minor vs adult, guardian vs self, which field wins) and duplicating that
     rule in the browser is how the two quietly stop agreeing. */
  const saveContact = async (id, body) => {
    try {
      await api.checkinUpdateClient(id, body);
      await load();
      say('Contact saved');
      return true;
    } catch (e) { say(`Didn't save — ${e.message}`); return false; }
  };

  const patch = async (id, body) => {
    setData(d => ({ ...d, clients: d.clients.map(c => c.id === id ? { ...c, ...mapPatch(body) } : c) }));
    try {
      await api.checkinUpdateClient(id, body);
      // Pausing someone takes them off the list, so the card must close and the
      // roster reload — otherwise they linger until the next refresh.
      if (body.status && body.status !== 'active') {
        setCard(null);
        say(body.status === 'paused' ? 'Membership paused' : 'Marked no longer a client');
        load();
      }
    } catch (e) { say(`Didn't save — ${e.message}`); load(); }
  };
  const mapPatch = b => {
    const o = {};
    if ('sports' in b) o.sports = b.sports;
    if ('sessions' in b) o.pinned = b.sessions;
    if ('slot' in b) o.slot = b.slot;
    if ('date_of_birth' in b) o.dob = b.date_of_birth;
    if ('billing_type' in b) o.billing = b.billing_type;
    if ('notes' in b) o.note = b.notes;
    if ('status' in b) o.status = b.status;
    if ('monthly_amount' in b) o.monthly = b.monthly_amount;
    if ('status_note' in b) o.statusNote = b.status_note;
    return o;
  };

  const pay = async (id, amount, on) => {
    const c = clients.find(x => x.id === id);
    say(`✓ Paid — ${c ? c.n : ''}`);
    try {
      const r = await api.checkinPayment(id, { amount: amount ?? null, paid_on: on || null });
      // One payment settles the whole pool, so every member's due date moves.
      setData(d => ({ ...d, clients: d.clients.map(x => {
        const du = r.dues && r.dues[x.id];
        if (du) return { ...x, lastPaid: du.last_paid, dueOn: du.due_on };
        return x.id === id ? { ...x, lastPaid: r.last_paid, dueOn: r.due_on } : x;
      }) }));
    } catch (e) { say(`Didn't save — ${e.message}`); load(); }
  };

  const adjustSessions = async (id, sessions, note) => {
    try {
      const r = await api.checkinAdjustSessions(id, sessions, note);
      setData(d => ({ ...d, clients: d.clients.map(x =>
        x.id === id ? { ...x, remaining: r.remaining } : x) }));
      say(`${sessions > 0 ? '+' : ''}${sessions} sessions · now ${r.remaining}`);
    } catch (e) { say(`Didn't save — ${e.message}`); load(); }
  };

  const buyPackage = async (id, sessions, amount) => {
    const c = clients.find(x => x.id === id);
    try {
      const r = await api.checkinBuyPackage(id, { sessions, amount, paid_on: viewDate });
      setData(d => ({ ...d, clients: d.clients.map(x =>
        (r.balances && x.id in r.balances) ? { ...x, remaining: r.balances[x.id] } : x) }));
      say(`+${sessions} sessions${amount ? ` · $${amount}` : ''} · ${c ? c.n : ''} now ${r.remaining}`);
    } catch (e) { say(`Didn't save — ${e.message}`); load(); }
  };

  const transferSessions = async (fromId, toId, sessions, note) => {
    try {
      const r = await api.checkinTransferSessions(fromId, toId, sessions, note);
      setData(d => ({ ...d, clients: d.clients.map(x =>
        x.id === fromId ? { ...x, remaining: r.from_remaining }
        : x.id === toId ? { ...x, remaining: r.to_remaining } : x) }));
      const to = clients.find(c => c.id === toId);
      say(`Moved ${sessions} to ${to ? to.n : 'client'}`);
    } catch (e) { say(`Didn't move — ${e.message}`); load(); }
  };

  const shareWith = async (id, withId) => {
    try {
      const r = await api.checkinHouseholdAdd(id, withId);
      const who = clients.find(c => c.id === withId);
      setData(d => ({ ...d, clients: d.clients.map(x =>
        (x.id === id || x.id === withId)
          ? { ...x, householdId: r.household_id, household: r.name,
              remaining: r.balances?.[x.id] ?? x.remaining }
          : (r.balances && x.id in r.balances) ? { ...x, remaining: r.balances[x.id] } : x) }));
      say(`Now sharing with ${who ? who.n : 'them'}`);
    } catch (e) { say(`Didn't save — ${e.message}`); load(); }
  };

  const unshare = async (id) => {
    const who = clients.find(c => c.id === id);
    try {
      const r = await api.checkinHouseholdRemove(id);
      setData(d => ({ ...d, clients: d.clients.map(x => {
        const rem = r.balances && x.id in r.balances ? r.balances[x.id] : x.remaining;
        if (x.id === id) return { ...x, householdId: null, household: null, remaining: rem };
        if (r.dissolved && x.householdId) return { ...x, householdId: null, household: null, remaining: rem };
        return { ...x, remaining: rem };
      }) }));
      say(`${who ? who.n : 'They'} now have their own sessions`);
    } catch (e) { say(`Didn't save — ${e.message}`); load(); }
  };

  const addPerson = async (name) => {
    const n = name.trim().replace(/\s+/g, ' ');
    if (!n) return;
    const parts = n.split(' ');
    const first = parts.length > 1 ? parts.slice(0, -1).join(' ') : n;
    const last  = parts.length > 1 ? parts[parts.length - 1] : '';
    try {
      const r = await api.checkinCreateClient({ first_name: first, last_name: last, display_name: n });
      setData(d => ({ ...d, clients: [...d.clients, {
        id: r.id, n, s: last || n, dob: null, billing: 'monthly', rate: null,
        sports: [], pinned: [], slot: null, phone: null, note: null,
        v: 0, since: null, last: null, d: [], pb: 0, remaining: 0,
        household: null, householdId: null, needsReview: false, waiver: null,
        h: [], sess: {}, status: 'active', statusNote: null,
        monthly: null, lastPaid: null, dueOn: null,
      }] }));
      setQ(n);
      say(`Added ${n} — tap the circle to check in`);
    } catch (e) { say(`Couldn't add — ${e.message}`); }
  };

  const removeClient = async (id) => {
    const c = clients.find(x => x.id === id);
    const n = c ? c.n : 'this client';
    const v = c ? c.v : 0;
    const warn = v > 0
      ? `Delete ${n}?

This destroys ${v.toLocaleString()} visit${v === 1 ? '' : 's'} and cannot be undone.

If they simply stopped coming, use "No longer a client" instead — that keeps the history.`
      : `Delete ${n}? This cannot be undone.`;
    if (!window.confirm(warn)) return;
    try {
      await api.checkinDeleteClient(id);
      setData(d => ({ ...d, clients: d.clients.filter(x => x.id !== id) }));
      setCard(null);
      say(`Deleted ${n}`);
    } catch (e) { say(e.message || 'Could not delete'); }
  };

  const bulk = async (body, label) => {
    if (!selected.size) return;
    const ids = [...selected];
    setFlash(new Set(ids));
    setTimeout(() => setFlash(new Set()), 600);
    setData(d => ({ ...d, clients: d.clients.map(c => {
      if (!selected.has(c.id)) return c;
      if (body.sport)   return { ...c, sports: [...new Set([...(c.sports||[]), body.sport])] };
      if (body.session) return { ...c, pinned: [...new Set([...(c.pinned||[]), body.session])] };
      if (body.slot)    return { ...c, slot: body.slot };
      return c;
    })}));
    say(`✓ ${label} → ${ids.length} ${ids.length === 1 ? 'name' : 'names'}`);
    try { await api.checkinBulkTag(ids, body); }
    catch (e) { say(`Didn't save — ${e.message}`); load(); }
  };

  /* ── render ────────────────────────────────────────────────────────── */
  if (err) return (
    <div style={S.wrap}><div style={S.err}>{err}
      <button style={S.btn} onClick={load}>Try again</button></div></div>
  );
  if (!data) return <div style={S.wrap}><p style={S.loading}>Loading your roster…</p></div>;

  const inCount = Object.keys(checkedIn).length;
  const owesCount = clients.filter(c => dueState(c) === 'over').length;
  const awayCount = clients.filter(c => c.away).length;
  const showBar = filter.now && !q.trim() && isToday;
  const settled = isSettled(sess.key);
  const anyFacet = !filter.now || filter.sports.size || filter.times.size || filter.inOnly
    || filter.day !== null || filter.owes || filter.awayOnly;

  const chip = (key, cls, label, count, on, go) => (
    <button key={key} type="button" onClick={() => { go(); }}
      aria-pressed={on} style={{ ...S.chip, ...(cls === 'sport' ? S.chipSport : cls === 'slot' ? S.chipSlot : null),
        ...(on ? (cls === 'sport' ? S.chipSportOn : cls === 'slot' ? S.chipSlotOn : S.chipOn) : null) }}>
      {label}{count != null && <span style={S.chipC}>{count}</span>}
    </button>
  );

  const cardClient = card ? clients.find(c => c.id === card) : null;
  const awayClient = awayFor ? clients.find(c => c.id === awayFor) : null;
  const msgClient  = msgFor  ? clients.find(c => c.id === msgFor)  : null;

  return (
    <div style={{ ...S.wrap, paddingBottom: tagMode ? 220 : 60 }}>
      <div style={S.hdr}>
        <div style={S.hdrTop}>
          <h1 style={S.h1}>{DAYN[viewDow]}, {fmtLong(viewDate)}</h1>
          <label style={{ ...S.tagBtn, ...(isToday ? null : S.tagBtnCatch) }} title="Enter a different day">
            {isToday ? '📅' : '📅 ' + fmtShort(viewDate)}
            {/* A native date input: on a phone this is the OS wheel, which beats
                anything hand-rolled, and it can't offer a day in the future. */}
            <input type="date" value={viewDate} max={todayISO()} style={S.dateInput}
              onChange={e => { if (e.target.value) setViewDate(e.target.value); }} />
          </label>
          <button type="button" style={S.tagBtn} onClick={async () => {
            setShowSummary(true);
            try { setSummary(await api.checkinSummary()); }
            catch (e) { say(e.message || 'Could not load the summary'); setShowSummary(false); }
          }}>Summary</button>
          <button type="button" style={{ ...S.tagBtn, ...(tagMode ? S.tagBtnOn : null) }}
            onClick={() => { setTagMode(t => !t); setSelected(new Set()); }}>Tag</button>
          <span style={{ ...S.tally, ...(inCount ? null : S.tallyZero) }}>{inCount} in</span>
        </div>

        {!isToday && (
          <div style={S.catchBar}>
            <b style={S.catchB}>Catching up — {DAYN[viewDow]}, {fmtShort(viewDate)}</b>
            <span style={S.catchNote}>Taps are recorded on that day, not today.</span>
            <button type="button" style={S.catchBtn}
              onClick={() => setViewDate(todayISO())}>Today</button>
          </div>
        )}

        {showBar && (
          <div style={S.sessBar}>
            <b style={S.sessB}>{sessLabel(sess.key)}</b>
            <span style={S.sessNote}>
              {pinnedTo[sess.key] ? `${pinnedTo[sess.key]} pinned to this group`
                : settled ? `learned from ${runs[sess.key] || 0} ${DAYN[sess.dow]}s`
                : `learning — ${runs[sess.key] || 0} of ${SETTLE_AFTER} logged, showing all ${DAYN[sess.dow]} regulars`}
            </span>
          </div>
        )}

        <div style={S.searchWrap}>
          <span style={S.sIco}>⌕</span>
          <input value={q} onChange={e => setQ(e.target.value)} style={S.search}
            placeholder="Name, sport, 9am, morning…" autoComplete="off" enterKeyHint="done" />
          {q && <button type="button" style={S.sClr} onClick={() => setQ('')} aria-label="Clear search">×</button>}
        </div>

        <div style={S.chips}>
          {chip('in', '', 'Checked in', inCount, filter.inOnly,
            () => setFilter(f => ({ ...f, inOnly: !f.inOnly })))}
          {owesCount > 0 && chip('owes', 'owes', 'Owes', owesCount, filter.owes,
            () => setFilter(f => ({ ...f, owes: !f.owes, now: f.owes ? f.now : false })))}
          {awayCount > 0 && chip('away', 'slot', 'Away', awayCount, filter.awayOnly,
            () => setFilter(f => ({ ...f, awayOnly: !f.awayOnly, now: f.awayOnly ? f.now : false })))}
          {anyFacet && chip('clr', 'clear', '✕ Back to now', null, false,
            () => setFilter({ now:true, day:null, sports:new Set(), times:new Set(), inOnly:false, owes:false, awayOnly:false }))}
          {isToday && chip('now', 'slot', `Now · ${COARSE_LBL[sess.blk]}`, null, filter.now,
            () => setFilter(f => ({ ...f, now: !f.now, day: !f.now ? null : f.day })))}
          {chip('td', '', `${DAYS[viewDow]} — all day`, regularsOn(viewDow), filter.day === viewDow,
            () => setFilter(f => ({ ...f, day: f.day === viewDow ? null : viewDow, now:false })))}
          {[1,2,3,4,5].filter(d => d !== viewDow && regularsOn(d) > 2).map(d =>
            chip(`d${d}`, '', DAYS[d], regularsOn(d), filter.day === d,
              () => setFilter(f => ({ ...f, day: f.day === d ? null : d, now:false }))))}
          {chip('all', '', 'Everyone', clients.length,
            !filter.now && filter.day === null && !filter.sports.size && !filter.times.size && !filter.inOnly,
            () => setFilter({ now:false, day:null, sports:new Set(), times:new Set(), inOnly:false, owes:false, awayOnly:false }))}

          {timeCounts.length > 0 && <span style={S.divider} />}
          {timeCounts.map(([t, n]) => chip(`t${t}`, 'slot', tagLbl(t), n, filter.times.has(t),
            () => setFilter(f => { const s = new Set(f.times); s.has(t) ? s.delete(t) : s.add(t); return { ...f, times:s }; })))}

          {sportCounts.length > 0 && <span style={S.divider} />}
          {sportCounts.map(([s, n]) => chip(`s${s}`, 'sport', s, n, filter.sports.has(s),
            () => setFilter(f => { const x = new Set(f.sports); x.has(s) ? x.delete(s) : x.add(s); return { ...f, sports:x }; })))}
        </div>
      </div>

      <div style={S.list}>
        {visible.length === 0 && (
          <div style={S.empty}>
            {q ? (
              <>
                Nothing matches “{q}”.
                <div style={{ marginTop:18 }}>
                  <button type="button" style={S.addPersonBtn} onClick={() => addPerson(q)}>
                    + Add “{q.trim()}” as a new client
                  </button>
                </div>
                <p style={{ ...S.hint, marginTop:14 }}>
                  Or try a sport you’ve tagged, or a time like “9am”.
                </p>
              </>
            ) : filter.now ? (
              <>Nobody is grouped into {sessLabel(sess.key)} yet.<br />
                Search a name and check them in — the group builds itself.</>
            ) : 'Nobody matches those filters.'}
          </div>
        )}
        {visible.map((c, i) => {
          const sel = tagMode && selected.has(c.id);
          const inn = !tagMode && isIn(c.id);
          const prev = visible[i-1];
          const divider = !tagMode && isIn(c.id) && (!prev || !isIn(prev.id)) && visible.some(r => !isIn(r.id));
          return (
            <div key={c.id}>
              {divider && <div style={S.grp}>Checked in</div>}
              <Row c={c} sel={sel} inn={inn} flash={flash.has(c.id)} tagMode={tagMode}
                primaryTime={primaryTime(c)} timeAuto={!c.slot}
                onRow={() => tagMode
                  ? setSelected(s => { const n = new Set(s); n.has(c.id) ? n.delete(c.id) : n.add(c.id); return n; })
                  : toggle(c)}
                onCard={() => tagMode
                  ? setSelected(s => { const n = new Set(s); n.has(c.id) ? n.delete(c.id) : n.add(c.id); return n; })
                  : setCard(c.id)}
                onAway={() => setAwayFor(c.id)}
                onBack={() => endAway(c.id)} />
            </div>
          );
        })}
      </div>

      {tagMode && (
        <div style={S.bulk}>
          <div style={S.bulkHd}>
            <b style={{ ...S.bulkB, ...(selected.size ? S.bulkBHot : null) }}>
              {selected.size ? `${selected.size} selected` : 'Tap names to select'}</b>
            <button type="button" style={S.bulkA} onClick={() => setSelected(new Set(visible.map(c => c.id)))}>All shown</button>
            <button type="button" style={S.bulkA} onClick={() => setSelected(new Set())}>Clear</button>
            <button type="button" style={{ ...S.bulkA, color:'#8E6516' }} onClick={() => { setTagMode(false); setSelected(new Set()); }}>Done</button>
          </div>
          <div style={S.presets}>
            <button type="button" disabled={!selected.size} style={{ ...S.preset, ...S.presetSess }}
              onClick={() => bulk({ session: sess.key }, sessLabel(sess.key))}>◉ {sessLabel(sess.key)} group</button>
            {COARSE.map(t => (
              <button key={t} type="button" disabled={!selected.size} style={{ ...S.preset, ...S.presetSlot }}
                onClick={() => bulk({ slot: t }, COARSE_LBL[t])}>{COARSE_LBL[t]}</button>
            ))}
            {[9,10,11].map(h => (
              <button key={h} type="button" disabled={!selected.size} style={{ ...S.preset, ...S.presetSlot }}
                onClick={() => bulk({ slot: `h${h}` }, hourLbl(h))}>{hourLbl(h)}</button>
            ))}
            {[...sportCounts.map(x => x[0]), ...SPORT_PRESETS.filter(s => !sportCounts.some(x => x[0] === s))].map(s => (
              <button key={s} type="button" disabled={!selected.size} style={S.preset}
                onClick={() => bulk({ sport: s }, s)}>{s}</button>
            ))}
          </div>
          <div style={S.bulkNew}>
            <input value={newTag} onChange={e => setNewTag(e.target.value)} style={S.bulkInput}
              placeholder="New sport or tag…" autoComplete="off" enterKeyHint="done"
              onKeyDown={e => { if (e.key === 'Enter') applyNew(); }} />
            <button type="button" style={S.bulkApply} onClick={applyNew}>Apply</button>
          </div>
        </div>
      )}

      {showSummary && (
        <Summary data={summary} onClose={() => { setShowSummary(false); setSummary(null); }} />
      )}
      {cardClient && (
        <Card c={cardClient} sess={sess} isIn={isIn(cardClient.id)}
          onClose={() => setCard(null)} onPatch={patch} onPay={pay}
          all={clients} onAdjust={adjustSessions} onBuy={buyPackage}
          onShare={shareWith} onUnshare={unshare} onDelete={removeClient}
          onToggle={() => { toggle(cardClient); setCard(null); }}
          onAway={() => { setAwayFor(cardClient.id); setCard(null); }}
          onMessage={() => { setMsgFor(cardClient.id); setCard(null); }} />
      )}
      {msgClient && (
        <MessageSheet c={msgClient}
          onSend={(body, optimistic) => sendMessage(msgClient.id, body, optimistic)}
          onSaveContact={body => saveContact(msgClient.id, body)}
          onClose={() => setMsgFor(null)} />
      )}
      {awayClient && (
        <AwaySheet c={awayClient}
          onSave={body => setAway(awayClient.id, body)}
          onClose={() => setAwayFor(null)} />
      )}
      {toast && <div style={S.toast}>{toast}</div>}
    </div>
  );

  function applyNew() {
    const v = newTag.trim();
    if (!v) return say('Type a tag first');
    if (!selected.size) return say('Pick some names first');
    const tag = v.replace(/\b\w/g, m => m.toUpperCase());
    bulk({ sport: tag }, tag);
    setNewTag('');
  }
}


/* ── Summary ───────────────────────────────────────────────────────────
   The job here is magnitude over time for ONE series, so: hero numbers for
   the headline, and a single-hue bar run underneath. No legend (one series —
   the title names it), no second axis, no number printed on every bar. */
function Summary({ data, onClose }) {
  const [unit, setUnit] = useState('week');
  if (!data) return (
    <>
      <div style={S.scrim} onClick={onClose} />
      <div style={S.sheet}><div style={S.grab} /><p style={S.loading}>Working it out…</p></div>
    </>
  );

  const cur = data[unit];
  const series = unit === 'week' ? data.weeks : data.months;
  const max = Math.max(1, ...series.map(b => b.n));
  const delta = cur.total - cur.prev;
  const label = unit === 'week' ? 'week' : 'month';
  const fmtBucket = iso => {
    const d = new Date(`${iso}T12:00:00Z`);
    return unit === 'week'
      ? d.toLocaleDateString(undefined, { month:'short', day:'numeric', timeZone:'UTC' })
      : d.toLocaleDateString(undefined, { month:'short', timeZone:'UTC' });
  };

  return (
    <>
      <div style={S.scrim} onClick={onClose} />
      <div style={S.sheet} role="dialog" aria-modal="true">
        <div style={S.sheetTop}>
          <div style={S.grab} />
          <button type="button" style={S.backBtn} onClick={onClose} aria-label="Back to the list">
            <span style={{ fontSize:19, lineHeight:1 }}>‹</span> Back
          </button>
        </div>
        <h2 style={S.sheetH2}>Sessions</h2>

        <div style={{ display:'flex', gap:6, margin:'2px 0 16px' }}>
          {['week','month'].map(u => (
            <button key={u} type="button" onClick={() => setUnit(u)} aria-pressed={unit === u}
              style={{ ...S.chip, ...(unit === u ? S.chipOn : null) }}>
              This {u}
            </button>
          ))}
        </div>

        <div style={S.kpis}>
          <div style={S.kpi}><b style={S.kpiBig}>{cur.total}</b><span style={S.kpiS}>This {label}</span></div>
          <div style={S.kpi}><b style={S.kpiBig}>{cur.people}</b><span style={S.kpiS}>People</span></div>
          <div style={S.kpi}>
            <b style={{ ...S.kpiBig, color: delta > 0 ? OK : delta < 0 ? FLAG : INK }}>
              {delta > 0 ? '+' : ''}{delta}
            </b>
            <span style={S.kpiS}>vs last {label}</span>
          </div>
        </div>

        <div style={S.secH}>Last {series.length} {label}s</div>
        <div style={S.chartWrap}>
          <div style={S.chart} role="img"
            aria-label={`Sessions per ${label}: ` + series.map(b => `${fmtBucket(b.start)} ${b.n}`).join(', ')}>
            {series.map((b, i) => {
              const last = i === series.length - 1;
              return (
                <div key={b.start} style={S.barCol} title={`${fmtBucket(b.start)} — ${b.n} sessions`}>
                  {last && <span style={S.barValue}>{b.n}</span>}
                  <div style={{ ...S.bar, height:`${Math.round((b.n / max) * 100)}%`,
                                background: last ? SKY : SKY_SOFT_BAR,
                                border: last ? 'none' : `1px solid ${SKY_EDGE}` }} />
                  <span style={{ ...S.barLbl, fontWeight: last ? 700 : 500,
                                 color: last ? SKY : STEEL_C }}>{fmtBucket(b.start)}</span>
                </div>
              );
            })}
          </div>
        </div>

        {data.paid_this_month.count > 0 && (
          <>
            <div style={S.secH}>Payments this month</div>
            <div style={S.fld}>
              <b style={{ fontSize:'1.4rem', fontWeight:700 }}>
                ${data.paid_this_month.total.toLocaleString(undefined, { minimumFractionDigits:2 })}
              </b>
              <span style={{ color:STEEL_C, fontSize:13.5 }}>
                {' '}across {data.paid_this_month.count} payment{data.paid_this_month.count === 1 ? '' : 's'}
              </span>
            </div>
          </>
        )}

        {data.top.length > 0 && (
          <>
            <div style={S.secH}>Most sessions this month</div>
            <div style={S.hist}>
              {data.top.map(t => (
                <div key={t.name} style={S.histRow}><span>{t.name}</span><em style={S.histEm}>{t.n}</em></div>
              ))}
            </div>
          </>
        )}

        {data.quiet.length > 0 && (
          <>
            <div style={S.secH}>Active but not in for 3+ weeks</div>
            <div style={S.hist}>
              {data.quiet.map(q => (
                <div key={q.name} style={S.histRow}>
                  <span>{q.name}</span>
                  <em style={S.histEm}>{q.last ? fmtDate(q.last) : 'never'}</em>
                </div>
              ))}
            </div>
          </>
        )}

        <div style={S.btnRow}>
          <button type="button" style={{ ...S.btn, ...S.btnPrimary }} onClick={onClose}>Done</button>
        </div>
      </div>
    </>
  );
}

/* ── Row ───────────────────────────────────────────────────────────────── */
function Row({ c, sel, inn, flash, tagMode, primaryTime, timeAuto, onRow, onCard, onAway, onBack }) {
  /* Swipe the name to the right to say why they're not here.
     Three things this has to get right, all learned the hard way elsewhere in
     this screen:
       - It must never fight the list scrolling. The axis is locked on the first
         few pixels of movement and a vertical drag is left entirely alone.
       - It must not open the card on release. The row's onClick is the card, so
         a swipe sets a flag the click checks.
       - Only rightward. A left swipe on a name is where a delete would go in
         every other app, and there is no delete here worth reaching by accident. */
  const [dx, setDx] = useState(0);
  const sw = useRef({ x0:0, y0:0, on:false, lock:null, moved:false });
  const REVEAL = 96, TRIGGER = 58;
  const away = c.away;

  /* Pointer events, not touch events, for two reasons that both bit.
     React attaches touchmove at the root as PASSIVE, so preventDefault() inside
     an onTouchMove is silently a no-op — the horizontal pan is actually held off
     by `touch-action: pan-y` on the wrapper, and calling preventDefault only
     bought a console warning. And touch handlers are dead weight on a laptop:
     the same drag now works with a mouse, so the gesture is usable at the desk
     and testable in a browser rather than only on a phone. */
  const swStart = e => {
    if (tagMode || (e.pointerType === 'mouse' && e.button !== 0)) return;
    sw.current = { x0:e.clientX, y0:e.clientY, on:true, lock:null, moved:false };
    // Keep receiving moves even if the finger slides off the row.
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* not fatal */ }
  };
  const swMove = e => {
    const s = sw.current;
    if (!s.on) return;
    const ddx = e.clientX - s.x0;
    const ddy = e.clientY - s.y0;
    if (s.lock === null) {
      if (Math.abs(ddx) < 7 && Math.abs(ddy) < 7) return;
      // Biased towards letting the list scroll: a swipe has to be clearly
      // horizontal to count, a scroll only has to be roughly vertical.
      s.lock = Math.abs(ddx) > Math.abs(ddy) * 1.5 ? 'x' : 'y';
    }
    if (s.lock !== 'x' || ddx <= 0) return;
    s.moved = true;
    // Rubber-band past the reveal width so it feels bounded rather than broken.
    setDx(ddx > REVEAL ? REVEAL + (ddx - REVEAL) * 0.18 : ddx);
  };
  const swEnd = e => {
    const s = sw.current;
    if (!s.on) return;
    s.on = false;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* already gone */ }
    const fired = s.moved && dx >= TRIGGER;
    setDx(0);
    if (fired) (away ? onBack : onAway)();
  };

  const due = dueState(c);
  // Sessions remaining, for the arrangements where that is a real number.
  const left = (c.billing === 'package' || c.billing === 'one_on_one') && c.remaining != null
    ? c.remaining : null;
  const bs = [];
  const bd = untilAnniv(c.dob);
  if (bd === 0) bs.push(['🎂','Birthday today']);
  else if (bd !== null && bd <= 3) bs.push(['🎈',`Birthday in ${bd} day${bd>1?'s':''}`]);
  const an = untilAnniv(c.since);
  if (an === 0) bs.push(['🎉',`Gym anniversary — ${tenure(c.since)}`]);
  else if (an !== null && an <= 5) bs.push(['🎊',`Anniversary in ${an} day${an>1?'s':''}`]);
  const next = Math.ceil((c.v + 1) / 250) * 250;
  if (c.v >= 100 && next - c.v <= 3) bs.push(['⭐',`${next} visits coming up`]);
  const ago = daysAgo(c.last);
  if (ago !== null && ago > 45) bs.push(['💤',`Not in for ${Math.round(ago/30)} months`]);
  // Monthly dues, same treatment as a birthday: visible on the row, not a report
  // you have to remember to run.

  const seen = inn ? 'Checked in'
    : ago === null ? 'No visits yet'
    : ago <= 0 ? 'In today' : ago === 1 ? 'Yesterday'
    : ago < 7 ? `${ago} days ago` : ago < 14 ? 'Last week'
    : ago < 60 ? `${Math.round(ago/7)} weeks ago` : `${Math.round(ago/30)} months ago`;

  const sports = (c.sports || []).slice(0, 3);
  return (
    <div style={S.swipeWrap}>
      {/* What the swipe reveals. Sits behind the row, so it appears to be
          underneath it rather than sliding in alongside. */}
      <div style={S.swipeBack} aria-hidden={dx === 0}>
        <span style={{ ...S.swipeIco, ...(dx >= TRIGGER ? S.swipeIcoArmed : null) }}>
          {away ? '↩' : awayOf(away?.reason).emoji}
        </span>
        <span style={S.swipeLbl}>{away ? 'Back' : 'Away'}</span>
      </div>
      <div
        onClick={() => { if (!sw.current.moved) onCard(); }}
        onPointerDown={swStart} onPointerMove={swMove}
        onPointerUp={swEnd} onPointerCancel={swEnd}
        style={{
          ...S.row,
          ...(sel ? S.rowSel : inn ? S.rowIn : away ? S.rowAway : null),
          ...(flash ? S.rowFlash : null),
          transform: dx ? `translateX(${dx}px)` : '',
          transition: dx ? 'none' : 'transform .2s cubic-bezier(.32,.72,0,1)',
        }}>
      <div style={S.rowBody}>
        <span style={{ ...S.nm, ...(inn ? S.nmIn : sel ? S.nmSel : null),
                       ...(away && !inn ? S.nmAway : null) }}>{c.n}</span>
        {away && <span style={S.bdg} title={awaySummary(away)}>{awayOf(away.reason).emoji}</span>}
        {/* 'ok' means paid up and nothing due for weeks — it must NOT get a dot.
            `due &&` treated it as truthy, so everybody who had just paid wore an
            amber warning: Cindy and Dan both paid this morning and both got
            flagged. A dot that appears when someone is square is worse than no
            dot, because it trains you to ignore the real ones. */}
        {(due === 'over' || due === 'soon') && (
          <span style={{ ...S.dueDot, background: due === 'over' ? FLAG : AMBER }}
            title={due === 'over'
              ? `Owes — was due ${fmtDate(c.dueOn)}`
              : `Payment due ${fmtDate(c.dueOn)}`} />
        )}
        {bs.length > 0 && <span style={S.badges}>{bs.map((b, i) =>
          <span key={i} title={b[1]} style={S.bdg}>{b[0]}</span>)}</span>}
        <span style={{ ...S.meta, ...(inn ? S.metaIn : null) }}>
          {/* Why they're not here leads the line, ahead of even the money —
              it is the answer to the question the coach is asking when he
              can't find someone. */}
          {away && <strong style={{ color:SKY }}>{awaySummary(away)} · </strong>}
          {/* Only where a balance means anything. A monthly member never bought
              sessions, so their "remaining" is just visits counted against a
              total that was never there — a big red -412 on the row would be
              alarming and wrong. Package and one-on-one people are the ones who
              actually run out, and running out is worth knowing BEFORE the tap
              rather than after. */}
          {left != null && (
            <strong style={{ color: left <= 0 ? FLAG : left <= 3 ? AMBER : SKY }}>
              {left} left{c.householdId ? ' (shared)' : ''} · </strong>
          )}
          {primaryTime && <span style={{ ...S.tg, ...S.tgSlot, ...(timeAuto ? S.tgAuto : null) }}>{tagLbl(primaryTime)}</span>}
          {sports.map(s => <span key={s} style={S.tg}>{s}</span>)}
          {(c.sports || []).length > 3 && <span style={{ ...S.tg, ...S.tgMore }}>+{c.sports.length - 3}</span>}
          {due === 'over' && (
            <strong style={{ color:FLAG }}>
              Owes{c.monthly ? ` $${c.monthly}` : ''} · </strong>
          )}
          {due === 'soon' && <strong style={{ color:AMBER }}>Due soon · </strong>}
          {seen} · {c.v.toLocaleString()} visits
        </span>
      </div>
      <button type="button" style={S.tickHit}
        aria-label={inn ? `Undo check-in for ${c.n}` : `Check in ${c.n}`}
        aria-pressed={inn}
        onClick={e => { e.stopPropagation(); onRow(); }}>
        <span style={{ ...S.tick, ...(inn ? S.tickIn : sel ? S.tickSel : null) }}>
          {(inn || sel) && <span style={S.tickMark} />}
        </span>
      </button>
      {!tagMode && <span style={S.cardBtn} aria-hidden="true">›</span>}
      </div>
    </div>
  );
}

/* ── Message sheet ─────────────────────────────────────────────────────── */
/* Templates that fill the box rather than send by themselves. Every one of
   these gets read by a parent, and the difference between a good note and a
   creepy one is the sentence Glen adds — so the drafts are a starting point he
   edits, never a thing that fires on one tap. */
const MSG_TEMPLATES = [
  { kind:'birthday', emoji:'🎂', label:'Happy birthday',
    make:(c, to) => to.is_guardian
      ? `Happy birthday to ${c.first}! Hope they have a great day — we'll see them at the gym.`
      : `Happy birthday, ${c.first}! Hope you have a great day.` },
  { kind:'reminder', emoji:'⏰', label:'Miss you',
    make:(c, to) => to.is_guardian
      ? `Haven't seen ${c.first} in a bit — everything alright? The door's open whenever they're ready.`
      : `Haven't seen you in a bit, ${c.first} — everything alright? Door's open whenever you are.` },
  { kind:'dues', emoji:'💵', label:'Payment due',
    make:(c, to) => `Quick note — ${to.is_guardian ? `${c.first}'s` : 'your'} membership`
      + `${c.monthly ? ` ($${c.monthly})` : ''} is due. No rush, just so it doesn't slip.` },
  { kind:'note', emoji:'✍️', label:'Blank', make:() => '' },
];

function MessageSheet({ c, onSend, onClose, onSaveContact }) {
  const to = c.to || {};
  const has = !!(to.email || to.phone);
  const [newEmail, setNewEmail] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [saving, setSaving] = useState(false);
  const first = c.n.split(' ')[0];
  const ctx = { first, monthly: c.monthly };
  const initial = untilAnniv(c.dob) === 0 ? MSG_TEMPLATES[0] : MSG_TEMPLATES[3];
  const [kind, setKind] = useState(initial.kind);
  const [body, setBody] = useState(() => initial.make(ctx, to));
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(null);

  const pick = t => { setKind(t.kind); setBody(t.make(ctx, to)); };

  /* The text goes through the phone's own Messages app, not through a server.
     There is no SMS provider here, and a text from the gym's real number is the
     one people actually reply to. We tell the server afterwards so the send is
     still on the record — see 040_client_messages. */
  const text = () => {
    if (!to.phone || !body.trim()) return;
    window.location.href = `sms:${to.phone.replace(/[^\d+]/g, '')}?&body=${encodeURIComponent(body)}`;
    onSend({ channel:'sms', kind, body }, true);
  };
  const email = async () => {
    if (!to.email || !body.trim() || busy) return;
    setBusy(true);
    const ok = await onSend({ channel:'email', kind, body }, false);
    setBusy(false);
    if (ok) setSent('email');
  };

  return (
    <>
      <div style={S.scrim} onClick={onClose} />
      <div style={{ ...S.sheet, maxHeight:'88vh', overflowY:'auto' }}>
        <div style={S.awayTop}>
          <button type="button" style={S.tagBtn} onClick={onClose}>Close</button>
          <b style={S.awayName}>{c.n}</b>
          <span style={{ width:56 }} />
        </div>

        <div style={{ ...S.toBar, ...(has ? null : S.toBarNone) }}>
          <b style={{ ...S.toB, ...(has ? null : S.toBNone) }}>
            {has ? to.name : `No way to reach ${first}`}
          </b>
          <span style={{ ...S.toNote, ...(has ? null : S.toNoteNone) }}>
            {has
              ? `${to.is_guardian ? 'Parent or guardian' : 'The client'}`
                + `${to.email ? ` · ${to.email}` : ''}${to.phone ? ` · ${to.phone}` : ''}`
              : 'Nothing on file — no email, no number, no guardian. Contact details '
                + 'normally arrive with a signed waiver; add one here and it sticks.'}
          </span>
        </div>

        {!has && (
          /* The dead end made useful. Somebody tapped Message meaning to say
             something, so the first thing offered is the way to make that
             possible — not an apology. */
          <>
            <div style={S.fld}>
              <label style={S.lbl}>Their email</label>
              <input type="email" value={newEmail} onChange={e => setNewEmail(e.target.value)}
                placeholder="name@example.com" autoComplete="off" style={S.input} />
            </div>
            <div style={S.fld}>
              <label style={S.lbl}>Their mobile</label>
              <input type="tel" value={newPhone} onChange={e => setNewPhone(e.target.value)}
                placeholder="414 555 0134" autoComplete="off" style={S.input} />
            </div>
            <div style={S.btnRow}>
              <button type="button" disabled={saving || !(newEmail.trim() || newPhone.trim())}
                style={{ ...S.btn, ...S.btnPrimary,
                         ...((saving || !(newEmail.trim() || newPhone.trim())) ? S.btnOff : null) }}
                onClick={async () => {
                  setSaving(true);
                  await onSaveContact({
                    email: newEmail.trim() || null,
                    cell_phone: newPhone.trim() || null,
                  });
                  setSaving(false);
                }}>
                {saving ? 'Saving…' : 'Save contact'}
              </button>
            </div>
            <p style={S.hint}>
              Saved to their card, so it's there next time — and on the waiver record.
            </p>
          </>
        )}

        <label style={S.lbl}>Quick message</label>
        <div style={S.awayWhy}>
          {MSG_TEMPLATES.map(t => (
            <button key={t.kind} type="button" onClick={() => pick(t)}
              style={{ ...S.chip, ...S.chipSlot, ...(kind === t.kind ? S.chipSlotOn : null) }}>
              {t.emoji} {t.label}
            </button>
          ))}
        </div>

        <div style={S.fld}>
          <textarea value={body} onChange={e => setBody(e.target.value)} maxLength={900}
            placeholder="Type your message…"
            style={{ ...S.input, minHeight:110, resize:'vertical' }} />
        </div>
        <p style={S.hint}>
          Read it before you send — these go to a parent more often than not.
          The email signs off as Coach Glen; the text comes from your own number.
        </p>

        <div style={S.btnRow}>
          <button type="button" onClick={text} disabled={!to.phone || !body.trim()}
            style={{ ...S.btn, ...((!to.phone || !body.trim()) ? S.btnOff : null) }}>
            {to.phone ? '💬 Text' : 'No number'}
          </button>
          <button type="button" onClick={email} disabled={!to.email || !body.trim() || busy}
            style={{ ...S.btn, ...S.btnPrimary,
                     ...((!to.email || !body.trim() || busy) ? S.btnOff : null) }}>
            {busy ? 'Sending…' : sent === 'email' ? '✓ Sent' : to.email ? '✉ Email' : 'No email'}
          </button>
        </div>
      </div>
    </>
  );
}

/* ── Away sheet ────────────────────────────────────────────────────────── */
/* Why, when, and where — in that order, because the reason is the only part
   the coach always knows. The dates are a range picked by tapping twice, and
   both taps are optional: "gone, back when they're back" is a real answer and
   the most common one. */
function AwaySheet({ c, onSave, onClose }) {
  const [reason, setReason] = useState(c.away?.reason || 'vacation');
  const [note, setNote] = useState(c.away?.note || '');
  const [from, setFrom] = useState(c.away?.since || todayISO());
  // Stored as the LAST day away; the sheet and the row both talk in "back on".
  const [to, setTo] = useState(c.away?.back ? addDaysISO(c.away.back, -1) : null);
  const [picking, setPicking] = useState('to');
  const [cursor, setCursor] = useState(() => {
    const [y, m] = (c.away?.since || todayISO()).split('-').map(Number);
    return { y, m: m - 1 };
  });

  const first = new Date(Date.UTC(cursor.y, cursor.m, 1));
  const pad = first.getUTCDay();
  const days = new Date(Date.UTC(cursor.y, cursor.m + 1, 0)).getUTCDate();
  const cells = [...Array(pad).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  const step = n => setCursor(k => {
    const t = new Date(Date.UTC(k.y, k.m + n, 1));
    return { y: t.getUTCFullYear(), m: t.getUTCMonth() };
  });

  const tap = iso => {
    if (picking === 'from' || iso < from) { setFrom(iso); setTo(null); setPicking('to'); }
    else { setTo(iso); setPicking('from'); }
  };

  return (
    <>
      <div style={S.scrim} onClick={onClose} />
      <div style={{ ...S.sheet, maxHeight:'88vh', overflowY:'auto' }}>
        <div style={S.awayTop}>
          <button type="button" style={S.tagBtn} onClick={onClose}>Cancel</button>
          <b style={S.awayName}>{c.n}</b>
          <button type="button" style={{ ...S.tagBtn, ...S.tagBtnOn }}
            onClick={() => onSave({ reason, note: note.trim() || null, starts_on: from, ends_on: to })}>
            Save
          </button>
        </div>

        <label style={S.lbl}>Why</label>
        <div style={S.awayWhy}>
          {AWAY_REASONS.map(r => (
            <button key={r.key} type="button" onClick={() => setReason(r.key)}
              style={{ ...S.chip, ...S.chipSlot, ...(reason === r.key ? S.chipSlotOn : null) }}>
              {r.emoji} {r.label}
            </button>
          ))}
        </div>

        <label style={S.lbl}>When</label>
        <div style={S.cal}>
          <div style={S.calHead}>
            <button type="button" style={S.calNav} onClick={() => step(-1)} aria-label="Previous month">‹</button>
            <b style={S.calMon}>
              {new Date(Date.UTC(cursor.y, cursor.m, 1))
                .toLocaleDateString(undefined, { month:'long', year:'numeric', timeZone:'UTC' })}
            </b>
            <button type="button" style={S.calNav} onClick={() => step(1)} aria-label="Next month">›</button>
          </div>
          <div style={S.calGrid}>
            {['S','M','T','W','T','F','S'].map((d, i) => <span key={i} style={S.calDow}>{d}</span>)}
            {cells.map((d, i) => {
              if (!d) return <span key={`p${i}`} />;
              const iso = isoOf(cursor.y, cursor.m, d);
              const isFrom = iso === from, isTo = iso === to;
              const inRange = to && iso > from && iso < to;
              return (
                <button key={iso} type="button" onClick={() => tap(iso)}
                  style={{ ...S.calDay,
                    ...(inRange ? S.calDayIn : null),
                    ...(isFrom || isTo ? S.calDayOn : null) }}>
                  {d}
                </button>
              );
            })}
          </div>
        </div>
        <p style={S.hint}>
          {picking === 'to' && !to
            ? `Away from ${fmtShort(from)}. Tap the last day away, or just save — "back when they're back" is fine.`
            : `Away ${fmtShort(from)} – ${fmtShort(to)} · back ${fmtShort(addDaysISO(to, 1))}. Tap again to start over.`}
        </p>

        <label style={S.lbl}>Where</label>
        <div style={S.fld}>
          <input value={note} onChange={e => setNote(e.target.value)} maxLength={120}
            placeholder="Florida" style={S.input} />
        </div>
        <p style={S.hint}>Optional. It shows on their row while they are away.</p>

        {c.away && (
          <div style={S.btnRow}>
            <button type="button" style={S.btn}
              onClick={() => onSave(null)}>They're back — clear it</button>
          </div>
        )}
      </div>
    </>
  );
}

/* ── Card ──────────────────────────────────────────────────────────────── */
function Card({ c, sess, isIn, onClose, onPatch, onPay, onToggle, all, onAdjust, onBuy, onShare, onUnshare, onDelete, onAway, onMessage }) {
  const [shareQ, setShareQ] = useState('');
  const [buySess, setBuySess] = useState('');
  const [buyAmt, setBuyAmt] = useState('');
  /* Loaded per card rather than shipped with the roster: 2,826 clients times
     their whole purchase history is a payload nobody opening a check-in screen
     asked for. `bump` re-reads it after an adjust or a purchase so the list
     never disagrees with the number above it. */
  const [pkgs, setPkgs] = useState(null);
  const [bump, setBump] = useState(0);
  useEffect(() => {
    let alive = true;
    setPkgs(null);
    api.checkinPackages(c.id)
      .then(r => { if (alive) setPkgs(r.packages || []); })
      .catch(() => { if (alive) setPkgs([]); });
    return () => { alive = false; };
  }, [c.id, bump]);
  const [amt, setAmt] = useState(c.monthly ?? '');
  useEffect(() => { setAmt(c.monthly ?? ''); }, [c.id, c.monthly]);
  const sheetRef = useRef(null);
  const drag = useRef({ y0: 0, dy: 0, on: false });

  /* Drag the handle down to dismiss. It looked draggable and wasn't, which is
     worse than not having one. Bound to the top bar only, so it can never
     fight with scrolling the card's own content. */
  const dragStart = e => {
    drag.current = { y0: e.touches[0].clientY, dy: 0, on: true };
    if (sheetRef.current) sheetRef.current.style.transition = 'none';
  };
  const dragMove = e => {
    if (!drag.current.on) return;
    const dy = e.touches[0].clientY - drag.current.y0;
    if (dy < 0) return;                       // upward drag does nothing
    drag.current.dy = dy;
    if (sheetRef.current) sheetRef.current.style.transform = `translateY(${dy}px)`;
    e.preventDefault();
  };
  const dragEnd = () => {
    if (!drag.current.on) return;
    const { dy } = drag.current;
    drag.current.on = false;
    const el = sheetRef.current;
    if (!el) return;
    el.style.transition = 'transform .22s cubic-bezier(.32,.72,0,1)';
    if (dy > 90) { el.style.transform = 'translateY(100%)'; setTimeout(onClose, 180); }
    else el.style.transform = '';
  };
  const mates = all.filter(x => c.householdId && x.householdId === c.householdId && x.id !== c.id);
  const pinned = c.pinned || [];
  const learnedKeys = Object.keys(c.sess || {}).filter(k => !pinned.includes(k))
    .sort((a, b) => c.sess[b].n - c.sess[a].n);

  const addSport = () => {
    const v = window.prompt('Sport or tag:');
    if (!v || !v.trim()) return;
    const tag = v.trim().replace(/\b\w/g, m => m.toUpperCase());
    if ((c.sports || []).includes(tag)) return;
    onPatch(c.id, { sports: [...(c.sports || []), tag] });
  };

  return (
    <>
      <div style={S.scrim} onClick={onClose} />
      <div ref={sheetRef} style={S.sheet} role="dialog" aria-modal="true">
        <div style={S.sheetTop}
          onTouchStart={dragStart} onTouchMove={dragMove}
          onTouchEnd={dragEnd} onTouchCancel={dragEnd}>
          <div style={S.grab} />
          <button type="button" style={S.backBtn} onClick={onClose} aria-label="Back to the list">
            <span style={{ fontSize:19, lineHeight:1 }}>‹</span> Back
          </button>
        </div>
        <h2 style={S.sheetH2}>{c.n}</h2>
        <p style={S.sheetSub}>
          {c.since ? <>Client since {fmtDate(c.since)} · {tenure(c.since)}</> : 'No visit history yet'}
        </p>

        <div style={S.kpis}>
          <div style={S.kpi}><b style={S.kpiB}>{c.v.toLocaleString()}</b><span style={S.kpiS}>Visits</span></div>
          <div style={S.kpi}><b style={S.kpiB}>{c.last ? fmtDate(c.last).replace(/,.*/, '') : '—'}</b><span style={S.kpiS}>Last in</span></div>
          <div style={S.kpi}><b style={S.kpiB}>{(c.d || []).slice(0,3).map(d => DAYS[d]).join(' ') || '—'}</b><span style={S.kpiS}>Usual days</span></div>
        </div>

        {!c.waiver && <div style={S.warn}><b style={S.warnB}>No waiver on file</b>Nothing signed in the new system yet.</div>}

        <div style={S.secH}>Membership status</div>
        {/* Away sits above the status dropdown because it is the one people
            reach for most, and because it is emphatically not the same thing:
            'Paused' suspends a membership, this just says where they are. Also
            here, not only on the swipe, so it's reachable on a laptop. */}
        <div style={{ ...S.fld, ...(c.away ? S.fldAway : null) }}>
          <label style={S.lbl}>Away — vacation, work, injured</label>
          <div style={S.awayRow}>
            <span style={S.awayNow}>
              {c.away ? `${awayOf(c.away.reason).emoji} ${awaySummary(c.away)}` : 'Here as usual'}
            </span>
            <button type="button" style={S.tagBtn} onClick={onAway}>
              {c.away ? 'Change' : 'Mark away'}
            </button>
          </div>
        </div>
        <div style={{ ...S.fld, ...(c.status && c.status !== 'active' ? S.fldPaused : null) }}>
          <label style={S.lbl}>Are they still coming in?</label>
          <select value={c.status || 'active'} style={S.input}
            onChange={e => onPatch(c.id, { status: e.target.value })}>
            {Object.entries(STATUS_LBL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            {!(c.status in STATUS_LBL) && c.status &&
              <option value={c.status}>{c.status}</option>}
          </select>
        </div>
        {c.status && c.status !== 'active' && (
          <div style={S.fld}>
            <label style={S.lbl}>Note — why, and when they might be back</label>
            <textarea defaultValue={c.statusNote || ''} style={{ ...S.input, minHeight: 40 }}
              placeholder="Injured, travelling, moved away…"
              onBlur={e => onPatch(c.id, { status_note: e.target.value })} />
          </div>
        )}

        <div style={S.secH}>Groups</div>
        <div style={S.fld}>
          <label style={S.lbl}>Which sessions they come to</label>
          <div style={S.taglist}>
            {pinned.map(k => (
              <span key={k} style={{ ...S.t, ...S.tSess }}>{sessLabel(k)}
                <button type="button" style={S.tX} aria-label="Remove"
                  onClick={() => onPatch(c.id, { sessions: pinned.filter(x => x !== k) })}>×</button>
              </span>
            ))}
            {learnedKeys.map(k => {
              const e = c.sess[k], hs = e.hours || {};
              const top = Object.keys(hs).sort((a, b) => hs[b] - hs[a])[0];
              const consistent = top != null && e.n >= 2 && hs[top] / e.n >= 0.6;
              return <span key={k} style={{ ...S.t, ...S.tLearned }}>
                {sessLabel(k)}{consistent ? ` · ${hourLbl(+top)}` : ''} ({e.n})</span>;
            })}
            {!pinned.length && !learnedKeys.length &&
              <span style={S.dim}>Nothing learned yet — check-ins will fill this in.</span>}
            {!pinned.includes(sess.key) && (
              <button type="button" style={S.addBtn}
                onClick={() => onPatch(c.id, { sessions: [...pinned, sess.key] })}>+ {sessLabel(sess.key)}</button>
            )}
          </div>
        </div>

        <div style={S.secH}>Tags</div>
        <div style={S.fld}>
          <label style={S.lbl}>Sports — as many as they play</label>
          <div style={S.taglist}>
            {(c.sports || []).map(s => (
              <span key={s} style={S.t}>{s}
                <button type="button" style={S.tX} aria-label={`Remove ${s}`}
                  onClick={() => onPatch(c.id, { sports: c.sports.filter(x => x !== s) })}>×</button>
              </span>
            ))}
            <button type="button" style={S.addBtn} onClick={addSport}>+ Add sport</button>
          </div>
        </div>
        <div style={S.fld}>
          <label style={S.lbl}>Usual time</label>
          <select value={c.slot || ''} style={S.input}
            onChange={e => onPatch(c.id, { slot: e.target.value || null })}>
            <option value="">Auto — from check-ins</option>
            <optgroup label="General">
              {COARSE.map(t => <option key={t} value={t}>{COARSE_LBL[t]}</option>)}
            </optgroup>
            <optgroup label="Specific hour — summer">
              {HOURS.map(h => <option key={h} value={`h${h}`}>{hourLbl(h)}</option>)}
            </optgroup>
          </select>
        </div>

        <div style={S.secH}>Membership</div>
        <div style={S.fld}>
          <label style={S.lbl}>How they pay</label>
          <select value={c.billing || 'monthly'} style={S.input}
            onChange={e => onPatch(c.id, { billing_type: e.target.value })}>
            {Object.entries(BILLING_LBL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>

        <div style={S.secH}>Sessions</div>
        <div style={S.fld}>
          <label style={S.lbl}>
            {c.household ? `Shared pool — ${c.household} household` : 'Sessions remaining'}
          </label>
          {c.householdId && (
            <>
              <p style={{ ...S.hint, margin:'0 0 8px' }}>
                Checking any of these people in comes off this same number.
              </p>
              <div style={{ ...S.taglist, marginBottom:8 }}>
                {mates.map(m => (
                  <span key={m.id} style={{ ...S.t, ...S.tSess }}>{m.n}
                    <button type="button" style={S.tX} aria-label={`Remove ${m.n} from the pool`}
                      onClick={() => onUnshare(m.id)}>×</button>
                  </span>
                ))}
                <span style={{ ...S.t, ...S.tSess, opacity:.65 }}>{c.n} (this card)
                  <button type="button" style={S.tX} aria-label="Take them off the pool"
                    onClick={() => onUnshare(c.id)}>×</button>
                </span>
              </div>
            </>
          )}
          {/* The number and its Adjust button come FIRST, directly under the
              "Sessions remaining" heading. They used to sit below a name-search
              box, so the first input under that heading was not the balance at
              all — Glen typed 20 into it, then -2, and both silently searched
              for a client by that name. Order was the actual bug; the label was
              only half a fix. */}
          <div style={{ display:'flex', gap:8, alignItems:'center' }}>
            <b style={{ fontSize:'1.5rem', fontWeight:700, flex:'1 1 auto',
                        fontVariantNumeric:'tabular-nums',
                        color: c.billing === 'monthly' && c.remaining < 0 ? '#6F7880' : undefined }}>
              {c.remaining == null ? '—' : c.remaining}
            </b>
            <button type="button" style={S.smallBtn} onClick={() => {
              const v = window.prompt('Correct the number — add or remove sessions '
                + '(use a minus to remove). For sessions somebody PAID for, use "They paid for sessions" below instead.');
              if (v && !isNaN(Number(v)) && Number(v) !== 0)
                onAdjust(c.id, Number(v),
                  window.prompt('Why? Shows on their card under "Where these sessions '
                    + 'came from" — e.g. "evened up after the ledger import".') || '')
                  .then(() => setBump(b => b + 1));
            }}>Adjust</button>
          </div>

          {(() => {
            // A native select with 180 names in it is unusable on a phone.
            // Type a few letters, tap the person.
            const pool = all.filter(x => x.id !== c.id
              && !(c.householdId && x.householdId === c.householdId));
            const q = shareQ.trim().toLowerCase();
            const hits = q ? pool.filter(x => x.n.toLowerCase().includes(q)
                                           || (x.s || '').toLowerCase().includes(q))
                              .sort((a, b) => a.n.localeCompare(b.n)).slice(0, 8)
                           : [];
            return (
              <div style={{ marginBottom:10 }}>
                <label style={S.lbl}>Share this balance with someone</label>
                <input value={shareQ} onChange={e => setShareQ(e.target.value)}
                  style={S.input2} autoComplete="off" inputMode="text"
                  placeholder={c.householdId ? 'Add someone to the pool — type a NAME'
                                             : 'Type a NAME to share these sessions with'} />
                {q && (
                  <div style={S.shareList}>
                    {hits.length === 0 && (
                      <div style={S.shareNone}>
                        {/* Catches "-2" and "20" alike. The first version missed
                            the minus sign, so taking sessions OFF — the exact
                            thing someone reaches for here — still fell through
                            to a useless "Nobody matches". */}
                        {/^[-+]?[\d.$\s]+$/.test(shareQ)
                          ? `This box shares a balance with another person — it isn't `
                            + `where sessions are added or removed. To change the number `
                            + `by ${shareQ.trim()}, use the Adjust button above.`
                          : `Nobody matches “${shareQ.trim()}”`}
                      </div>
                    )}
                    {hits.map(x => (
                      <button key={x.id} type="button" style={S.shareHit}
                        onClick={() => { onShare(c.id, x.id); setShareQ(''); }}>
                        <span>{x.n}</span>
                        <em style={S.shareMeta}>
                          {x.household ? `in ${x.household} pool` : `${x.v.toLocaleString()} visits`}
                        </em>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}
        </div>

        {/* Money changed hands for sessions. Emphatically not Adjust: an
            adjustment says "the number was wrong", a purchase says "she paid
            for twenty", and filing one as the other gets the balance right
            while quietly losing the money and the pattern. Cindy's card is 25
            for $300 in February, 25 for $300 in August — that history is the
            arrangement, and it only exists if purchases are recorded as
            purchases. */}
        <div style={S.fld}>
          <label style={S.lbl}>They paid for sessions</label>
          <div style={S.buyRow}>
            <input value={buySess} onChange={e => setBuySess(e.target.value)}
              inputMode="decimal" placeholder="20" aria-label="How many sessions"
              style={{ ...S.input2, ...S.buyN }} />
            <span style={S.buyX}>sessions for</span>
            <input value={buyAmt} onChange={e => setBuyAmt(e.target.value)}
              inputMode="decimal" placeholder="$300" aria-label="How much they paid"
              style={{ ...S.input2, ...S.buyN }} />
            <button type="button" style={{ ...S.smallBtn, ...S.buyBtn }}
              disabled={!(Number(buySess) > 0)}
              onClick={() => {
                onBuy(c.id, Number(buySess), buyAmt.replace(/[^0-9.]/g, '') || null)
                  .then(() => setBump(b => b + 1));
                setBuySess(''); setBuyAmt('');
              }}>Add</button>
          </div>
          <p style={S.hint}>
            Adds to their balance and keeps the amount on their record. Leave the
            money blank if it was off the books.
          </p>
          {c.billing === 'monthly' && c.remaining < 0 && (
            <p style={S.hint}>
              Not a debt. Monthly members never had sessions “purchased” in the old
              ledger, so every visit subtracted from a total that was never there.
              Adjust by {-c.remaining} to even them up.
            </p>
          )}
        </div>

        {/* Where the "why?" goes. Adjust has always asked for a reason and
            written it to the row, and nothing ever showed it back — a prompt
            that swallows what you type is worse than one that never asks. This
            is also the only place the difference between a purchase and a
            correction is legible: 25 for $300 is an arrangement, "evened up
            after the ledger import" is a repair. */}
        {pkgs !== null && pkgs.length > 0 && (
          <div style={S.fld}>
            <label style={S.lbl}>Where these sessions came from</label>
            <div style={S.pkgList}>
              {pkgs.map(p => (
                <div key={p.id} style={S.pkgRow}>
                  <b style={{ ...S.pkgN, color: p.sessions < 0 ? FLAG : p.isAdjustment ? BRASS : OK }}>
                    {p.sessions > 0 ? '+' : ''}{p.sessions}
                  </b>
                  <span style={S.pkgBody}>
                    <span style={S.pkgTop}>
                      {fmtDate(p.on)}
                      {p.amount != null && <b style={S.pkgAmt}> · ${p.amount}</b>}
                      {p.isAdjustment && <em style={S.pkgTag}> correction</em>}
                      {p.needsReview && <em style={{ ...S.pkgTag, color:FLAG }}> needs review</em>}
                    </span>
                    {p.note && <span style={S.pkgNote}>{p.note}</span>}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
        {(c.billing === 'monthly' || c.billing === 'package') && (
          <>
            <div style={S.secH}>Monthly payment</div>
            <div style={{ ...S.fld, ...(dueState(c) === 'over' ? S.fldOverdue : dueState(c) === 'soon' ? S.fldPaused : null) }}>
              <label style={S.lbl}>
                {c.lastPaid
                  ? `Last paid ${fmtDate(c.lastPaid)} · next due ${fmtDate(c.dueOn)}`
                  : 'No payment recorded yet'}
              </label>
              <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                <span style={{ fontSize:18, fontWeight:700, color:STEEL_C }}>$</span>
                <input type="number" inputMode="decimal" placeholder="How much"
                  value={amt} onChange={e => setAmt(e.target.value)}
                  style={{ ...S.input, flex:'1 1 auto', fontSize:18, fontWeight:700 }}
                  onBlur={e => { const v = e.target.value.trim();
                    onPatch(c.id, { monthly_amount: v === '' ? null : Number(v) }); }} />
                <button type="button" style={S.payBtn}
                  onClick={() => { const v = String(amt).trim();
                    onPay(c.id, v === '' ? null : Number(v)); }}>
                  Mark paid today
                </button>
              </div>
              {c.householdId && (
                <p style={S.hint}>
                  One bill for the whole {c.household} pool — shared with{' '}
                  {all.filter(x => x.householdId === c.householdId && x.id !== c.id)
                      .map(x => x.n).join(', ')}. Record it once, on either card.
                </p>
              )}
            </div>
            <div style={S.fld}>
              <label style={S.lbl}>Paid on a different day</label>
              <input type="date" style={S.input}
                onChange={e => e.target.value && onPay(c.id, c.monthly, e.target.value)} />
            </div>
          </>
        )}

        <div style={S.secH}>Details</div>
        <div style={S.fld}>
          <label style={S.lbl}>Birthday</label>
          <div style={S.bdayRow}>
            <input type="date" defaultValue={c.dob || ''} style={{ ...S.input, flex:'1 1 auto' }}
              onChange={e => onPatch(c.id, { date_of_birth: e.target.value || null })} />
            {/* Right next to the birthday, because "it's her birthday" and
                "say something" are one thought.

                Never disabled, even with nothing to send to. A greyed-out
                button explains itself through a tooltip, and a phone has no
                hover — so on the device this screen is actually used on, it is
                a rectangle that does nothing at all. Tapping opens the sheet,
                which says who is missing and takes the number right there. */}
            <button type="button" onClick={onMessage}
              style={{ ...S.msgBtn, ...((!c.to?.email && !c.to?.phone) ? S.msgBtnBare : null) }}>
              {(c.to?.email || c.to?.phone) ? '✉ Message' : '✉ Add contact'}
            </button>
          </div>
          {(c.to?.email || c.to?.phone) && (
            <p style={S.bdayHint}>
              Goes to <b>{c.to.name}</b>{c.to.is_guardian ? ' — their parent or guardian' : ''}
            </p>
          )}
        </div>
        <div style={S.fld}>
          <label style={S.lbl}>Notes</label>
          <textarea defaultValue={c.note || ''} style={{ ...S.input, minHeight:46, resize:'vertical' }}
            placeholder="Anything worth remembering…"
            onBlur={e => onPatch(c.id, { notes: e.target.value })} />
        </div>

        {c.pb > 0 && (
          <>
            <div style={S.secH}>Package history</div>
            <div style={{ ...S.warn, background:'#fff', borderColor:'#d9ddd8', color:'#454d52' }}>
              <b style={{ ...S.warnB, color:'#8A6410' }}>Needs reconciling</b>
              The ledger records <strong>{c.pb.toLocaleString()}</strong> sessions purchased against{' '}
              <strong>{c.v.toLocaleString()}</strong> visits. Subtracting gives {(c.pb - c.v).toLocaleString()},
              which is almost certainly not real — purchases and visits shared one column for years.
              The import flags this rather than guessing.
            </div>
          </>
        )}

        {(c.h || []).length > 0 && (
          <>
            <div style={S.secH}>Recent visits</div>
            <div style={S.hist}>
              {c.h.map(d => (
                <div key={d} style={S.histRow}>
                  <span>{fmtDate(d)}</span>
                  <em style={S.histEm}>{DAYS[new Date(`${d}T12:00:00Z`).getUTCDay()]}</em>
                </div>
              ))}
            </div>
          </>
        )}

        <button type="button" style={S.deleteBtn} onClick={() => onDelete(c.id)}>
          Delete {c.n}
          {c.v > 0 && <span style={S.deleteWarn}> · destroys {c.v.toLocaleString()} visits</span>}
        </button>

        <div style={S.btnRow}>
          <button type="button" style={S.btn} onClick={onClose}>Close</button>
          <button type="button" style={{ ...S.btn, ...S.btnPrimary }} onClick={onToggle}>
            {isIn ? 'Undo check-in' : 'Check in'}</button>
        </div>
      </div>
    </>
  );
}

/* ── styles ────────────────────────────────────────────────────────────── */
const STEEL_C = '#6F7880';
const SKY_SOFT_BAR = '#DDEDF4', SKY_EDGE = '#A9CBDD';
const AMBER = '#8A6410';
const INK = '#16191B', STEEL = '#6F7880', HAIR = '#D9DDD8', HAIRS = '#B4BAB3';
const BRASS = '#8E6516', BRASS_S = '#F4E9D2', OK = '#2C6B48', OK_S = '#DCEFE3';
const FLAG = '#9E3226', FLAG_S = '#F7E2DD', SKY = '#1F5C7A', SKY_S = '#DDEDF4';
const GROUND = '#F2F3F1';

const S = {
  wrap: { maxWidth:560, margin:'0 auto', background:GROUND, minHeight:'100vh',
          fontFamily:'Archivo, -apple-system, "Segoe UI", system-ui, sans-serif', color:INK },
  loading: { textAlign:'center', padding:60, color:STEEL },
  err: { margin:20, padding:16, background:FLAG_S, border:`1px solid ${FLAG}`, borderRadius:10, color:FLAG },
  hdr: { position:'sticky', top:0, zIndex:30, background:GROUND, borderBottom:`1px solid ${HAIR}`, padding:'14px 14px 0' },
  hdrTop: { display:'flex', alignItems:'baseline', gap:9, marginBottom:12 },
  h1: { fontSize:'1.25rem', fontWeight:700, margin:0, flex:'1 1 auto', letterSpacing:'-.01em' },
  tally: { fontSize:12.5, fontWeight:600, color:OK, background:OK_S, border:`1px solid ${OK}`,
           padding:'3px 9px', borderRadius:99, whiteSpace:'nowrap', fontVariantNumeric:'tabular-nums' },
  tallyZero: { color:STEEL, background:'#E9EBE8', borderColor:HAIRS },
  tagBtn: { position:'relative', overflow:'hidden', display:'inline-block',
            fontFamily:'inherit', fontSize:12.5, fontWeight:600, cursor:'pointer', padding:'4px 10px',
            borderRadius:99, background:'#fff', color:'#454D52', border:`1px solid ${HAIRS}` },
  tagBtnOn: { background:BRASS, color:'#fff', borderColor:BRASS },
  sessBar: { display:'flex', alignItems:'baseline', gap:8, margin:'-4px 0 11px', padding:'9px 12px',
             borderRadius:9, background:SKY_S, border:`1px solid ${SKY}` },

  // Catching up on an earlier day. Brass rather than the session bar's blue,
  // because the whole point is that this does NOT look like the normal state:
  // every tap on this screen is landing on a different date.
  catchBar: { display:'flex', alignItems:'center', flexWrap:'wrap', gap:'2px 8px',
              margin:'-4px 0 11px', padding:'9px 12px', borderRadius:9,
              background:BRASS_S, border:`1px solid ${BRASS}` },
  catchB: { fontSize:13.5, color:BRASS, fontWeight:700, flex:'0 0 auto' },
  catchNote: { fontSize:12, color:BRASS, opacity:.85, flex:'1 1 auto', minWidth:0 },
  catchBtn: { flex:'0 0 auto', fontFamily:'inherit', fontSize:12.5, fontWeight:700, cursor:'pointer',
              padding:'4px 12px', borderRadius:99, background:BRASS, color:'#fff', border:`1px solid ${BRASS}` },
  tagBtnCatch: { background:BRASS, color:'#fff', borderColor:BRASS },
  // The input covers its label so the whole pill is the tap target, but stays
  // invisible — the label already says what it does.
  dateInput: { position:'absolute', inset:0, width:'100%', height:'100%',
               opacity:0, border:0, padding:0, cursor:'pointer' },
  sessB: { fontSize:13.5, color:SKY, fontWeight:700, flex:'0 0 auto' },
  sessNote: { fontSize:12, color:SKY, opacity:.85, flex:'1 1 auto', minWidth:0,
              overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' },
  searchWrap: { position:'relative', marginBottom:11 },
  search: { width:'100%', height:46, padding:'0 40px', fontFamily:'inherit', fontSize:16.5, color:INK,
            background:'#fff', border:`1px solid ${HAIRS}`, borderRadius:10, outline:'none', boxSizing:'border-box' },
  sIco: { position:'absolute', left:13, top:'50%', transform:'translateY(-50%)', color:STEEL, fontSize:15, pointerEvents:'none' },
  sClr: { position:'absolute', right:6, top:'50%', transform:'translateY(-50%)', width:34, height:34,
          border:0, background:'transparent', color:STEEL, fontSize:19, borderRadius:8, cursor:'pointer' },
  chips: { display:'flex', gap:6, overflowX:'auto', padding:'0 0 11px' },
  chip: { flex:'0 0 auto', fontFamily:'inherit', fontSize:12.5, fontWeight:600, padding:'7px 12px',
          borderRadius:99, cursor:'pointer', whiteSpace:'nowrap', background:'#fff', color:'#454D52', border:`1px solid ${HAIRS}` },
  chipOn: { background:INK, color:GROUND, borderColor:INK },
  chipSport: { color:BRASS, borderColor:BRASS, background:BRASS_S },
  chipSportOn: { background:BRASS, color:'#fff' },
  chipOwes: { color:FLAG, borderColor:FLAG, background:FLAG_S },
  chipOwesOn: { background:FLAG, color:'#fff' },
  dueDot: { display:'inline-block', width:9, height:9, borderRadius:'50%',
            marginLeft:7, verticalAlign:'middle', flex:'0 0 auto' },
  chipSlot: { color:SKY, borderColor:SKY, background:SKY_S },
  chipSlotOn: { background:SKY, color:'#fff' },
  chipC: { opacity:.62, fontVariantNumeric:'tabular-nums', marginLeft:4 },
  divider: { flex:'0 0 auto', width:1, background:HAIRS, margin:'5px 3px' },
  list: { padding:'8px 10px 0' },
  // position:relative is load-bearing, not decoration. The swipe reveal behind
  // this row is absolutely positioned, and a positioned element paints above a
  // static one whatever the DOM order says — so without this the blue "Away"
  // backing covers every name on the list permanently. (Which it did, once.)
  // The margin lives on swipeWrap now; leaving it here too showed a band of the
  // backing under every row.
  row: { position:'relative', zIndex:1,
         display:'flex', alignItems:'center', gap:11, minHeight:66, padding:'8px 10px 8px 13px',
         background:'#fff', border:`1px solid ${HAIR}`, borderRadius:11, cursor:'pointer' },
  rowIn: { background:OK_S, borderColor:OK },
  rowSel: { background:BRASS_S, borderColor:BRASS },
  rowFlash: { boxShadow:`0 0 0 4px rgba(142,101,22,.35)` },
  rowBody: { flex:'1 1 auto', minWidth:0 },
  nm: { display:'inline-block', fontSize:17, fontWeight:600, maxWidth:'100%', overflow:'hidden',
        textOverflow:'ellipsis', whiteSpace:'nowrap', verticalAlign:'bottom',
        borderBottom:`1px dotted ${HAIRS}`, paddingBottom:1 },
  nmIn: { color:OK },
  nmSel: { color:BRASS },
  badges: { display:'inline-flex', gap:4, marginLeft:6, verticalAlign:'middle' },
  bdg: { fontSize:13, lineHeight:1 },
  meta: { display:'block', fontSize:12.5, color:STEEL, marginTop:4, fontVariantNumeric:'tabular-nums',
          overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' },
  metaIn: { color:OK, opacity:.85 },
  tg: { display:'inline-block', fontSize:10.5, fontWeight:700, padding:'1.5px 6px', borderRadius:4,
        marginRight:4, verticalAlign:1, background:BRASS_S, color:BRASS, border:`1px solid ${BRASS}` },
  tgSlot: { background:SKY_S, color:SKY, borderColor:SKY },
  tgAuto: { borderStyle:'dashed' },
  tgMore: { background:'transparent', color:STEEL, borderColor:HAIRS },
  tickHit: { flex:'0 0 auto', width:52, height:52, border:0, background:'transparent',
             padding:0, margin:'-4px 0', cursor:'pointer',
             display:'flex', alignItems:'center', justifyContent:'center' },
  tick: { flex:'0 0 auto', width:30, height:30, borderRadius:'50%', border:`2px solid ${HAIRS}`,
          background:'#fff', position:'relative' },
  tickIn: { background:OK, borderColor:OK },
  tickSel: { background:BRASS, borderColor:BRASS },
  tickMark: { position:'absolute', left:9.5, top:4.5, width:7, height:14,
              border:'solid #fff', borderWidth:'0 2.5px 2.5px 0', transform:'rotate(42deg)' },
  cardBtn: { flex:'0 0 auto', width:20, textAlign:'center', color:STEEL, fontSize:20 },

  // Swipe-to-mark-away. The wrapper clips, the backing sits under the row, and
  // touchAction:'pan-y' hands vertical gestures straight back to the scroller
  // so the list never feels sticky.
  swipeWrap: { position:'relative', overflow:'hidden', borderRadius:11, marginBottom:7, touchAction:'pan-y' },
  swipeBack: { position:'absolute', inset:0, display:'flex', flexDirection:'column',
               alignItems:'flex-start', justifyContent:'center', gap:2, paddingLeft:16,
               background:SKY_S, borderRadius:11, border:`1px solid ${SKY}` },
  swipeIco: { width:34, height:34, borderRadius:'50%', background:'#fff', border:`1px solid ${SKY}`,
              display:'flex', alignItems:'center', justifyContent:'center', fontSize:16, color:SKY,
              transition:'transform .12s ease' },
  swipeIcoArmed: { transform:'scale(1.16)', background:SKY, color:'#fff' },
  swipeLbl: { fontSize:10.5, fontWeight:700, letterSpacing:'.06em', textTransform:'uppercase', color:SKY },
  rowAway: { background:SKY_S, borderColor:SKY_EDGE },
  nmAway: { color:SKY },

  // Away sheet
  awayTop: { display:'flex', alignItems:'center', gap:10, marginBottom:16 },
  awayName: { flex:'1 1 auto', textAlign:'center', fontSize:16, fontWeight:700,
              overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' },
  awayWhy: { display:'flex', flexWrap:'wrap', gap:7, marginBottom:18 },
  cal: { background:'#fff', border:`1px solid ${HAIR}`, borderRadius:10, padding:'10px 10px 6px' },
  calHead: { display:'flex', alignItems:'center', gap:8, marginBottom:6 },
  calMon: { flex:'1 1 auto', textAlign:'center', fontSize:14.5, fontWeight:700, color:SKY },
  calNav: { width:34, height:34, border:0, background:'transparent', color:SKY,
            fontSize:20, cursor:'pointer', borderRadius:8 },
  calGrid: { display:'grid', gridTemplateColumns:'repeat(7, 1fr)', gap:2 },
  calDow: { textAlign:'center', fontSize:10.5, fontWeight:700, color:STEEL, padding:'2px 0 4px' },
  calDay: { fontFamily:'inherit', fontSize:14, aspectRatio:'1 / 1', border:0, borderRadius:8,
            background:'transparent', color:INK, cursor:'pointer', fontVariantNumeric:'tabular-nums' },
  calDayIn: { background:SKY_S, borderRadius:0 },
  calDayOn: { background:SKY, color:'#fff', fontWeight:700, borderRadius:8 },
  grp: { fontSize:11, letterSpacing:'.12em', textTransform:'uppercase', color:STEEL, fontWeight:700, padding:'14px 4px 7px' },
  empty: { textAlign:'center', color:STEEL, padding:'44px 20px', fontSize:14.5, lineHeight:1.6 },
  bulk: { position:'fixed', left:0, right:0, bottom:0, zIndex:45, maxWidth:560, margin:'0 auto',
          background:GROUND, borderTop:`1px solid ${HAIRS}`, padding:'12px 14px 16px',
          boxShadow:'0 -6px 24px rgba(0,0,0,.13)' },
  bulkHd: { display:'flex', alignItems:'center', gap:8, marginBottom:9 },
  bulkB: { fontSize:14.5, flex:'1 1 auto' },
  bulkBHot: { color:BRASS },
  bulkA: { fontFamily:'inherit', fontSize:13, fontWeight:600, cursor:'pointer', background:'none',
           border:0, color:STEEL, padding:'4px 5px' },
  presets: { display:'flex', gap:6, overflowX:'auto', paddingBottom:9 },
  preset: { flex:'0 0 auto', fontFamily:'inherit', fontSize:13, fontWeight:600, cursor:'pointer',
            padding:'8px 13px', borderRadius:99, whiteSpace:'nowrap', background:'#fff',
            color:BRASS, border:`1px solid ${BRASS}` },
  presetSlot: { color:SKY, borderColor:SKY },
  presetSess: { background:SKY, color:'#fff', borderColor:SKY },
  bulkNew: { display:'flex', gap:7 },
  bulkInput: { flex:'1 1 auto', height:42, padding:'0 13px', fontFamily:'inherit', fontSize:15.5,
               color:INK, background:'#fff', border:`1px solid ${HAIRS}`, borderRadius:9, outline:'none', minWidth:0 },
  bulkApply: { flex:'0 0 auto', fontFamily:'inherit', fontSize:14.5, fontWeight:600, cursor:'pointer',
               padding:'0 17px', borderRadius:9, background:INK, color:GROUND, border:0 },
  scrim: { position:'fixed', inset:0, background:'rgba(10,12,14,.5)', zIndex:48 },
  sheet: { position:'fixed', left:0, right:0, bottom:0, zIndex:50, maxWidth:560, margin:'0 auto',
           maxHeight:'92vh', overflowY:'auto', background:GROUND, borderRadius:'18px 18px 0 0',
           borderTop:`1px solid ${HAIRS}`, padding:'0 16px 32px' },
  sheetTop: { position:'sticky', top:0, zIndex:2, background:GROUND,
              margin:'0 -16px', padding:'0 16px 8px',
              borderBottom:`1px solid ${HAIR}`,
              touchAction:'none', cursor:'grab' },
  grab: { width:38, height:5, borderRadius:99, background:HAIRS, margin:'9px auto 8px' },
  backBtn: { display:'inline-flex', alignItems:'center', gap:4, fontFamily:'inherit',
             fontSize:15, fontWeight:600, color:BRASS, background:'transparent',
             border:0, padding:'6px 8px 6px 0', cursor:'pointer', minHeight:38 },
  sheetH2: { fontSize:'1.45rem', fontWeight:700, margin:'8px 0 2px', letterSpacing:'-.015em' },
  sheetSub: { color:STEEL, fontSize:13.5, margin:'0 0 16px' },
  kpis: { display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:8, marginBottom:16 },
  kpi: { background:'#fff', border:`1px solid ${HAIR}`, borderRadius:10, padding:'11px 12px' },
  kpiB: { display:'block', fontSize:'1.15rem', fontWeight:700, fontVariantNumeric:'tabular-nums', lineHeight:1.1 },
  kpiS: { display:'block', fontSize:10.5, letterSpacing:'.08em', textTransform:'uppercase', color:STEEL, marginTop:3 },
  fldPaused: { borderColor:'#8A6410', background:'#FAF0D5' },
  fldAway: { borderColor:SKY, background:SKY_S },
  bdayRow: { display:'flex', alignItems:'center', gap:8 },
  msgBtn: { flex:'0 0 auto', fontFamily:'inherit', fontSize:13, fontWeight:700, cursor:'pointer',
            padding:'9px 13px', borderRadius:9, background:SKY, color:'#fff', border:`1px solid ${SKY}`,
            whiteSpace:'nowrap' },
  // Not a dead button — a quieter live one, so it reads as "something to do
  // here" rather than "broken".
  msgBtnBare: { background:'#fff', color:SKY, borderColor:SKY },
  toBarNone: { background:BRASS_S, borderColor:BRASS },
  toBNone: { color:BRASS },
  toNoteNone: { color:BRASS, whiteSpace:'normal', lineHeight:1.45 },
  bdayHint: { margin:'7px 0 0', fontSize:12, color:STEEL },
  toBar: { display:'flex', flexDirection:'column', gap:2, margin:'0 0 16px', padding:'10px 12px',
           borderRadius:9, background:SKY_S, border:`1px solid ${SKY}` },
  toB: { fontSize:14.5, fontWeight:700, color:SKY },
  toNote: { fontSize:12, color:SKY, opacity:.85, overflow:'hidden', textOverflow:'ellipsis' },
  btnOff: { opacity:.45, cursor:'not-allowed' },
  buyRow: { display:'flex', alignItems:'center', gap:6, flexWrap:'wrap' },
  buyN: { flex:'0 1 82px', minWidth:64, textAlign:'center', fontWeight:700 },
  buyX: { flex:'0 0 auto', fontSize:12.5, color:'#6F7880' },
  buyBtn: { flex:'0 0 auto', marginLeft:'auto' },
  pkgList: { display:'flex', flexDirection:'column', gap:1 },
  pkgRow: { display:'flex', gap:10, alignItems:'baseline', padding:'6px 0',
            borderTop:`1px solid ${HAIR}` },
  pkgN: { flex:'0 0 46px', textAlign:'right', fontSize:14.5, fontWeight:700,
          fontVariantNumeric:'tabular-nums' },
  pkgBody: { flex:'1 1 auto', minWidth:0, display:'flex', flexDirection:'column', gap:1 },
  pkgTop: { fontSize:12.5, color:INK },
  pkgAmt: { color:OK, fontWeight:700 },
  pkgTag: { fontSize:11, color:BRASS, fontStyle:'normal', fontWeight:700,
            textTransform:'uppercase', letterSpacing:'.05em' },
  pkgNote: { fontSize:12, color:STEEL, lineHeight:1.4 },
  awayRow: { display:'flex', alignItems:'center', gap:10, marginTop:2 },
  awayNow: { flex:'1 1 auto', minWidth:0, fontSize:14, color:INK,
             overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' },
  fldOverdue: { borderColor:'#9E3226', background:'#F7E2DD' },
  hint: { margin:'9px 0 0', fontSize:12.5, lineHeight:1.5, color:'#6F7880' },
  addPersonBtn: { fontFamily:'inherit', fontSize:15, fontWeight:600, cursor:'pointer',
                  padding:'12px 18px', borderRadius:10, background:INK, color:GROUND,
                  border:0, maxWidth:'100%' },
  input2: { width:'100%', height:44, padding:'0 13px', fontFamily:'inherit', fontSize:15.5,
            color:INK, background:'#fff', border:`1px solid ${HAIRS}`, borderRadius:9,
            outline:'none', boxSizing:'border-box' },
  shareList: { marginTop:6, border:`1px solid ${HAIR}`, borderRadius:9, overflow:'hidden', background:'#fff' },
  shareHit: { display:'flex', width:'100%', alignItems:'baseline', justifyContent:'space-between',
              gap:10, fontFamily:'inherit', fontSize:15, fontWeight:600, textAlign:'left',
              padding:'12px 13px', background:'#fff', color:INK, border:0,
              borderBottom:`1px solid ${HAIR}`, cursor:'pointer' },
  shareMeta: { fontStyle:'normal', fontSize:12, fontWeight:500, color:STEEL, whiteSpace:'nowrap' },
  shareNone: { padding:'12px 13px', fontSize:14, color:STEEL },
  smallBtn: { flex:'0 0 auto', fontFamily:'inherit', fontSize:13.5, fontWeight:600, cursor:'pointer',
              padding:'9px 13px', borderRadius:9, background:'#fff', color:'#8E6516',
              border:'1px solid #8E6516' },
  payBtn: { flex:'0 0 auto', fontFamily:'inherit', fontSize:14, fontWeight:600, cursor:'pointer',
            padding:'10px 14px', borderRadius:9, background:'#2C6B48', color:'#fff', border:0 },
  fld: { background:'#fff', border:`1px solid ${HAIR}`, borderRadius:10, padding:'11px 13px', marginBottom:8 },
  lbl: { display:'block', fontSize:10.5, letterSpacing:'.09em', textTransform:'uppercase',
         color:STEEL, fontWeight:700, marginBottom:6 },
  input: { width:'100%', fontFamily:'inherit', fontSize:15.5, color:INK, background:'transparent',
           border:0, outline:'none', padding:0, boxSizing:'border-box' },
  taglist: { display:'flex', flexWrap:'wrap', gap:6 },
  t: { fontSize:13, fontWeight:600, padding:'5px 9px', borderRadius:7, background:BRASS_S,
       color:BRASS, border:`1px solid ${BRASS}`, display:'inline-flex', alignItems:'center', gap:6 },
  tSess: { background:SKY_S, color:SKY, borderColor:SKY },
  tLearned: { background:'transparent', color:STEEL, borderColor:HAIRS, borderStyle:'dashed' },
  tX: { background:'none', border:0, color:'inherit', fontSize:15, cursor:'pointer', padding:0, lineHeight:1, opacity:.7 },
  addBtn: { fontFamily:'inherit', fontSize:13, fontWeight:600, padding:'5px 10px', borderRadius:7,
            background:'#E9EBE8', color:'#454D52', border:`1px dashed ${HAIRS}`, cursor:'pointer' },
  dim: { fontSize:13.5, color:STEEL },
  secH: { fontSize:10.5, letterSpacing:'.11em', textTransform:'uppercase', color:BRASS, fontWeight:700,
          margin:'20px 0 8px', borderTop:`1px solid ${HAIR}`, paddingTop:12 },
  warn: { background:FLAG_S, border:`1px solid ${FLAG}`, borderRadius:10, padding:'11px 13px',
          fontSize:13.5, color:FLAG, marginBottom:8 },
  warnB: { display:'block', marginBottom:2 },
  hist: { background:'#fff', border:`1px solid ${HAIR}`, borderRadius:10, overflow:'hidden' },
  histRow: { display:'flex', justifyContent:'space-between', padding:'9px 13px', fontSize:14,
             borderBottom:`1px solid ${HAIR}`, fontVariantNumeric:'tabular-nums' },
  histEm: { color:STEEL, fontStyle:'normal', fontSize:13 },
  btnRow: { display:'flex', gap:8, marginTop:18 },
  btn: { flex:'1 1 0', fontFamily:'inherit', fontSize:15, fontWeight:600, padding:13, borderRadius:10,
         cursor:'pointer', border:`1px solid ${HAIRS}`, background:'#fff', color:INK },
  btnPrimary: { background:INK, color:GROUND, borderColor:INK },
  kpiBig: { display:'block', fontSize:'1.7rem', fontWeight:700,
            fontVariantNumeric:'tabular-nums', lineHeight:1.05 },
  chartWrap: { overflowX:'auto', paddingBottom:4 },
  chart: { display:'flex', alignItems:'flex-end', gap:6, height:150, minWidth:'100%',
           padding:'18px 2px 0', borderBottom:`1px solid ${HAIRS}` },
  barCol: { flex:'1 1 0', minWidth:26, display:'flex', flexDirection:'column',
            alignItems:'center', justifyContent:'flex-end', height:'100%', position:'relative' },
  bar: { width:'100%', borderRadius:'4px 4px 0 0', minHeight:3, boxSizing:'border-box' },
  barValue: { position:'absolute', top:-16, fontSize:12, fontWeight:700, color:SKY,
              fontVariantNumeric:'tabular-nums' },
  barLbl: { marginTop:6, fontSize:10.5, whiteSpace:'nowrap' },
  deleteBtn: { display:'block', width:'100%', marginTop:22, fontFamily:'inherit', fontSize:14.5,
               fontWeight:600, padding:'12px', borderRadius:10, cursor:'pointer',
               background:'transparent', color:FLAG, border:`1px solid ${FLAG}` },
  deleteWarn: { fontWeight:500, opacity:.75, fontSize:12.5 },
  toast: { position:'fixed', left:'50%', bottom:26, transform:'translateX(-50%)', zIndex:60,
           background:INK, color:GROUND, padding:'11px 18px', borderRadius:99, fontSize:14.5,
           fontWeight:600, boxShadow:'0 6px 22px rgba(0,0,0,.22)', whiteSpace:'nowrap',
           maxWidth:'88vw', overflow:'hidden', textOverflow:'ellipsis' },
};
