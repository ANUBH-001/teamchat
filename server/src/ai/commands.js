// Slash commands typed in any chat ("/task anubhav crm pe filter banana hai due fri"). Called from routes/chats.js
// after a text message is saved, BEFORE the natural-language engine; handle() returns true when the message was a
// command (then the engine is skipped). The command message itself stays a normal text message.
// Results: task changes -> public task card in the chat; help / lists / pickers / errors -> ephemeral (sender only).
// All task writes go through src/tasks.js (source 'command'), so permissions, task_events and ws 'task' events match.
const pool = require('../db');
const T = require('../tasks');
const settings = require('../settings');
const provider = require('./provider');
const { matchPeople } = require('./names');
const bot = require('./bot');

const CMD_RE = /^\/([a-z][a-z-]*)(?:\s+([\s\S]*))?$/i;
const ALIASES = {
  'completed-task': 'done', complete: 'done', completed: 'done', 'update-task': 'update', 'reassigned-task': 'reassign',
  'reassign-task': 'reassign', review: 'testing', mytask: 'mytasks', 'my-tasks': 'mytasks', list: 'tasks', 'new-task': 'task',
};
const HELP = [
  { cmd: '/task', args: '<naam> <kaam> [due kal|fri|25 nov]', desc: 'Naya task (naam nahi likha = khud ke liye)' },
  { cmd: '/update', args: '[#id] <note>', desc: 'Progress note ("testing baaki" = Testing, "start" = Doing, "ho gaya" = Done)' },
  { cmd: '/done', args: '[#id] [note]', desc: 'Task complete' },
  { cmd: '/testing', args: '[#id] [note]', desc: 'Task Testing mein' },
  { cmd: '/reassign', args: '#id <naam>', desc: 'Task kisi aur ko do' },
  { cmd: '/due', args: '#id <date>', desc: 'Due date badlo (aaj, kal, parso, fri, 25 nov, 2026-11-30, none)' },
  { cmd: '/delete', args: '#id', desc: 'Task delete (banane wala ya admin)' },
  { cmd: '/tasks', args: '[naam]', desc: 'Open tasks (sabke ya ek insaan ke)' },
  { cmd: '/mytasks', args: '', desc: 'Mere open tasks' },
  { cmd: '/help', args: '', desc: 'Saare commands' },
];
const LABEL = { todo: 'Todo', in_progress: 'Doing', review: 'Testing', done: 'Done' };
const PERSON_FILLER = new Set(['tumko', 'tumhe', 'tumhein', 'tum', 'aapko', 'apko', 'aap', 'ko', 'ji', 'bhai', 'sir', 'ne', ':', '-', ',']);

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

// ---------- people / tasks ----------
async function people() {
  const [rows] = await pool.query('SELECT id, name, role FROM users WHERE active = 1 AND is_bot = 0 ORDER BY name');
  return rows;
}

