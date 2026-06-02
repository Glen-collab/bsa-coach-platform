// Challenge score formatting. Time-based challenges (unit like "minutes"/"sec"/
// "mm:ss") store the value as TOTAL SECONDS and render as a clock; everything
// else renders as a plain number + unit.

const TIME_UNITS = new Set([
  'mm:ss', 'time', 'min', 'mins', 'minute', 'minutes', 'sec', 'secs', 'second', 'seconds',
]);

export function isTimeUnit(unit) {
  return !!unit && TIME_UNITS.has(String(unit).trim().toLowerCase());
}

// seconds → "MM:SS.hh" under an hour, "H:MM:SS.hh" an hour+
export function formatClock(totalSeconds) {
  const n = Number(totalSeconds);
  if (!Number.isFinite(n)) return '--';
  const h = Math.floor(n / 3600);
  const m = Math.floor((n % 3600) / 60);
  const s = n - h * 3600 - m * 60;
  const ss = s.toFixed(2).padStart(5, '0');
  const mm = String(m).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

// "8:30" / "1:05:30.5" / bare seconds → total seconds
export function parseClock(input) {
  const s = String(input).trim();
  if (!s) return NaN;
  const hms = s.match(/^(\d+):(\d{1,2}):(\d{1,2}(?:\.\d+)?)$/);
  if (hms) return (+hms[1]) * 3600 + (+hms[2]) * 60 + parseFloat(hms[3]);
  const ms = s.match(/^(\d+):(\d{1,2}(?:\.\d+)?)$/);
  if (ms) return (+ms[1]) * 60 + parseFloat(ms[2]);
  return parseFloat(s);
}

// Display a stored score: clock for time challenges, else number + unit.
export function formatScore(value, unit) {
  if (value == null || value === '') return '--';
  if (isTimeUnit(unit)) return formatClock(value);
  const n = Number(value);
  const num = Number.isFinite(n) ? n.toLocaleString() : value;
  return unit ? `${num} ${unit}` : `${num}`;
}
