// Round 4: due TIME helpers shared by commands.js, provider.js and the card/list text.
// Storage scheme (tasks.due_at TIMESTAMP): a date-only due is stored as 'YYYY-MM-DD 00:00:00' (hasTime = false); a due with a
// time is 'YYYY-MM-DD HH:mm:00' (a typed 00:00 is stored as 00:01 so it stays distinguishable). Local TZ (default Asia/Kolkata).
const TZ = (() => { try { new Intl.DateTimeFormat('en-US', { timeZone: process.env.TZ }); return process.env.TZ || 'Asia/Kolkata'; } catch (e) { return 'Asia/Kolkata'; } })();
const DAY_FMT = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const pad = (n) => String(n).padStart(2, '0');
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const PERIOD = {
  subah: 'am', savere: 'am', morning: 'am', dopahar: 'noon', afternoon: 'noon', shaam: 'pm', sham: 'pm', evening: 'pm', raat: 'night', night: 'night',
};

// Time words starting at w[i]: "5 baje", "5 pm", "5pm", "5:30 pm", "17:30", "subah 10", "shaam 6 baje", "raat 9"
// -> {time:'HH:mm', len} | null. A bare number is NOT a time (needs baje / am / pm / ':' / a period word).
function parseTimeAt(w, i) {
  let j = i;
  let period = null;
  const p0 = String(w[j] || '').toLowerCase();
  if (PERIOD[p0]) { period = PERIOD[p0]; j++; }
  const m = String(w[j] || '').toLowerCase().match(/^(\d{1,2})(?::(\d{2}))?(am|pm)?$/);
  if (!m) return null;
  let h = +m[1]; const min = m[2] ? +m[2] : 0;
  let ap = m[3] || null;
  j++;
  let baje = false;
  const nx = String(w[j] || '').toLowerCase();
  if (!ap && (nx === 'am' || nx === 'pm')) { ap = nx; j++; } else if (nx === 'baje' || nx === 'bje') { baje = true; j++; }
  if (!(ap || baje || m[2] || period)) return null;
  if (min > 59 || h > 23 || (ap && (h < 1 || h > 12))) return null;
  if (ap === 'pm') { if (h < 12) h += 12; } else if (ap === 'am') { if (h === 12) h = 0; } else if (h <= 12) {
    if (period === 'am') { if (h === 12) h = 0; } else if (period === 'noon') { if (h < 7) h += 12; } else if (period === 'pm') { if (h < 12) h += 12; } else if (period === 'night') { if (h >= 6 && h < 12) h += 12; } else if (baje && h >= 1 && h <= 6) h += 12; // "5 baje" = 5 pm
  }
  return { time: pad(h) + ':' + pad(min), len: j - i };
}

// Combined value for tasks.js: 'YYYY-MM-DD' or 'YYYY-MM-DD HH:mm'.
const join = (date, time) => (date && time ? date + ' ' + time : date);

function todayYmd() { return DAY_FMT.format(new Date()); }
const h12 = (hh, mm) => ((+hh % 12) || 12) + (+mm ? ':' + mm : '') + ' ' + (+hh < 12 ? 'am' : 'pm');

// "Aaj 5 pm" / "Kal 10 am" / "Fri 5 pm" / "25 Nov 5:30 pm"; date only -> "Aaj" etc. Pass dueDate ('YYYY-MM-DD') and dueAt (or null).
function fmtDue(dueDate, dueAt) {
  if (!dueDate) return '';
  const [y, m, d] = dueDate.split('-').map(Number);
  const t0 = todayYmd().split('-').map(Number);
  const n = Math.round((Date.UTC(y, m - 1, d) - Date.UTC(t0[0], t0[1] - 1, t0[2])) / 86400000);
  let day;
  if (n === 0) day = 'Aaj'; else if (n === 1) day = 'Kal'; else if (n === -1) day = 'Kal (gaya)';
  else if (n > 1 && n < 7) day = DOW[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]; else day = d + ' ' + MON[m - 1];
  return dueAt ? day + ' ' + h12(dueAt.slice(11, 13), dueAt.slice(14, 16)) : day;
}

module.exports = { parseTimeAt, join, fmtDue, TZ };
