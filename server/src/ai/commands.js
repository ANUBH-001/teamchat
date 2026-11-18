// Slash commands typed in any chat ("/task anubhav crm pe filter banana hai due fri"). Called from routes/chats.js
// after a text message is saved, BEFORE the natural-language engine; handle() returns true when the message was a
// command (then the engine is skipped). The command message itself stays a normal text message.
// Results: task changes -> public task card in the chat; help / lists / pickers / errors -> ephemeral (sender only).
// All task writes go through src/tasks.js (source 'command'), so permissions, task_events and ws 'task' events match.
const pool = require('../db');
const T = require('../tasks');
const settings = require('../settings');
const provider = require('./provider');
const { bestMatches, cleanToken } = require('./names');
const rt = require('../realtime');
const bot = require('./bot');

const CMD_RE = /^\/([a-z][a-z-]*)(?:\s+([\s\S]*))?$/i;
const ALIASES = {
  'completed-task': 'done', complete: 'done', completed: 'done', 'update-task': 'update', 'reassigned-task': 'reassign',
  'reassign-task': 'reassign', review: 'testing', mytask: 'mytasks', 'my-tasks': 'mytasks', list: 'tasks', 'new-task': 'task',
  status: 'ask', description: 'desc',
};
const HELP = [
  { cmd: '/task', args: '<naam> <kaam> [due kal|fri|25 nov]', desc: 'Naya task (naam nahi likha = khud ke liye)' },
  { cmd: '/update', args: '[#id] <note>', desc: 'Progress note ("testing baaki" = Testing, "start" = Doing, "ho gaya" = Done)' },
  { cmd: '/done', args: '[#id] [note]', desc: 'Task complete' },
  { cmd: '/testing', args: '[#id] [note]', desc: 'Task Testing mein' },
  { cmd: '/reassign', args: '#id <naam>', desc: 'Task kisi aur ko do' },
  { cmd: '/due', args: '#id <date>', desc: 'Due date badlo (aaj, kal, parso, fri, 25 nov, 2026-11-30, none)' },
  { cmd: '/delete', args: '#id', desc: 'Task delete (banane wala ya admin)' },
  { cmd: '/ask', args: '#id', desc: 'Jiska task hai usse status poochho (usko notification jayega)' },
  { cmd: '/desc', args: '#id <text>', desc: 'Task ka description badlo (ya task card ko reply karke "desc: ...")' },
  { cmd: '/tasks', args: '[naam]', desc: 'Open tasks (sabke ya ek insaan ke)' },
  { cmd: '/mytasks', args: '', desc: 'Mere open tasks' },
  { cmd: '/help', args: '', desc: 'Saare commands' },
];
const LABEL = { todo: 'Todo', in_progress: 'Doing', review: 'Testing', done: 'Done' };
const PERSON_FILLER = new Set(['tumko', 'tumhe', 'tumhein', 'tujhe', 'tum', 'aapko', 'apko', 'aap', 'ko', 'ji', 'bhai', 'sir', 'ne',
  'ka', 'ki', ':', '-', ',']);

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

// Pull "due <date>", "by/till <date>" or "<date> tak" out of free text -> {text, date, bad}. bad = "due" with no date.
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
        if ((w[end] || '').toLowerCase() === 'tak') end++;
        const date = parseDate(part.join(' '));
        if (date) { found = { start: i, end, date }; break; }
      }
      if (!found && k === 'due') bad = true;
    } else if (k === 'tak' && i > 0) {
      for (let n = 2; n >= 1; n--) {
        if (i - n < 0) continue;
        const date = parseDate(w.slice(i - n, i).join(' '));
        if (date) { found = { start: i - n, end: i + 1, date }; break; }
      }
    }
  }
  if (!found) return { text: w.join(' '), date: null, bad };
  return { text: [...w.slice(0, found.start), ...w.slice(found.end)].join(' '), date: found.date, bad: false };
}

// ---------- people ----------
// Person resolution shared by /task, /reassign, /tasks: a structured @mention (id sent by the app) wins; else the first
// 1-2 words matched case-insensitively (exact > prefix > fuzzy, names.js), chat members preferred over all active users,
// bot excluded. Several equal matches -> AI pick from context (if on and sure), else a tappable 'userpicker' card.
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

const firstName = (name) => String(name || '').trim().split(/\s+/)[0];

