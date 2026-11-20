// Slash commands typed in any chat ("/task anubhav crm pe filter banana hai due fri"). Called from routes/chats.js
// after a text message is saved, BEFORE the natural-language engine; handle() returns true when the message was a
// command (then the engine is skipped). The command message itself stays a normal text message (linked to its task).
// Results: task changes -> public task card in the chat; help / lists / pickers / errors -> ephemeral (sender only).
// All task writes go through src/tasks.js (source 'command'), so permissions, task_events and ws 'task' events match.
// Also here: handleLinked (replies to cards / reply chains / "#N" messages -> notes, answers) and edit/delete propagation.
const pool = require('../db');
const T = require('../tasks');
const S = require('../status');
const users = require('../users');
const settings = require('../settings');
const provider = require('./provider');
const { bestMatches, cleanToken } = require('./names');
const rt = require('../realtime');
const bot = require('./bot');
const DT = require('./dueTime');

const CMD_RE = /^\/([a-z][a-z_-]*)(?:\s+([\s\S]*))?$/i;
const ALIASES = {
  'completed-task': 'done', complete: 'done', completed: 'done', 'update-task': 'update', 'reassigned-task': 'reassign',
  'reassign-task': 'reassign', review: 'testing', mytask: 'mytasks', 'my-tasks': 'mytasks', list: 'tasks', 'new-task': 'task',
  description: 'desc', start: 'coding', doing: 'coding', plan: 'planning', merge: 'merged', 'change-merged': 'merged',
  change_merged: 'merged', delete: 'close', add: 'assign', remove: 'unassign',
  re: 'reassign', // Round 4: /re = /reassign
};
// Round 4: disabled (simple create->done): /update /planning /coding /testing /merged /status /assign /unassign /ask /desc /close /reopen /due
const HELP = [
  { cmd: '/task', args: '@naam [@naam2] <kaam> [due kal 5 pm|fri|25 nov]', desc: 'Naya task (sirf admin). Ek ya zyada log = ek task, sabke naam. Naam nahi = apna private task' },
  { cmd: '/done', args: '[Task N] [@naam]', desc: 'Task Done (admin: sabke liye ya sirf @naam ka, jiska task hai: apna part)' },
  { cmd: '/re', args: 'Task N @naam [@naam2]', desc: 'Task kisi aur ko do (sirf admin). Ek insaan ho to badal jata hai; kai hon to "@Anubhav @Uzair" = Anubhav se Uzair ko' },
  { cmd: '/tasks', args: '[naam]', desc: 'Open tasks (sabke ya ek insaan ke)' },
  { cmd: '/mytasks', args: '', desc: 'Mere open tasks' },
  { cmd: '/help', args: '', desc: 'Saare commands. Task card ko reply = us task ka note. "@AI <sawal>" ya "/ai <sawal>" = AI se poochho' },
];
// const HELP = [
//   { cmd: '/task', args: '@naam [@naam2] <kaam> [due kal 5 pm|fri|25 nov]', desc: 'Naya task (ek ya zyada log; "khud" / naam nahi = apne liye)' },
//   { cmd: '/update', args: '[#id] <note>', desc: 'Progress note ("plan kar raha" = Planning, "code kar raha" = Coding, "testing baaki" = Testing, "merge ho gaya" = Change merged, "ho gaya" = Done)' },
//   { cmd: '/planning', args: '[#id] [note]', desc: 'Mera status: Planning' },
//   { cmd: '/coding', args: '[#id] [note]', desc: 'Mera status: Coding (/start)' },
//   { cmd: '/testing', args: '[#id] [note]', desc: 'Mera status: Testing' },
//   { cmd: '/merged', args: '[#id] [note]', desc: 'Mera status: Change merged' },
//   { cmd: '/done', args: '[#id] [@naam] [note]', desc: 'Mera part Done (admin/banane wala: sabka, ya sirf @naam ka)' },
//   { cmd: '/status', args: '#id <step>', desc: 'Status badlo (todo, planning, coding, testing, merged, done); step nahi = /ask' },
//   { cmd: '/assign', args: '#id @naam', desc: 'Task mein aur log jodo' },
//   { cmd: '/unassign', args: '#id @naam', desc: 'Task se kisi ko hatao (kam se kam ek bacha rahe)' },
//   { cmd: '/reassign', args: '#id @naam [@naam2]', desc: 'Task naye logon ko do (purane hat jayenge)' },
//   { cmd: '/due', args: '#id <date>', desc: 'Due date badlo (aaj, kal, parso, fri, 25 nov, 2026-11-30, none)' },
//   { cmd: '/close', args: '#id [reason]', desc: 'Task band karo (banane wala ya admin; /delete bhi chalega)' },
//   { cmd: '/reopen', args: '#id', desc: 'Band task wapas kholo' },
//   { cmd: '/ask', args: '#id', desc: 'Jinka task hai unse status poochho (notification jayega; card ko reply karke jawab)' },
//   { cmd: '/desc', args: '#id <text>', desc: 'Task ka description badlo (ya task card ko reply karke "desc: ...")' },
//   { cmd: '/tasks', args: '[naam]', desc: 'Open tasks (sabke ya ek insaan ke)' },
//   { cmd: '/mytasks', args: '', desc: 'Mere open tasks' },
//   { cmd: '/help', args: '', desc: 'Saare commands. Task card ya "#12" wale message ko reply = us task ka note (DM ke notes bhi task timeline par dikhte hain)' },
// ];
const LABEL = S.LABEL;
const PERSON_FILLER = new Set(['tumko', 'tumhe', 'tumhein', 'tujhe', 'tum', 'aapko', 'apko', 'aap', 'ko', 'ji', 'bhai', 'sir', 'ne',
  'ka', 'ki', ':', '-', ',']);
// words meaning "myself" (only as a leading word / "@me")
const SELF_WORDS = new Set(['me', 'mujhe', 'mujhko', 'khud', 'self', 'myself', 'apne', 'mere']);
const JOINERS = new Set(['aur', 'and', '&', '+', ',']);