// A person named by the first one or two words ("anubhav", "@Anubhav", "Member 5") -> {person, rest, ambiguous}
function leadingPerson(words, list) {
  if (!words.length) return { person: null, rest: words, ambiguous: null };
  const w0 = words[0].replace(/^@/, '').replace(/[,:]+$/, '');
  if (!w0) return { person: null, rest: words, ambiguous: null };
  let person = null; let used = 1;
  if (words.length > 1) {
    const w1 = words[1].replace(/[,:]+$/, '');
    const h2 = matchPeople(w0 + ' ' + w1, list);
    if (h2.length === 1 && matchPeople(w1, list).some((p) => p.id === h2[0].id) &&
      matchPeople(w0, list).some((p) => p.id === h2[0].id)) { person = h2[0]; used = 2; }
  }
  if (!person) {
    const h1 = matchPeople(w0, list);
    if (h1.length > 1) return { person: null, rest: words, ambiguous: h1 };
    if (h1.length === 1) person = h1[0];
  }
  if (!person) return { person: null, rest: words, ambiguous: null };
  const rest = words.slice(used);
  while (rest.length && PERSON_FILLER.has(rest[0].toLowerCase())) rest.shift();
  return { person, rest, ambiguous: null };
}

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
async function resolveTask(ctx, command, id, arg, alwaysPick) {
  if (id) return T.getTask(id); // TaskError 404 -> error card
  const list = await candidates(ctx.user);
  if (!list.length) {
    await err(ctx, 'NOT_FOUND', 'Aapka koi open task nahi hai. Task number ke saath likhiye, jaise /' + command + ' #12');
    return null;
  }
  // guesses without a #id are only safe on the sender's own tasks (not on tasks they merely created)
  const own = list.every((t) => t.assigneeId === ctx.user.id);
  if (list.length === 1 && !alwaysPick && own) return list[0];
  if (!alwaysPick && arg) {
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
  const lp = leadingPerson(due.text.split(' ').filter(Boolean), await people());
  if (lp.ambiguous) return err(ctx, 'BAD_COMMAND', 'Kaun? ' + lp.ambiguous.map((p) => p.name).join(', ') + '. Poora naam likhiye.');
  const assignee = lp.person || ctx.user;
  const body = lp.rest.join(' ').trim();
  if (!body) return err(ctx, 'BAD_COMMAND', 'Kaam bhi likhiye. Jaise: /task ' + (lp.person ? lp.person.name.split(' ')[0].toLowerCase() : 'anubhav') + ' login page fix karna hai');
  const tt = await provider.taskTitle(body);
  const task = await T.createTask({
    title: tt.title, description: body, assigneeId: assignee.id, dueDate: due.date, project: tt.project, chatId: ctx.chatId,
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
  if (!Object.keys(f).length) return info(ctx, 'Task #' + task.id + ' pehle se ' + LABEL[task.status] + ' hai.');
  const r = await T.applyUpdate(task.id, f, ctx.user, 'command', ctx.message.id);
  await card(ctx, r, rest ? { note: rest.slice(0, 1000) } : {});
}

async function cmdReassign(ctx, args) {
  const { id, rest } = hashId(args);
  if (!rest) return err(ctx, 'BAD_COMMAND', 'Likhiye: /reassign #12 <naam>');
  const lp = leadingPerson(rest.split(' '), await people());
  if (lp.ambiguous) return err(ctx, 'BAD_COMMAND', 'Kaun? ' + lp.ambiguous.map((p) => p.name).join(', ') + '. Poora naam likhiye.');
  if (!lp.person) return err(ctx, 'NOT_FOUND', '"' + rest.slice(0, 40) + '" naam ka koi member nahi mila.');
  const task = await resolveTask(ctx, 'reassign', id, rest);
  if (!task) return;
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
    const lp = leadingPerson(args.split(/\s+/), await people());
    if (lp.ambiguous) return err(ctx, 'BAD_COMMAND', 'Kaun? ' + lp.ambiguous.map((p) => p.name).join(', ') + '. Poora naam likhiye.');
    if (!lp.person) return err(ctx, 'NOT_FOUND', '"' + args.slice(0, 40) + '" naam ka koi member nahi mila.');
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
  tasks: cmdTasks, mytasks: cmdMyTasks, help: cmdHelp,
};

function friendly(e) {
  if (e.status === 403) return 'Ye aap nahi kar sakte (sirf admin, task banane wala ya jiska task hai).';
  if (e.status === 404) return 'Task nahi mila (number check karein, /mytasks dekhiye).';
  return 'Nahi ho paya: ' + e.message;
}

// -> true if the message was a slash command (answered here), false otherwise.
async function handle(message, user) {
  if (!message || (message.type && message.type !== 'text') || !message.text) return false;
  const m = message.text.trim().match(CMD_RE);
  if (!m) return false;
  const raw = m[1].toLowerCase();
  const name = ALIASES[raw] || raw;
  const ctx = { message, user, chatId: message.chatId };
  try {
    const s = await settings.all();
    if (!s.commandsEnabled) { await err(ctx, 'COMMANDS_DISABLED', 'Slash commands abhi band hain (Admin Settings).'); return true; }
    if (!(await settings.forChat(ctx.chatId)).botEnabled) {
      await err(ctx, 'COMMANDS_DISABLED', 'Is chat mein task bot band hai (Admin Settings).');
      return true;
    }
    const fn = HANDLERS[name];
    if (!fn) { await err(ctx, 'BAD_COMMAND', 'Ye command nahi pata: /' + raw + '. /help likhiye.'); return true; }
    await fn(ctx, (m[2] || '').replace(/\s+/g, ' ').trim(), name);
  } catch (e) {
    if (e instanceof T.TaskError) await err(ctx, e.code === 'BAD_REQUEST' ? 'BAD_COMMAND' : e.code, friendly(e));
    else {
      console.error('command /' + name + ':', e.message);
      await err(ctx, 'BAD_COMMAND', 'Kuch galat ho gaya, dobara try karein.').catch(() => {});
    }
  }
  return true;
}

module.exports = { handle, parseDate, extractDue, HELP };