// Ephemeral "who?" card. Tapping a user re-sends: '/' + command + (pre ? ' ' + pre : '') + ' @' + firstName + (arg ? ' ' + arg : '')
// together with mentionIds [user.id], so the server takes that exact person (works for same-name people).
async function userPicker(ctx, command, query, list, arg, pre, notFound) {
  const users = list.slice(0, 12).map((p) => ({ id: p.id, name: p.name, phoneTail: String(p.phone || '').slice(-4) }));
  const text = notFound
    ? (query ? '"' + query + '" naam ka koi nahi mila. ' : '') + 'Kisko? Tap karein:'
    : '"' + query + '" naam ke ' + list.length + ' log hain. Kaun? Tap karein:';
  const body = text + '\n' + users.map((u) => u.name + (u.phoneTail ? ' (...' + u.phoneTail + ')' : '')).join('\n');
  return bot.ephemeral(ctx.chatId, ctx.user.id, body, { kind: 'userpicker', command, text, users, arg: arg || '', pre: pre || '' });
}

// Choices when a name matched nobody: the chat's members (minus me), else everyone.
async function everyoneFor(ctx) {
  const list = (await chatPeople(ctx.chatId)).filter((p) => p.id !== ctx.user.id);
  return list.length > 1 ? list : (await people()).filter((p) => p.id !== ctx.user.id);
}