// ---------- dates (local TZ, default Asia/Kolkata) ----------
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const DAYS = {
  sun: 0, sunday: 0, ravivar: 0, itvaar: 0, itwar: 0, mon: 1, monday: 1, somvar: 1, somvaar: 1, tue: 2, tues: 2, tuesday: 2,
  mangal: 2, mangalvar: 2, wed: 3, wednesday: 3, budh: 3, budhvar: 3, thu: 4, thur: 4, thurs: 4, thursday: 4, guru: 4,
  guruvar: 4, fri: 5, friday: 5, shukra: 5, shukravar: 5, sat: 6, saturday: 6, shani: 6, shanivar: 6,
};
const addDays = (ymd, n) => { const d = new Date(ymd + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const pad = (n) => String(n).padStart(2, '0');
const realDate = (y, m, d) => {
  const s = y + '-' + pad(m) + '-' + pad(d);
  const t = new Date(s + 'T00:00:00Z');
  return !isNaN(t) && t.toISOString().slice(0, 10) === s ? s : null;
};
const monthOf = (w) => (w && w.length >= 3 ? MONTHS.indexOf(w.slice(0, 3)) + 1 : 0) || 0;

// 'aaj|kal|parso', weekday (next one, never today), '25 nov', 'nov 25', '25/11', '25-11-2026', '2026-11-30' -> 'YYYY-MM-DD' | null
function parseDate(raw) {
  const s = String(raw || '').toLowerCase().trim().replace(/[.,]+$/, '');
  const today = T.today();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return realDate(+s.slice(0, 4), +s.slice(5, 7), +s.slice(8, 10));
  if (/^(aaj|today|आज)$/.test(s)) return today;
  if (/^(kal|tomorrow|tmrw|कल)$/.test(s)) return addDays(today, 1);
  if (/^(parso|parson|परसों)$/.test(s)) return addDays(today, 2);
  if (Object.prototype.hasOwnProperty.call(DAYS, s)) {
    const n = (DAYS[s] - new Date(today + 'T00:00:00Z').getUTCDay() + 7) % 7 || 7;
    return addDays(today, n);
  }
  let d; let m; let y;
  let x = s.match(/^(\d{1,2})(?:st|nd|rd|th)?(?:\s*([a-z]+)|[\s/-]+(\d{1,2}))(?:[\s/,-]+(\d{4}|\d{2}))?$/);
  if (x) { d = +x[1]; m = x[2] ? monthOf(x[2]) : +x[3]; y = x[4]; }
  x = !m && s.match(/^([a-z]+)\s*(\d{1,2})(?:st|nd|rd|th)?(?:[\s,]+(\d{4}))?$/);
  if (x) { m = monthOf(x[1]); d = +x[2]; y = x[3]; }
  if (!m || !d) return null;
  const thisYear = +today.slice(0, 4);
  if (y) return realDate(y.length === 2 ? 2000 + +y : +y, m, d);
  const out = realDate(thisYear, m, d);
  return out && out < today ? realDate(thisYear + 1, m, d) : out;
}

// Pull "due <date> [time]", "by/till <date> [time]" or "<date> [time] tak" out of free text -> {text, date, bad}.
// date = 'YYYY-MM-DD' or 'YYYY-MM-DD HH:mm' (Round 4: times like "5 baje", "5 pm", "17:30", "subah 10", "shaam 6", "raat 9").
// bad = "due" with no date.
function extractDue(text) {
  const w = text.split(/\s+/).filter(Boolean);
  let found = null; let bad = false;
  for (let i = 0; i < w.length; i++) {
    const k = w[i].toLowerCase();
    if (k === 'due' || k === 'by' || k === 'till') {
      for (let n = 3; n >= 1; n--) {
        const part = w.slice(i + 1, i + 1 + n);
        if (part.length !== n) continue;
        let end = i + 1 + n;
        const date = parseDate(part.join(' '));
        if (!date) continue;
        const tm = DT.parseTimeAt(w, end);
        if (tm) end += tm.len;
        if ((w[end] || '').toLowerCase() === 'tak') end++;
        found = { start: i, end, date: DT.join(date, tm && tm.time) }; break;
      }
      if (!found && k === 'due') bad = true;
    } else if (k === 'tak' && i > 0) {
      let tm = null; let e = i; // optional time right before "tak"
      for (let tl = 3; tl >= 1 && !tm; tl--) {
        if (i - tl < 1) continue;
        const r = DT.parseTimeAt(w, i - tl);
        if (r && r.len === tl) { tm = r; e = i - tl; }
      }
      for (let n = 2; n >= 1; n--) {
        if (e - n < 0) continue;
        const date = parseDate(w.slice(e - n, e).join(' '));
        if (date) { found = { start: e - n, end: i + 1, date: DT.join(date, tm && tm.time) }; break; }
      }
    }
  }
  if (!found && !bad) { // Round 4: trailing "... kal shaam 6 baje" / "... aaj 5 pm" / "... 17:30" without the word "due"
    const REL = /^(aaj|today|kal|tomorrow|tmrw|parso|parson|monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/i;
    for (let n = 4; n >= 1 && !found; n--) {
      const s0 = w.length - n;
      if (s0 < 1) continue; // keep at least one word for the task itself
      let date = null; let i = s0;
      if (REL.test(w[s0])) { date = parseDate(w[s0]); i = s0 + 1; }
      const tm = i < w.length ? DT.parseTimeAt(w, i) : null;
      if (tm && i + tm.len === w.length) found = { start: s0, end: w.length, date: DT.join(date || T.today(), tm.time) };
      else if (!tm && date && i === w.length) found = { start: s0, end: w.length, date };
    }
  }
  if (!found) return { text: w.join(' '), date: null, bad };
  return { text: [...w.slice(0, found.start), ...w.slice(found.end)].join(' '), date: found.date, bad: false };
}


// ---------- people ----------
// Person resolution shared by /task, /assign, /reassign, /tasks: a structured @mention (id sent by the app) wins; else the
// first 1-2 words matched case-insensitively (exact > prefix > fuzzy, names.js), chat members preferred over all active
// users, bot excluded. Self words (khud, me, mujhe, ...) = the sender. Several equal matches -> AI pick from context
// (if on and sure), else a tappable 'userpicker' card.
async function people() {
  const [rows] = await pool.query('SELECT id, name, role, phone FROM users WHERE active = 1 AND is_bot = 0 ORDER BY name');
  return rows;
}

async function chatPeople(chatId) {
  const [rows] = await pool.query(
    `SELECT u.id, u.name, u.role, u.phone FROM chat_members cm JOIN users u ON u.id = cm.user_id
     WHERE cm.chat_id = ? AND cm.left_at IS NULL AND u.active = 1 AND u.is_bot = 0 ORDER BY u.name`, [chatId]);
  return rows;
}

const isFiller = (w) => PERSON_FILLER.has(String(w).toLowerCase()) || PERSON_FILLER.has(cleanToken(w)) || !cleanToken(w);
const meOf = (ctx) => ({ id: ctx.user.id, name: ctx.user.name, role: ctx.user.role, phone: ctx.user.phone });

// Best people named by the first one or two words -> {people, score, used}
function leading(words, list) {
  const w0 = cleanToken(words[0]);
  if (!w0) return { people: [], score: 0, used: 0 };
  const one = bestMatches(w0, list);
  if (words.length > 1 && !isFiller(words[1]) && !words[1].startsWith('@') && !/^#\d/.test(words[1])) {
    const two = bestMatches(w0 + ' ' + cleanToken(words[1]), list); // both words must be part of the name ("member 5")
    if (two.people.length && two.score > one.score) return { ...two, used: 2 };
  }
  return { ...one, used: 1 };
}

// The app-sent id for an "@Name" word (each tagged mention is used once).
function takeTag(ctx, word) {
  const token = cleanToken(word);
  const t = ctx.tagged.find((x) => !x.used && x.token === token);
  if (!t) return null;
  t.used = true;
  return t.id;
}

async function aiPick(ctx, query, list, members) {
  const inChat = new Set(members.map((m) => m.id));
  const [recent] = await pool.query(
    `SELECT u.name, m.body FROM messages m JOIN users u ON u.id = m.sender_id WHERE m.chat_id = ? AND m.visible_to IS NULL
       AND m.deleted_at IS NULL AND m.type = 'text' AND m.id < ? ORDER BY m.id DESC LIMIT 8`, [ctx.chatId, ctx.message.id]);
  const r = await provider.pickPerson({
    text: ctx.message.text, query,
    candidates: list.map((p) => ({ id: p.id, name: p.name, role: p.role, inChat: inChat.has(p.id) })),
    recent: recent.reverse().map((x) => x.name + ': ' + String(x.body).slice(0, 200)),
  }).catch(() => null);
  return r && r.confidence >= 0.8 ? list.find((p) => p.id === r.id) || null : null;
}

// "khud", "me", "mere liye", "khud ke liye" at the start -> words used (0 = not a self word)
function selfAt(words) {
  const c0 = cleanToken(words[0]);
  if (!SELF_WORDS.has(c0)) return 0;
  const c1 = cleanToken(words[1]); const c2 = cleanToken(words[2]);
  if (c0 === 'mere' && c1 !== 'liye') return 0; // "mere" alone is not "me"
  if (c1 === 'liye') return 2;
  if (c1 === 'ke' && c2 === 'liye') return 3;
  return 1;
}

// Person at the start of `words` -> {person, rest, ambiguous: [people] | null, query, unknown}
// unknown = an "@word" that matched nobody (caller shows a picker instead of guessing).
async function personAt(ctx, words, anywhere = false) {
  let i = 0;
  while (i < words.length && isFiller(words[i])) i++;
  const w = words.slice(i);
  const done = (person, used, ambiguous = null) => {
    const rest = w.slice(used);
    while (rest.length && isFiller(rest[0])) rest.shift();
    return { person, rest, ambiguous, query: w.slice(0, used).join(' ').replace(/^@/, ''), unknown: false };
  };
  const nobody = { person: null, rest: words, ambiguous: null, query: '', unknown: !!w[0] && w[0].startsWith('@') };
  if (!w.length) return nobody;
  const self = selfAt(w);
  if (self) return done(meOf(ctx), self);
  const all = await people();
  if (w[0].startsWith('@')) {
    const id = takeTag(ctx, w[0]);
    const p = id && all.find((x) => x.id === id);
    if (p) return done(p, 1);
  }
  const members = await chatPeople(ctx.chatId);
  const best = (ws) => {
    const m = leading(ws, members);
    const a = leading(ws, all);
    return m.people.length && m.score >= a.score ? m : a;
  };
  const resolve = async (r, used, finish) => {
    if (r.people.length === 1) return finish(r.people[0], used);
    const picked = await aiPick(ctx, r.query, r.people, members);
    return picked ? finish(picked, used) : finish(null, used, r.people);
  };
  const r = best(w);
  if (r.people.length) return resolve({ ...r, query: w.slice(0, r.used).join(' ') }, r.used, done);
  if (anywhere && !nobody.unknown) {
    // /task only: the name later in the text ("crm filter banana hai anubhav ko", "report banao @Tushar"):
    // an "@word" anywhere, or a name followed by ko / ke liye or ending the text (fillers like ji / bhai may follow).
    for (let i = 1; i < w.length; i++) {
      const word = w[i];
      if (word.startsWith('@')) {
        const id = takeTag(ctx, word);
        const p = id && all.find((x) => x.id === id);
        const rr = p ? { people: [p], used: 1 } : best([word]);
        if (!rr.people.length) return { ...nobody, rest: [...w.slice(0, i), ...w.slice(i + 1)], unknown: true, query: cleanToken(word) };
        return resolve({ ...rr, query: cleanToken(word) }, 1, (person, used, amb = null) => cut(i, used, person, amb, cleanToken(word)));
      }
      if (!/^\p{L}{3,}$/u.test(cleanToken(word)) || isFiller(word)) continue;
      const rr = best(w.slice(i));
      if (!rr.people.length) continue;
      const tail = w.slice(i + rr.used);
      const lc = tail.map((x) => cleanToken(x));
      if (tail.every(isFiller) || (lc[0] === 'ke' && lc[1] === 'liye')) {
        const query = w.slice(i, i + rr.used).join(' ');
        return resolve({ ...rr, query }, rr.used, (person, used, amb = null) => cut(i, used, person, amb, query));
      }
    }
  }
  return { ...nobody, rest: nobody.unknown ? w.slice(1) : words, query: cleanToken(w[0]) };

  // name found at w[i .. i+used): rest = the other words, minus "ko" / "ke liye" right after the name
  function cut(i, used, person, ambiguous, query) {
    const after = w.slice(i + used);
    if (after.length && ['ko', 'ke'].includes(cleanToken(after[0]))) after.splice(0, cleanToken(after[0]) === 'ke' && cleanToken(after[1]) === 'liye' ? 2 : 1);
    const rest = [...w.slice(0, i), ...after];
    while (rest.length && isFiller(rest[rest.length - 1])) rest.pop();
    return { person, rest, ambiguous, query, unknown: false };
  }
}

// A clear (exact / prefix) single name at the start of words -> {person, used} | null (for "A aur B" chains)
async function strongAt(ctx, words) {
  const self = selfAt(words);
  if (self) return { person: meOf(ctx), used: self, raw: words.slice(0, self).join(' ') };
  if (!words.length || words[0].startsWith('@') || /^#\d/.test(words[0])) return null;
  const m = leading(words, await chatPeople(ctx.chatId));
  const a = leading(words, await people());
  const r = m.people.length && m.score >= a.score ? m : a;
  return r.people.length === 1 && r.score >= 2 ? { person: r.people[0], used: r.used, raw: words.slice(0, r.used).join(' ') } : null;
}

const uniqPeople = (list) => list.filter((p, i) => p && list.findIndex((x) => x && x.id === p.id) === i);

// Several people in `words` -> {people, rest, problem: null | {query, list (null = nobody matched)}}
// Every "@word" anywhere (tagged ids first); with no "@": the leading name (or one later in the text for /task),
// chained with "aur" / "and" / "," ("anubhav aur tushar ...", "anubhav, tushar ...").
async function peopleIn(ctx, words, anywhere) {
  const found = []; const rest = []; let problem = null;
  const hasAt = words.some((w) => w.startsWith('@') && cleanToken(w));
  if (hasAt) {
    const all = await people();
    const members = await chatPeople(ctx.chatId);
    for (const w of words) {
      if (!w.startsWith('@') || !cleanToken(w)) { rest.push(w); continue; }
      const id = takeTag(ctx, w);
      const p = id && all.find((x) => x.id === id);
      if (p) { found.push(p); continue; }
      const tok = cleanToken(w);
      if (SELF_WORDS.has(tok) && tok !== 'mere') { found.push(meOf(ctx)); continue; }
      if (problem) continue;
      const m = bestMatches(tok, members); const a = bestMatches(tok, all);
      const r = m.people.length && m.score >= a.score ? m : a;
      if (r.people.length === 1) { found.push(r.people[0]); continue; }
      const picked = r.people.length > 1 ? await aiPick(ctx, tok, r.people, members) : null;
      if (picked) { found.push(picked); continue; }
      problem = { query: tok, list: r.people.length ? r.people : null };
    }
    while (rest.length && isFiller(rest[0])) rest.shift();
    return { people: uniqPeople(found), rest, problem };
  }
  const lp = await personAt(ctx, words, anywhere);
  if (lp.ambiguous) return { people: [], rest: lp.rest, problem: { query: lp.query, list: lp.ambiguous } };
  if (!lp.person) return { people: [], rest: words, problem: null };
  const out = [lp.person];
  let r = lp.rest; let lastRaw = lp.query;
  for (let n = 0; n < 9 && r.length; n++) {
    const joined = JOINERS.has(cleanToken(r[0]) || r[0]);
    if (!joined && !/,$/.test(lastRaw)) break;
    const next = await strongAt(ctx, joined ? r.slice(1) : r);
    if (!next) break;
    out.push(next.person);
    r = (joined ? r.slice(1) : r).slice(next.used);
    lastRaw = next.raw;
    while (r.length && isFiller(r[0]) && !JOINERS.has(r[0])) r.shift();
  }
  return { people: uniqPeople(out), rest: r, problem: null };
}

const firstName = (name) => String(name || '').trim().split(/\s+/)[0];

// Ephemeral "who?" card. Tapping a user re-sends: '/' + command + (pre ? ' ' + pre : '') + ' @' + firstName + (arg ? ' ' + arg : '')
// together with mentionIds [...keep ids, user.id], so the server takes that exact person (works for same-name people).
// keep = [{label:'@Name', id}] people already resolved in the same command (their labels are part of pre).
async function userPicker(ctx, command, query, list, arg, pre, notFound, keep = []) {
  const users = list.slice(0, 12).map((p) => ({ id: p.id, name: p.id === ctx.user.id ? p.name + ' (Me)' : p.name, phoneTail: String(p.phone || '').slice(-4) }));
  const text = notFound
    ? (query ? '"' + query + '" naam ka koi nahi mila. ' : '') + 'Kisko? Tap karein:'
    : '"' + query + '" naam ke ' + list.length + ' log hain. Kaun? Tap karein:';
  const body = text + '\n' + users.map((u) => u.name + (u.phoneTail ? ' (...' + u.phoneTail + ')' : '')).join('\n');
  return bot.ephemeral(ctx.chatId, ctx.user.id, body, { kind: 'userpicker', command, text, users, arg: arg || '', pre: pre || '', keep });
}

// Choices when a name matched nobody: me first (task / assign pickers), then the chat's members, else everyone.
async function everyoneFor(ctx, withSelf = false) {
  const others = (await chatPeople(ctx.chatId)).filter((p) => p.id !== ctx.user.id);
  const list = others.length > 1 ? others : (await people()).filter((p) => p.id !== ctx.user.id);
  return withSelf ? [meOf(ctx), ...list] : list;
}

// picker for the one unresolved name, keeping the people already found
async function pickFor(ctx, command, pp, arg, pre) {
  const keep = pp.people.map((p) => ({ label: '@' + firstName(p.name), id: p.id }));
  const pre2 = [pre, ...keep.map((k) => k.label)].filter(Boolean).join(' ');
  const list = pp.problem.list || (await everyoneFor(ctx, true));
  return userPicker(ctx, command, pp.problem.query, list, arg, pre2, !pp.problem.list, keep);
}

// ---------- tasks ----------
function hashId(args) {
  const m = args.match(/(^|\s)(?:#|task\s*#?\s*)(\d{1,9})(?=\s|$)/i); // "#22" or "Task 22" (Round 4)
  if (!m) return { id: null, rest: args.trim() };
  return { id: Number(m[2]), rest: (args.slice(0, m.index) + ' ' + args.slice(m.index + m[0].length)).replace(/\s+/g, ' ').trim() };
}

// Open tasks a user would mean without a #id: assigned to them (own status not done), else open ones they created.
async function candidates(user) {
  let list = (await T.assignedTo(user.id)).filter((t) => t.myStatus !== 'done');
  if (!list.length) list = (await T.listTasks({ scope: 'mine', status: 'open' }, user)).filter((t) => t.createdBy === user.id);
  return list.slice(0, 20);
}

const brief = (t) => ({ id: t.id, title: t.title, status: t.myStatus || t.status });
const err = (ctx, code, message) => bot.errorCard(ctx.chatId, ctx.user.id, code, message);
const info = (ctx, text) => bot.infoCard(ctx.chatId, ctx.user.id, text);

function picker(ctx, command, list, arg) {
  const text = 'Kaunsa task? Tap karein:';
  const body = text + '\n' + list.map((t) => 'Task ' + t.id + ' - ' + t.title).join('\n');
  return bot.ephemeral(ctx.chatId, ctx.user.id, body, { kind: 'picker', command, text, tasks: list.map(brief), ...(arg ? { arg } : {}) });
}

// #id given -> that task; else the single candidate (not for close); else an ephemeral picker. null = already answered.
// noGuess: never pick a task by matching words of `arg` (arg is free text like a description).
async function resolveTask(ctx, command, id, arg, alwaysPick, noGuess) {
  if (id) {
    const t = await T.getTask(id); // TaskError 404 -> error card
    if (!T.canView(t, ctx.user)) throw new T.TaskError(403, 'Not allowed');
    return t;
  }
  const list = await candidates(ctx.user);
  if (!list.length) {
    await err(ctx, 'NOT_FOUND', 'Aapka koi open task nahi hai. Task number ke saath likhiye, jaise /' + command + ' #12');
    return null;
  }
  // guesses without a #id are only safe on the sender's own tasks (not on tasks they merely created)
  const own = list.every((t) => T.isAssignee(t, ctx.user));
  if (list.length === 1 && !alwaysPick && own) return list[0];
  if (!alwaysPick && arg && !noGuess) {
    // "/update filter laga diya" -> the only open task whose title/description shares a word with the note
    const ws = (s) => String(s || '').toLowerCase().split(/[^\p{L}\p{M}\p{N}]+/u).filter((w) => w.length >= 3);
    const noteWords = new Set(ws(arg));
    const scored = list.map((t) => ({ t, n: new Set(ws(t.title + ' ' + (t.project || '') + ' ' + (t.description || ''))) }))
      .map(({ t, n }) => ({ t, s: [...n].filter((w) => noteWords.has(w)).length }))
      .sort((a, b) => b.s - a.s);
    if (scored[0].s > 0 && (scored.length === 1 || scored[0].s > scored[1].s)) return scored[0].t;
  }
  if (!alwaysPick && own && command === 'done') {
    // the natural next step after "/update ... testing baaki": the single task waiting in Testing / Change merged
    const inReview = list.filter((t) => ['testing', 'change_merged'].includes(t.myStatus || t.status));
    if (inReview.length === 1) return inReview[0];
  }
  await picker(ctx, command, list, arg);
  return null;
}

function aiErrorCard(ctx, e, suffix) {
  const lead = e.code === 'AI_KEY_INVALID' ? 'AI key issue' : 'AI issue';
  return err(ctx, e.code, lead + ' (' + e.code + '): ' + e.message + (suffix ? ' ' + suffix : ''));
}

const card = (ctx, r, extra = {}) => bot.taskCard(ctx.chatId, r.event, r.task, ctx.user, { replyTo: ctx.message.id, ...extra });
const link = (ctx, taskId) => T.linkMessage(ctx.message.id, taskId);

// ---------- commands ----------
async function cmdTask(ctx, args) {
  if (!args) return err(ctx, 'BAD_COMMAND', 'Likhiye: /task <naam> <kaam> [due kal]. Jaise: /task anubhav crm pe date filter banana hai due fri');
  const due = extractDue(args);
  if (due.bad) return err(ctx, 'BAD_COMMAND', 'Due date samajh nahi aayi. Likhiye: due aaj / kal / parso / fri / 25 nov / 2026-11-30');
  const words = due.text.split(' ').filter(Boolean);
  const pp = await peopleIn(ctx, words, true);
  const again = () => pp.rest.join(' ') + (due.date ? ' due ' + due.date : '');
  if (pp.problem) return pickFor(ctx, 'task', pp, again(), '');
  // Round 4: no person recognised = NOT a self task (only me / khud / mujhe ... make one): ask who, with "(Me)" first
  if (!pp.people.length) {
    if (!T.canCreate(ctx.user, [ctx.user.id])) return err(ctx, 'NOT_ALLOWED', 'Dusron ko task sirf admin de sakta hai. Apne liye: /task khud <kaam>.');
    return userPicker(ctx, 'task', cleanToken(words[0] || ''), await everyoneFor(ctx, true), again(), '', true);
  }
  const assignees = pp.people;
  const body = pp.rest.join(' ').trim();
  if (!body) return err(ctx, 'BAD_COMMAND', 'Kaam bhi likhiye. Jaise: /task ' + (pp.people.length ? firstName(pp.people[0].name).toLowerCase() : 'anubhav') + ' login page fix karna hai');
  const ids = assignees.map((p) => p.id);
  // Assigning others = admin or settings.membersCanAssign; a self-task is always allowed (R-01)
  if (!T.canCreate(ctx.user, ids)) {
    return err(ctx, 'NOT_ALLOWED', 'Dusron ko task sirf admin de sakta hai. Apne liye: /task khud <kaam>.');
  }
  const tt = await provider.taskTitle(body);
  const task = await T.createTask({
    title: tt.title, description: tt.description || body, assigneeIds: ids, dueDate: due.date, project: tt.project, chatId: ctx.chatId,
  }, ctx.user, 'command', ctx.message.id);
  await link(ctx, task.id);
  await card(ctx, { event: 'created', task }, { byAi: tt.byAi });
  if (tt.error) await aiErrorCard(ctx, tt.error, 'Task simple rules se bana diya gaya.');
}

const FORCED = { done: 'done', testing: 'testing', planning: 'planning', coding: 'coding', merged: 'change_merged' };

// /update, /done, /testing, /planning, /coding, /merged, /status #id <step>. An assignee sets their own status; the boss /
// creator sets everyone's, or only the "@Name"s given.
async function cmdWork(ctx, args, command) {
  const h = hashId(args);
  const id = h.id;
  let rest = h.rest;
  let who = [];
  if (command !== 'update' && /(^|\s)@\S/.test(rest)) {
    const words = rest.split(' ');
    const pp = await peopleIn(ctx, words.filter((w) => w.startsWith('@')), false);
    if (pp.problem) return err(ctx, 'BAD_COMMAND', '"' + pp.problem.query + '" naam samajh nahi aaya. @ button se person chuniye.');
    who = pp.people;
    rest = words.filter((w) => !w.startsWith('@')).join(' ').trim();
  }
  let forced = FORCED[command] || null;
  if (command === 'status') {
    const words = rest.split(' ').filter(Boolean);
    forced = S.norm(words[0]);
    if (!forced) return cmdAsk(ctx, args);
    rest = words.slice(1).join(' ');
  }
  if (command === 'update' && !rest) return err(ctx, 'BAD_COMMAND', 'Note bhi likhiye. Jaise: /update #12 filter laga diya, testing baaki hai');
  const task = await resolveTask(ctx, command, id, rest);
  if (!task) return;
  if (task.status === 'closed') return info(ctx, 'Task ' + task.id + ' closed hai.');
  if (!T.canWork(task, ctx.user) && !T.canDescribe(task, ctx.user)) throw new T.TaskError(403, 'Not allowed');
  const f = {};
  if (rest) f.note = rest.slice(0, 1000);
  const status = forced || S.fromNote(rest);
  if (status && T.canWork(task, ctx.user)) {
    f.status = status;
    if (who.length) f.userIds = who.map((p) => p.id);
  } else if (forced) throw new T.TaskError(403, 'Not allowed');
  if (!Object.keys(f).length) return info(ctx, 'Task ' + task.id + ': kuch badla nahi.');
  const r = await T.applyUpdate(task.id, f, ctx.user, 'command', ctx.message.id);
  await link(ctx, task.id);
  if (!r.changed) return info(ctx, 'Task ' + task.id + ' pehle se ' + (LABEL[status] || status) + ' hai.');
  await card(ctx, r, rest ? { note: rest.slice(0, 1000) } : {});
}

// /assign #id @A (add), /unassign #id @A (remove), /reassign #id @A [@B] (replace the set)
async function cmdPeople(ctx, args, command) {
  const { id, rest } = hashId(args);
  if (!rest) return err(ctx, 'BAD_COMMAND', 'Likhiye: /' + command + ' #12 @naam');
  const task = await resolveTask(ctx, command, id, rest, false, true);
  if (!task) return;
  const pp = await peopleIn(ctx, rest.split(' '), false);
  if (pp.problem) return pickFor(ctx, command, pp, '', '#' + task.id);
  if (!pp.people.length) return userPicker(ctx, command, rest.slice(0, 40), await everyoneFor(ctx, true), '', '#' + task.id, true);
  const ids = pp.people.map((p) => p.id);
  if (command === 'reassign') return reassign(ctx, task, pp.people);
  const f = command === 'assign' ? { addAssigneeIds: ids } : command === 'unassign' ? { removeAssigneeIds: ids } : { assigneeIds: ids };
  const r = await T.applyUpdate(task.id, f, ctx.user, 'command', ctx.message.id);
  await link(ctx, task.id);
  if (!r.changed) return info(ctx, 'Task ' + task.id + ' mein koi badlaav nahi hua (log pehle se wahi hain).');
  await card(ctx, r);
}

// Round 4 /re: "/re Task 22 @Uzair" = the only assignee is replaced; with several assignees "@Anubhav @Uzair" = move
// from Anubhav (a current assignee) to Uzair. Admin only (tasks.js canManage). Others stay as they are.
async function reassign(ctx, task, named) {
  if (!T.canManage(task, ctx.user)) throw new T.TaskError(403, 'Not allowed');
  const cur = task.assignees.map((a) => a.id);
  let from = named.filter((p) => cur.includes(p.id));
  const to = named.filter((p) => !cur.includes(p.id));
  if (!from.length && cur.length === 1) from = task.assignees;
  if (!to.length) return info(ctx, 'Task ' + task.id + ': kisko dena hai? Jaise /re Task ' + task.id + ' @naam');
  if (!from.length) {
    return info(ctx, 'Task ' + task.id + ' ke kai log hain (' + task.assignees.map((a) => a.name).join(', ') + '). Kisse hatana hai? Jaise /re Task ' + task.id + ' @' + firstName(task.assignees[0].name) + ' @' + firstName(to[0].name));
  }
  const r = await T.applyUpdate(task.id, { addAssigneeIds: to.map((p) => p.id), removeAssigneeIds: from.map((p) => p.id) }, ctx.user, 'command', ctx.message.id);
  await link(ctx, task.id);
  if (!r.changed) return info(ctx, 'Task ' + task.id + ' mein koi badlaav nahi hua.');
  await card(ctx, r);
}

async function cmdDue(ctx, args) {
  const { id, rest } = hashId(args);
  if (!rest) return err(ctx, 'BAD_COMMAND', 'Likhiye: /due #12 kal (ya fri, 25 nov, none)');
  let date = null;
  if (!/^(none|no|clear|hatao|remove|-)$/i.test(rest)) {
    date = parseDate(rest.replace(/\s+tak$/i, ''));
    if (!date) return err(ctx, 'BAD_COMMAND', 'Date samajh nahi aayi. Likhiye: aaj / kal / parso / fri / 25 nov / 2026-11-30 / none');
  }
  const task = await resolveTask(ctx, 'due', id, rest);
  if (!task) return;
  const r = await T.applyUpdate(task.id, { dueDate: date }, ctx.user, 'command', ctx.message.id);
  await link(ctx, task.id);
  await card(ctx, r);
}

// /close #id [reason] (alias /delete): boss or the creator.
async function cmdClose(ctx, args) {
  const { id, rest } = hashId(args);
  const task = await resolveTask(ctx, 'close', id, null, true);
  if (!task) return;
  const t = await T.closeTask(task.id, ctx.user, 'command', ctx.message.id, rest ? rest.slice(0, 300) : null);
  await link(ctx, task.id);
  await card(ctx, { event: 'closed', task: t }, rest ? { note: rest.slice(0, 300) } : {});
}

async function cmdReopen(ctx, args) {
  const { id } = hashId(args);
  if (!id) return err(ctx, 'BAD_COMMAND', 'Task number likhiye: /reopen #12');
  const t = await T.reopenTask(id, ctx.user, 'command', ctx.message.id);
  await link(ctx, id);
  await card(ctx, { event: 'reopened', task: t });
}

// /desc #id <text>: replace the description (boss, assignee or creator).
async function cmdDesc(ctx, args) {
  const { id, rest } = hashId(args);
  if (!rest) return err(ctx, 'BAD_COMMAND', 'Likhiye: /desc #12 <naya description>');
  const task = await resolveTask(ctx, 'desc', id, rest, false, true);
  if (!task) return;
  const r = await T.applyUpdate(task.id, { description: rest.slice(0, 4000) }, ctx.user, 'command', ctx.message.id);
  await link(ctx, task.id);
  if (!r.changed) return info(ctx, 'Task ' + task.id + ' ka description pehle se yahi hai.');
  await card(ctx, r, { note: 'Description: ' + rest.slice(0, 300) });
}

// /ask #id: public card mentioning every assignee who is not done yet ("status kya hai?"); their app notifies them.
// Assignees not in this chat get the card in their DM with the asker instead. Recorded as task event 'ask'.
async function cmdAsk(ctx, args) {
  const { id } = hashId(args);
  if (!id) return err(ctx, 'BAD_COMMAND', 'Task number likhiye: /ask #12 (ya @ button se person chuniye)');
  const task = await T.getTask(id);
  if (!T.canView(task, ctx.user)) throw new T.TaskError(403, 'Not allowed');
  if (task.status === 'closed') return info(ctx, 'Task ' + id + ' closed hai.');
  const targets = task.assignees.filter((a) => a.status !== 'done' && a.id !== ctx.user.id);
  if (!targets.length) return info(ctx, task.status === 'done' ? 'Task ' + id + ' pehle se Done hai.' : 'Task ' + id + ' aapka hi hai.');
  const askId = await T.event(task.id, ctx.user, 'ask', null, targets.map((a) => a.name).join(', '), 'command', ctx.message.id);
  await link(ctx, task.id);
  const inChat = []; const outChat = [];
  for (const a of targets) ((await rt.isChatMember(ctx.chatId, a.id)) ? inChat : outChat).push(a);
  const base = { kind: 'ask', task, actorId: ctx.user.id, actorName: ctx.user.name, askId, askerId: ctx.user.id };
  const text = (list) => list.map((a) => '@' + firstName(a.name)).join(' ') + ', ' + ctx.user.name + ' pooch rahe hain: "' + task.title +
    '" (Task ' + id + ') ka status kya hai?';
  if (inChat.length) {
    await bot.postBot(ctx.chatId, text(inChat), { ...base, assigneeId: inChat[0].id, assigneeIds: inChat.map((a) => a.id), replyTo: ctx.message.id },
      null, inChat.map((a) => a.id));
  }
  for (const a of outChat) {
    const dm = await bot.ensureDm(ctx.user.id, a.id);
    if (dm.created) { rt.sendToUser(a.id, { type: 'chat', chatId: dm.chatId }); rt.sendToUser(ctx.user.id, { type: 'chat', chatId: dm.chatId }); }
    await bot.postBot(dm.chatId, text([a]), { ...base, assigneeId: a.id, assigneeIds: [a.id] }, null, [a.id]);
  }
  if (outChat.length) await info(ctx, outChat.map((a) => a.name).join(', ') + ' is chat mein nahi hain, unse DM mein pooch liya.');
}

const namesOf = (t) => (t.assigneeNames || (t.assignees || []).map((a) => a.name)).join(', ') || t.assigneeName || '';
function listCard(ctx, title, tasks) {
  const lines = [title + ' (' + tasks.length + ')'];
  for (const t of tasks) {
    const who = namesOf(t);
    lines.push('Task ' + t.id + ' - ' + t.title + (who ? ' - ' + who : '') + ' [' + (LABEL[t.status] || t.status) + ']' + (t.dueDate ? ' due ' + DT.fmtDue(t.dueDate, t.dueAt) : ''));
  }
  if (!tasks.length) lines.push('Koi open task nahi.');
  const slim = tasks.map((t) => ({ id: t.id, title: t.title, status: t.status, assigneeName: namesOf(t) || null, dueDate: t.dueDate || null,
    overdue: !!t.overdue, brief: !!t.brief }));
  return bot.ephemeral(ctx.chatId, ctx.user.id, lines.join('\n'), { kind: 'list', title, tasks: slim });
}

// Members see others' tasks as title + status + names only (brief).
async function cmdTasks(ctx, args) {
  let who = null;
  if (args) {
    const lp = await personAt(ctx, args.split(/\s+/));
    if (lp.ambiguous) return userPicker(ctx, 'tasks', lp.query, lp.ambiguous, '');
    if (!lp.person) return userPicker(ctx, 'tasks', lp.query || args.slice(0, 40), await everyoneFor(ctx, true), '', '', true);
    who = lp.person;
  }
  const scope = ctx.user.role === 'boss' ? 'all' : 'everyone';
  const list = (await T.listTasks({ scope, status: 'open', ...(who ? { assignee: String(who.id) } : {}) }, ctx.user)).slice(0, 50);
  return listCard(ctx, who ? who.name + ' ke open tasks' : 'Sabke open tasks', list);
}

async function cmdMyTasks(ctx) {
  const list = (await T.assignedTo(ctx.user.id)).filter((t) => t.myStatus !== 'done').slice(0, 50).map((t) => ({ ...t, status: t.myStatus }));
  return listCard(ctx, 'Mere open tasks', list);
}

function cmdHelp(ctx) {
  const body = 'Commands:\n' + HELP.map((c) => c.cmd + (c.args ? ' ' + c.args : '') + ' - ' + c.desc).join('\n');
  return bot.ephemeral(ctx.chatId, ctx.user.id, body, { kind: 'help', commands: HELP });
}

// Round 4: disabled (simple create->done): update, testing, planning, coding, merged, status, assign, unassign, due, close, reopen, desc, ask
// const HANDLERS = { task: cmdTask, update: cmdWork, done: cmdWork, testing: cmdWork, planning: cmdWork, coding: cmdWork, merged: cmdWork,
//   status: cmdWork, assign: cmdPeople, unassign: cmdPeople, reassign: cmdPeople, due: cmdDue, close: cmdClose, reopen: cmdReopen,
//   desc: cmdDesc, ask: cmdAsk, tasks: cmdTasks, mytasks: cmdMyTasks, help: cmdHelp };
const HANDLERS = { task: cmdTask, done: cmdWork, reassign: cmdPeople, tasks: cmdTasks, mytasks: cmdMyTasks, help: cmdHelp };

function friendly(e) {
  if (e.status === 403) return 'Ye aap nahi kar sakte (sirf admin, task banane wala ya jiska task hai).';
  if (e.status === 404) return 'Task nahi mila (number check karein, /mytasks dekhiye).';
  return 'Nahi ho paya: ' + e.message;
}

async function guards(ctx) {
  const s = await settings.all();
  if (!s.commandsEnabled) return 'Slash commands abhi band hain (Admin Settings).';
  if (!(await settings.forChat(ctx.chatId)).botEnabled) return 'Is chat mein task bot band hai (Admin Settings).';
  return null;
}

async function safely(ctx, name, fn) {
  try {
    await fn();
  } catch (e) {
    if (e instanceof T.TaskError) await err(ctx, e.code === 'BAD_REQUEST' ? 'BAD_COMMAND' : e.code, friendly(e));
    else {
      console.error('command /' + name + ':', e.message);
      await err(ctx, 'BAD_COMMAND', 'Kuch galat ho gaya, dobara try karein.').catch(() => {});
    }
  }
}

// -> true if the message was a slash command (answered here), false otherwise.
// opts.tagged = [{token, id}] from structured mentionIds (routes/chats.js resolveMentions).
async function handle(message, user, opts = {}) {
  if (!message || (message.type && message.type !== 'text') || !message.text) return false;
  const m = message.text.trim().match(CMD_RE);
  if (!m) return false;
  const raw = m[1].toLowerCase();
  const name = ALIASES[raw] || raw;
  const ctx = { message, user, chatId: message.chatId, tagged: (opts.tagged || []).map((t) => ({ ...t, used: false })) };
  await safely(ctx, name, async () => {
    const off = await guards(ctx);
    if (off) return err(ctx, 'COMMANDS_DISABLED', off);
    const fn = HANDLERS[name];
    if (!fn) return err(ctx, 'BAD_COMMAND', 'Ye command nahi pata: /' + raw + '. /help likhiye.');
    await fn(ctx, (m[2] || '').replace(/\s+/g, ' ').trim(), name);
  });
  return true;
}

// ---------- task-linked messages (messages.task_id, set at send time) ----------
// 1. direct reply to a task / ask / reminder card: "desc: ..." replaces the description; else a note + status words
//    (assignee: own status; boss/creator: everyone). A card follows (attached under the reply).
// 2. answer: an assignee replying to an ask card, or to a boss/creator message of the task that ends with "?":
//    description if the task has none (asker = boss/creator), else a note; status words set their own status; the asker
//    is notified (ws task event 'answered').
// 3. deeper reply-chain replies and plain "#N" messages: a note only (no card, status words ignored).
// Only the boss, an assignee or the creator; anyone else's message stays linked (the chain continues) but adds nothing.
async function handleLinked(message, user) {
  if (!message || (message.type && message.type !== 'text') || !message.text || !message.taskId) return false;
  const text = message.text.trim();
  if (!text || text.startsWith('/')) return false;
  const ctx = { message, user, chatId: message.chatId, tagged: [] };
  if (await guards(ctx)) return false;
  let task;
  try { task = await T.getTask(message.taskId); } catch (e) { return false; }
  if (!T.canDescribe(task, user)) return false;
  let parent = null;
  if (message.replyTo && message.replyTo.id) {
    const [[p]] = await pool.query('SELECT id, type, payload, sender_id, body, task_id FROM messages WHERE id = ? AND chat_id = ? AND deleted_at IS NULL',
      [message.replyTo.id, message.chatId]);
    parent = p || null;
  }
  let cardP = null;
  if (parent && parent.type === 'bot') {
    try {
      const p = JSON.parse(parent.payload);
      if (p && ['task', 'ask', 'reminder'].includes(p.kind) && p.task && p.task.id === task.id) cardP = p;
    } catch (e) { /* not a card */ }
  }
  const closed = task.status === 'closed';
  const assignee = T.isAssignee(task, user);
  await safely(ctx, 'reply', async () => {
    const d = text.match(/^desc(?:ription)?\s*[:-]\s*([\s\S]+)$/i);
    if (d) {
      const r = await T.applyUpdate(task.id, { description: d[1].trim().slice(0, 4000) }, user, 'command', message.id);
      if (cardP && r.changed) await card(ctx, r, { note: 'Description: ' + d[1].trim().slice(0, 300) });
      return;
    }
    let asker = null;
    if (cardP && cardP.kind === 'ask' && assignee) asker = cardP.askerId || cardP.actorId || null;
    else if (parent && parent.type === 'text' && assignee && Number(parent.task_id) === task.id && /\?\s*$/.test(String(parent.body || ''))) {
      const pu = await users.get(parent.sender_id);
      if (pu && (pu.role === 'boss' || pu.id === task.createdBy) && pu.id !== user.id) asker = pu.id;
    }
    if (asker) {
      const au = await users.get(asker);
      const f = {};
      if (!task.description && au && (au.role === 'boss' || au.id === task.createdBy)) f.description = text.slice(0, 4000);
      else f.note = text.slice(0, 1000);
      const st = S.fromNote(text);
      if (st && !closed) f.status = st;
      const r = await T.applyUpdate(task.id, f, user, 'command', message.id, { notifyIds: [asker], eventName: 'answered' });
      if (cardP) await card(ctx, r, { note: text.slice(0, 300) });
      return;
    }
    if (cardP) {
      const f = { note: text.slice(0, 1000) };
      const st = S.fromNote(text);
      if (st && !closed && T.canWork(task, user)) f.status = st;
      await card(ctx, await T.applyUpdate(task.id, f, user, 'command', message.id), { note: f.note });
      return;
    }
    await T.applyUpdate(task.id, { note: text.slice(0, 1000) }, user, 'chain', message.id);
  });
  return true;
}

// ---------- edit / delete propagation (routes/misc.js; author only, inside the 10-min window) ----------
// note / description text a message stands for
function noteText(text) {
  const m = text.match(CMD_RE);
  if (!m) return text.slice(0, 1000);
  let rest = hashId((m[2] || '').replace(/\s+/g, ' ').trim()).rest;
  if ((ALIASES[m[1].toLowerCase()] || m[1].toLowerCase()) === 'status') rest = rest.split(' ').slice(1).join(' ');
  return rest.replace(/(^|\s)@\S+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 1000);
}
function descText(text) {
  const m = text.match(CMD_RE);
  if (m) return (ALIASES[m[1].toLowerCase()] || m[1].toLowerCase()) === 'desc' ? hashId((m[2] || '').trim()).rest.slice(0, 4000) : null;
  const d = text.match(/^desc(?:ription)?\s*[:-]\s*([\s\S]+)$/i);
  return d ? d[1].trim().slice(0, 4000) : text.slice(0, 4000);
}

// Rewrite the cards attached to a message (source_message_id) with the fresh task; ws 'edited'.
async function refreshCards(sourceId, taskIds) {
  if (!taskIds.size) return;
  const { MSG_SELECT, formatMessage } = require('../routes/chats');
  const [cards] = await pool.query("SELECT id, chat_id, payload, visible_to FROM messages WHERE source_message_id = ? AND type = 'bot' AND deleted_at IS NULL", [sourceId]);
  for (const c of cards) {
    let p = null;
    try { p = JSON.parse(c.payload); } catch (e) { continue; }
    if (!p || !p.task || !taskIds.has(p.task.id)) continue;
    const task = await T.getTask(p.task.id).catch(() => null);
    if (!task) continue;
    p.task = task;
    p.edited = true;
    const who = task.assignees.map((a) => a.name).join(', ');
    const body = (bot.EVENT_TEXT[p.event] || 'Task') + ': Task ' + task.id + ' - ' + task.title + (who ? ' (' + who + ')' : '') + (p.note ? '\n' + p.note : '');
    await pool.query('UPDATE messages SET payload = ?, body = ? WHERE id = ?', [JSON.stringify(p), body.slice(0, 4000), c.id]);
    const [[row]] = await pool.query(MSG_SELECT + 'WHERE m.id = ?', [c.id]);
    const ev = { type: 'edited', chatId: c.chat_id, message: formatMessage(row, { role: 'member' }) };
    if (c.visible_to) rt.sendToUser(c.visible_to, ev); else await rt.sendToChat(c.chat_id, ev);
  }
}

// After the author edited a message (10-min window): a task it created (still open, < 10 min old) gets the re-parsed
// title / description / due (never assignees or status); notes it made are updated (+ 'note_edited'); a description it
// set is re-applied; attached cards are rewritten.
async function onSourceEdited(message, user, opts = {}) {
  const text = String(message.text || '').trim();
  if (!text) return;
  const touched = new Set();
  const m = text.match(CMD_RE);
  const cmd = m ? ALIASES[m[1].toLowerCase()] || m[1].toLowerCase() : null;
  const [tasks] = await pool.query(
    'SELECT id, created_by, status, TIMESTAMPDIFF(SECOND, created_at, NOW()) age FROM tasks WHERE source_message_id = ? AND deleted_at IS NULL', [message.id]);
  for (const t of tasks) {
    if (t.status === 'closed' || t.created_by !== user.id || Number(t.age) > 600) continue;
    let f = null;
    if (cmd === 'task') {
      const due = extractDue((m[2] || '').replace(/\s+/g, ' ').trim());
      if (due.bad) continue;
      const ctx = { message, user, chatId: message.chatId, tagged: (opts.tagged || []).map((x) => ({ ...x, used: false })) };
      const words = due.text.split(' ').filter(Boolean);
      const pp = await peopleIn(ctx, words, true);
      const body = (pp.people.length || pp.problem ? pp.rest : words).join(' ').trim();
      if (!body) continue;
      const tt = await provider.taskTitle(body);
      f = { title: tt.title, description: tt.description || body, dueDate: due.date };
    } else if (!m) {
      f = { title: (await provider.taskTitle(text)).title }; // plain-chat AI task
    }
    if (!f) continue;
    try {
      const r = await T.applyUpdate(t.id, f, user, 'edit', message.id, { asCreator: true });
      if (r.changed) touched.add(t.id);
    } catch (e) { if (!(e instanceof T.TaskError)) throw e; }
  }
  const [evs] = await pool.query("SELECT id, task_id, event FROM task_events WHERE message_id = ? AND event IN ('note', 'description') ORDER BY id", [message.id]);
  const noted = new Set();
  for (const e of evs) {
    if (e.event === 'note') {
      const note = noteText(text);
      if (!note) continue;
      await pool.query('UPDATE task_events SET new_value = ?, source_text = ? WHERE id = ?', [note, text.slice(0, 1000), e.id]);
      if (!noted.has(e.task_id)) { await T.event(e.task_id, user, 'note_edited', null, note, 'edit', message.id); noted.add(e.task_id); }
      touched.add(e.task_id);
      const task = await T.getTask(e.task_id).catch(() => null);
      if (task) await T.notify(task, 'note', user, 'edit');
    } else if (!touched.has(e.task_id)) {
      const d = descText(text);
      if (!d) continue;
      try {
        const r = await T.applyUpdate(e.task_id, { description: d }, user, 'edit', message.id);
        if (r.changed) touched.add(e.task_id);
      } catch (er) { if (!(er instanceof T.TaskError)) throw er; }
    }
  }
  // card notes follow the edited text
  if (touched.size) {
    const [cards] = await pool.query("SELECT id, payload FROM messages WHERE source_message_id = ? AND type = 'bot'", [message.id]);
    for (const c of cards) {
      try {
        const p = JSON.parse(c.payload);
        if (p && p.note && p.event !== 'praise') {
          p.note = String(p.note).startsWith('Description: ') ? 'Description: ' + (descText(text) || '').slice(0, 300) : noteText(text);
          await pool.query('UPDATE messages SET payload = ? WHERE id = ?', [JSON.stringify(p), c.id]);
        }
      } catch (e) { /* skip */ }
    }
  }
  await refreshCards(message.id, touched);
}

// Deleting a note message (10-min window) marks its note event 'note_deleted' on the timeline.
async function onSourceDeleted(m, user) {
  const [evs] = await pool.query("SELECT id, task_id FROM task_events WHERE message_id = ? AND event = 'note'", [m.id]);
  if (!evs.length) return;
  await pool.query("UPDATE task_events SET event = 'note_deleted' WHERE message_id = ? AND event = 'note'", [m.id]);
  for (const id of new Set(evs.map((e) => e.task_id))) {
    const task = await T.getTask(id).catch(() => null);
    if (task) await T.notify(task, 'note', user, 'edit');
  }
}

module.exports = { handle, handleLinked, handleReply: handleLinked, onSourceEdited, onSourceDeleted, parseDate, extractDue, HELP };