// ---------- tasks ----------
function hashId(args) {
  const m = args.match(/(^|\s)#(\d{1,9})(?=\s|$)/);
  if (!m) return { id: null, rest: args.trim() };
  return { id: Number(m[2]), rest: (args.slice(0, m.index) + ' ' + args.slice(m.index + m[0].length)).replace(/\s+/g, ' ').trim() };
}

// Open tasks a user would mean without a #id: assigned to them, else ones they created.
async function candidates(user) {
  const open = (list) => list.filter((t) => t.status !== 'done');
  let list = open(await T.listTasks({ assignee: String(user.id) }, user));
  if (!list.length) list = open(await T.listTasks({ assignee: 'all' }, user)).filter((t) => t.createdBy === user.id);
  return list.slice(0, 20);
}

const brief = (t) => ({ id: t.id, title: t.title, status: t.status });
const err = (ctx, code, message) => bot.errorCard(ctx.chatId, ctx.user.id, code, message);
const info = (ctx, text) => bot.infoCard(ctx.chatId, ctx.user.id, text);

function picker(ctx, command, list, arg) {
  const text = 'Kaunsa task? Tap karein:';
  const body = text + '\n' + list.map((t) => '#' + t.id + ' ' + t.title).join('\n');
  return bot.ephemeral(ctx.chatId, ctx.user.id, body, { kind: 'picker', command, text, tasks: list.map(brief), ...(arg ? { arg } : {}) });
}

// #id given -> that task; else the single candidate (not for delete); else an ephemeral picker. null = already answered.
// noGuess: never pick a task by matching words of `arg` (arg is free text like a description).
async function resolveTask(ctx, command, id, arg, alwaysPick, noGuess) {
  if (id) return T.getTask(id); // TaskError 404 -> error card
  const list = await candidates(ctx.user);
  if (!list.length) {
    await err(ctx, 'NOT_FOUND', 'Aapka koi open task nahi hai. Task number ke saath likhiye, jaise /' + command + ' #12');
    return null;
  }
  // guesses without a #id are only safe on the sender's own tasks (not on tasks they merely created)
  const own = list.every((t) => t.assigneeId === ctx.user.id);
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
    // the natural next step after "/update ... testing baaki": the single task waiting in Testing
    const inReview = list.filter((t) => t.status === 'review');
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

// ---------- commands ----------
async function cmdTask(ctx, args) {
  if (!args) return err(ctx, 'BAD_COMMAND', 'Likhiye: /task <naam> <kaam> [due kal]. Jaise: /task anubhav crm pe date filter banana hai due fri');
  if (!T.canAssign(ctx.user)) return err(ctx, 'NOT_ALLOWED', 'Members ko task banane ki permission abhi band hai (Admin Settings).');
  const due = extractDue(args);
  if (due.bad) return err(ctx, 'BAD_COMMAND', 'Due date samajh nahi aayi. Likhiye: due aaj / kal / parso / fri / 25 nov / 2026-11-30');
  const lp = await personAt(ctx, due.text.split(' ').filter(Boolean), true);
  const again = () => lp.rest.join(' ') + (due.date ? ' due ' + due.date : '');
  if (lp.ambiguous) return userPicker(ctx, 'task', lp.query, lp.ambiguous, again());
  if (lp.unknown) return userPicker(ctx, 'task', lp.query, await everyoneFor(ctx), again(), '', true);
  const assignee = lp.person || ctx.user;
  const body = (lp.person ? lp.rest : due.text.split(' ')).join(' ').trim();
  if (!body) return err(ctx, 'BAD_COMMAND', 'Kaam bhi likhiye. Jaise: /task ' + (lp.person ? firstName(lp.person.name).toLowerCase() : 'anubhav') + ' login page fix karna hai');
  const tt = await provider.taskTitle(body);
  const task = await T.createTask({
    title: tt.title, description: tt.description || body, assigneeId: assignee.id, dueDate: due.date, project: tt.project, chatId: ctx.chatId,
  }, ctx.user, 'command', ctx.message.id);
  await card(ctx, { event: 'created', task }, { byAi: tt.byAi });
  if (tt.error) await aiErrorCard(ctx, tt.error, 'Task simple rules se bana diya gaya.');
}

// /update, /done, /testing
async function cmdWork(ctx, args, command) {
  const forced = { done: 'done', testing: 'review' }[command] || null;
  const { id, rest } = hashId(args);
  if (command === 'update' && !rest) return err(ctx, 'BAD_COMMAND', 'Note bhi likhiye. Jaise: /update #12 filter laga diya, testing baaki hai');
  const task = await resolveTask(ctx, command, id, rest);
  if (!task) return;
  const f = {};
  if (rest) f.note = rest.slice(0, 1000);
  const status = forced || provider.statusFromNote(rest);
  if (status && status !== task.status) f.status = status;
  if (!T.canWork(task, ctx.user) && !T.canDescribe(task, ctx.user)) throw new T.TaskError(403, 'Not allowed');
  if (!Object.keys(f).length) return info(ctx, 'Task #' + task.id + ' pehle se ' + LABEL[task.status] + ' hai.');
  const r = await T.applyUpdate(task.id, f, ctx.user, 'command', ctx.message.id);
  await card(ctx, r, rest ? { note: rest.slice(0, 1000) } : {});
}

async function cmdReassign(ctx, args) {
  const { id, rest } = hashId(args);
  if (!rest) return err(ctx, 'BAD_COMMAND', 'Likhiye: /reassign #12 <naam>');
  const task = await resolveTask(ctx, 'reassign', id, rest, false, true);
  if (!task) return;
  const lp = await personAt(ctx, rest.split(' '));
  if (lp.ambiguous) return userPicker(ctx, 'reassign', lp.query, lp.ambiguous, '', '#' + task.id);
  if (!lp.person) return userPicker(ctx, 'reassign', lp.query || rest.slice(0, 40), await everyoneFor(ctx), '', '#' + task.id, true);
  if (task.assigneeId === lp.person.id) return info(ctx, 'Task #' + task.id + ' pehle se ' + lp.person.name + ' ke paas hai.');
  await card(ctx, await T.applyUpdate(task.id, { assigneeId: lp.person.id }, ctx.user, 'command', ctx.message.id));
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
  await card(ctx, await T.applyUpdate(task.id, { dueDate: date }, ctx.user, 'command', ctx.message.id));
}

async function cmdDelete(ctx, args) {
  const { id } = hashId(args);
  const task = await resolveTask(ctx, 'delete', id, null, true);
  if (!task) return;
  const t = await T.deleteTask(task.id, ctx.user, 'command');
  await card(ctx, { event: 'deleted', task: t });
}

// /desc #id <text>: replace the description (boss, assignee or creator).
async function cmdDesc(ctx, args) {
  const { id, rest } = hashId(args);
  if (!rest) return err(ctx, 'BAD_COMMAND', 'Likhiye: /desc #12 <naya description>');
  const task = await resolveTask(ctx, 'desc', id, rest, false, true);
  if (!task) return;
  const r = await T.applyUpdate(task.id, { description: rest.slice(0, 4000) }, ctx.user, 'command', ctx.message.id);
  if (!r.changed) return info(ctx, 'Task #' + task.id + ' ka description pehle se yahi hai.');
  await card(ctx, r, { note: 'Description: ' + rest.slice(0, 300) });
}

// /ask #id: public card mentioning the assignee ("status kya hai?"); their app notifies them.
// Assignee not in this chat -> the card goes to the asker-assignee DM instead.
async function cmdAsk(ctx, args) {
  const { id } = hashId(args);
  if (!id) return err(ctx, 'BAD_COMMAND', 'Task number likhiye: /ask #12 (ya @ button se person chuniye)');
  const task = await T.getTask(id);
  if (!task.assigneeId) return err(ctx, 'BAD_COMMAND', 'Task #' + id + ' kisi ko assigned nahi hai.');
  if (task.assigneeId === ctx.user.id) return info(ctx, 'Task #' + id + ' aapka hi hai.');
  if (task.status === 'done') return info(ctx, 'Task #' + id + ' pehle se Done hai.');
  let chatId = ctx.chatId;
  const inChat = await rt.isChatMember(chatId, task.assigneeId);
  if (!inChat) {
    const dm = await bot.ensureDm(ctx.user.id, task.assigneeId);
    if (dm.created) { rt.sendToUser(task.assigneeId, { type: 'chat', chatId: dm.chatId }); rt.sendToUser(ctx.user.id, { type: 'chat', chatId: dm.chatId }); }
    chatId = dm.chatId;
  }
  const body = '@' + firstName(task.assigneeName) + ', ' + ctx.user.name + ' pooch rahe hain: "' + task.title + '" (#' + id + ') ka status kya hai?';
  await bot.postBot(chatId, body, {
    kind: 'ask', task, actorId: ctx.user.id, actorName: ctx.user.name, assigneeId: task.assigneeId, ...(inChat ? { replyTo: ctx.message.id } : {}),
  }, null, [task.assigneeId]);
  if (!inChat) await info(ctx, task.assigneeName + ' is chat mein nahi hain, unse DM mein pooch liya.');
}

function listCard(ctx, title, tasks) {
  const lines = [title + ' (' + tasks.length + ')'];
  for (const t of tasks) {
    lines.push('#' + t.id + ' ' + t.title + (t.assigneeName ? ' - ' + t.assigneeName : '') + ' [' + LABEL[t.status] + ']' +
      (t.dueDate ? ' due ' + t.dueDate : ''));
  }
  if (!tasks.length) lines.push('Koi open task nahi.');
  return bot.ephemeral(ctx.chatId, ctx.user.id, lines.join('\n'), { kind: 'list', title, tasks });
}

async function cmdTasks(ctx, args) {
  let who = null;
  if (args) {
    const lp = await personAt(ctx, args.split(/\s+/));
    if (lp.ambiguous) return userPicker(ctx, 'tasks', lp.query, lp.ambiguous, '');
    if (!lp.person) return userPicker(ctx, 'tasks', lp.query || args.slice(0, 40), await everyoneFor(ctx), '', '', true);
    who = lp.person;
  }
  const list = (await T.listTasks({ assignee: who ? String(who.id) : 'all' }, ctx.user)).filter((t) => t.status !== 'done').slice(0, 50);
  return listCard(ctx, who ? who.name + ' ke open tasks' : 'Sabke open tasks', list);
}

async function cmdMyTasks(ctx) {
  const list = (await T.listTasks({ assignee: String(ctx.user.id) }, ctx.user)).filter((t) => t.status !== 'done').slice(0, 50);
  return listCard(ctx, 'Mere open tasks', list);
}

function cmdHelp(ctx) {
  const body = 'Commands:\n' + HELP.map((c) => c.cmd + (c.args ? ' ' + c.args : '') + ' - ' + c.desc).join('\n');
  return bot.ephemeral(ctx.chatId, ctx.user.id, body, { kind: 'help', commands: HELP });
}

const HANDLERS = {
  task: cmdTask, update: cmdWork, done: cmdWork, testing: cmdWork, reassign: cmdReassign, due: cmdDue, delete: cmdDelete,
  desc: cmdDesc, ask: cmdAsk, tasks: cmdTasks, mytasks: cmdMyTasks, help: cmdHelp,
};

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

// Swipe-reply with plain text to a task card (kind 'task' or 'ask'): adds a note to that task ("desc: ..." replaces the
// description; status words like "ho gaya" also move the status for the assignee/boss). Only the boss, assignee or
// creator; anyone else's reply is a normal chat message (returns false, the AI engine may still look at it).
async function handleReply(message, user) {
  if (!message || (message.type && message.type !== 'text') || !message.text || !message.replyTo) return false;
  const text = message.text.trim();
  if (!text || text.startsWith('/')) return false;
  const [[orig]] = await pool.query('SELECT type, payload FROM messages WHERE id = ? AND chat_id = ? AND deleted_at IS NULL',
    [message.replyTo.id, message.chatId]);
  if (!orig || orig.type !== 'bot') return false;
  let p = null;
  try { p = JSON.parse(orig.payload); } catch (e) { return false; }
  if (!p || (p.kind !== 'task' && p.kind !== 'ask') || !p.task || !p.task.id) return false;
  const ctx = { message, user, chatId: message.chatId, tagged: [] };
  if (await guards(ctx)) return false;
  let task;
  try { task = await T.getTask(p.task.id); } catch (e) { return false; }
  if (!T.canDescribe(task, user)) return false;
  await safely(ctx, 'reply', async () => {
    const d = text.match(/^desc(?:ription)?\s*[:-]\s*([\s\S]+)$/i);
    if (d) {
      const r = await T.applyUpdate(task.id, { description: d[1].trim().slice(0, 4000) }, user, 'command', message.id);
      return card(ctx, r, { note: 'Description: ' + d[1].trim().slice(0, 300) });
    }
    const f = { note: text.slice(0, 1000) };
    const st = provider.statusFromNote(text);
    if (st && st !== task.status && T.canWork(task, user)) f.status = st;
    await card(ctx, await T.applyUpdate(task.id, f, user, 'command', message.id), { note: f.note });
  });
  return true;
}

module.exports = { handle, handleReply, parseDate, extractDue, HELP };
