// Natural-language AI task engine. Runs after a chat message is saved (never blocks the send) and only when the
// message was not a slash command (commands.js runs first).
// Flow: settings (aiDetect global + per chat, botEnabled) -> keyword prefilter -> provider.decide() -> server-side
// validation -> src/tasks.js (source 'ai') -> public task card. Quiet by design: low confidence, no open tasks or
// nothing to change = no reply at all; questions back (clarify), summaries and errors are ephemeral (sender only).
// The model only suggests; every permission and task id is checked here and again in tasks.js.
const DT = require('./dueTime');
const pool = require('../db');
const T = require('../tasks');
const settings = require('../settings');
const provider = require('./provider');
const { matchPeople } = require('./names');
const bot = require('./bot');

const MIN_CONFIDENCE = 0.6;
const MAX_OPEN_TASKS = 60;
const TASK_RE = /(task|kaam|karna|karni|karo|kar do|kar dena|kar diya|kar di|bhej|bana|dekh|chahiye|assign|deadline|\bdue\b|\btak\b|ho gaya|ho gayi|ho gya|ho gyi|ho gai|hogaya|hogayi|complete|\bdone\b|finish|khatam|shuru|start|working on|kar raha|kar rahi|pending|status|baaki|baki|testing|merge|planning|coding|काम|टास्क|करना|करनी|करो|कर दो|कर दिया|हो गया|हो गई|हो गयी|पूरा|खत्म|शुरू|बाकी|भेज|बना|तक)/i;
const S = require('../status');
const LABEL = S.LABEL;
const TZ = (() => { try { new Intl.DateTimeFormat('en-US', { timeZone: process.env.TZ }); return process.env.TZ || 'Asia/Kolkata'; } catch (e) { return 'Asia/Kolkata'; } })();
const WHEN = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });

// Round 4 context: last ~30 chat lines "Name (20 Nov, 16:32): text" (voice notes = transcript, photos = caption), oldest first.
async function recentLines(chatId, viewerId, n = 30) {
  const [rows] = await pool.query(
    `SELECT m.type, m.body, m.media, m.created_at, u.name FROM messages m JOIN users u ON u.id = m.sender_id
     WHERE m.chat_id = ? AND m.deleted_at IS NULL AND m.type IN ('text', 'image', 'audio') AND (m.visible_to IS NULL OR m.visible_to = ?)
     ORDER BY m.id DESC LIMIT ?`, [chatId, viewerId, n]);
  return rows.reverse().map((r) => {
    let text = r.body || '';
    if (r.type === 'audio') {
      let m = null; try { m = JSON.parse(r.media); } catch (e) { /* none */ }
      text = (m && m.transcript) || '[voice note]';
    } else if (r.type === 'image' && !text) text = '[photo]';
    return r.name + ' (' + WHEN.format(new Date(r.created_at)) + '): ' + String(text).slice(0, 300);
  });
}

// "Task N - title - names - due" (names / due may be missing for a member's brief view)
const taskLine = (t) => {
  const names = (t.assignees ? t.assignees.map((a) => a.name) : t.assigneeNames || []).join(', ');
  return 'Task ' + t.id + ' - ' + t.title + (names ? ' - ' + names : '') + (t.dueDate ? ' - due ' + DT.fmtDue(t.dueDate, t.dueAt) : '');
};

// "@AI <question>" in any text message, or "/ai <question>": answer as a bot message (Round 4). Returns true when handled.
// The asker only sees tasks they may view (private tasks only for their creator; then the answer is shown to the asker alone).
async function answerIfAsked(message, user) {
  if (!message || (message.type && message.type !== 'text') || !message.text) return false;
  const t = message.text.trim();
  let q;
  if (/^\/ai(\s|$)/i.test(t)) q = t.replace(/^\/ai\s*/i, '');
  else if (/(^|\s)@ai\b/i.test(t)) q = t.replace(/(^|\s)@ai\b/gi, ' ').replace(/\s+/g, ' ').trim();
  else return false;
  const chatId = message.chatId;
  if (!(await settings.forChat(chatId)).botEnabled) return false;
  if (!q) { await bot.infoCard(chatId, user.id, 'AI se kuch poochhiye. Jaise: @AI aaj ke pending tasks batao'); return true; }
  const { chatType, members } = await chatContext(chatId);
  const tasks = await T.listTasks({ scope: user.role === 'boss' ? 'all' : 'everyone', status: 'open' }, user);
  const r = await provider.answer(q, {
    asker: user.name, chat_type: chatType, members: members.map((m) => m.name),
    recent_messages: await recentLines(chatId, user.id), open_tasks: tasks.slice(0, 60).map(taskLine),
  });
  const priv = tasks.some((x) => x.private);
  await bot.postBot(chatId, r.text, { kind: 'ai_answer', replyTo: message.id }, priv ? user.id : null);
  return true;
}

// Ephemeral question back to the sender only.
function clarify(chatId, userId, replyTo, text, options = []) {
  const opts = options.slice(0, 5).map((t) => ({ id: t.id, title: t.title, assigneeName: t.assigneeName }));
  const body = text + (opts.length ? '\n' + opts.map((t) => '• ' + t.title).join('\n') : '');
  return bot.ephemeral(chatId, userId, body, { kind: 'clarify', replyTo, text, options: opts });
}

// Resolve a person: by name among `people` (fuzzy), else a model-given id that is among `people`.
function resolvePerson(name, id, people) {
  if (name) {
    const hits = matchPeople(name, people);
    if (hits.length === 1) return hits[0];
    if (hits.length > 1) return id && hits.find((p) => p.id === id) ? hits.find((p) => p.id === id) : null;
  }
  return id ? people.find((p) => p.id === id) || null : null;
}

async function chatContext(chatId) {
  const [[chat]] = await pool.query('SELECT type FROM chats WHERE id = ?', [chatId]);
  const [members] = await pool.query(
    `SELECT u.id, u.name, u.role FROM chat_members cm JOIN users u ON u.id = cm.user_id
     WHERE cm.chat_id = ? AND cm.left_at IS NULL AND u.active = 1 AND u.is_bot = 0 ORDER BY u.name`, [chatId]);
  return { chatType: chat ? chat.type : 'group', members };
}

async function onMessage(message, user) {
  if (!message || (message.type && message.type !== 'text') || !message.text) return; // bot / system / prompts never trigger
  const text = message.text.slice(0, 1000);
  if (text.length < 3 || !TASK_RE.test(text)) return;
  const chatId = message.chatId;
  if (!(await settings.all()).aiDetect) return;
  const cs = await settings.forChat(chatId);
  if (!cs.botEnabled || !cs.aiDetect) return;

  const boss = user.role === 'boss';
  const sender = { id: user.id, name: user.name, role: user.role };
  const { chatType, members } = await chatContext(chatId);
  // Boss sees all open tasks; a member only the ones assigned to them (so the model can only pick those).
  const openTasks = (boss ? await T.listTasks({ scope: 'all', status: 'open' }, user)
    : (await T.assignedTo(user.id)).filter((t) => t.myStatus !== 'done').map((t) => ({ ...t, status: t.myStatus })))
    .slice(0, MAX_OPEN_TASKS);
  // A "Task N" / "#N" named in the message must be visible to the model even when the board is longer than MAX_OPEN_TASKS
  for (const n of new Set([...text.matchAll(/(?:task|#)\s*(\d{1,9})/gi)].map((x) => parseInt(x[1], 10)).slice(0, 3))) {
    if (openTasks.some((t) => t.id === n)) continue;
    const hit = boss ? (await T.listTasks({ scope: 'all', status: 'open', q: '#' + n }, user)).find((t) => t.id === n)
      : (await T.assignedTo(user.id)).filter((t) => t.myStatus !== 'done').map((t) => ({ ...t, status: t.myStatus })).find((t) => t.id === n);
    if (hit) openTasks.unshift(hit);
  }

  const d = await provider.decide({ message: text, sender, members, openTasks, recent: await recentLines(chatId, user.id) });
  if (d.action === 'none') return;
  const replyTo = message.id;

  try {
    if (d.action === 'create_task') {
      // only the boss assigns by plain chat (members use /task); low confidence = stay quiet
      if (!boss || d.confidence < MIN_CONFIDENCE || !d.tasks.length) return;
      for (const it of d.tasks) {
        let who = resolvePerson(it.assignee_name, it.assignee_id, members);
        // DM with no name given: the other person
        if (!who && !it.assignee_name && chatType === 'dm') who = members.find((m) => m.id !== user.id) || null;
        if (!who) {
          await clarify(chatId, user.id, replyTo, 'Ye task kisko dena hai' + (it.title ? ' ("' + it.title + '")' : '') +
            '? Is chat ke members: ' + members.map((m) => m.name).join(', ') + '. Ya likhiye: /task <naam> <kaam>');
          continue;
        }
        if (!it.title) continue;
        try {
          const task = await T.createTask({ title: it.title, assigneeId: who.id, dueDate: it.due_date, chatId }, user, 'ai', message.id);
          await bot.taskCard(chatId, 'created', task, user, { byAi: true, replyTo, undo: 'delete' });
        } catch (e) {
          if (!(e instanceof T.TaskError)) throw e;
          await bot.infoCard(chatId, user.id, 'Task nahi bana: ' + e.message);
        }
      }
      return;
    }

    if (d.action === 'complete_task') {
      if (!openTasks.length || d.confidence < MIN_CONFIDENCE) return; // never a public "no open task"
      // task_id must be one of the allowed open tasks (own for members, any for boss)
      const task = openTasks.find((t) => t.id === d.task_id);
      // plain chat that we can't tie to one task: stay silent (slash commands are the explicit route)
      if (!task) return;
      if (d.action === 'complete_task') {
        const r = await T.applyUpdate(task.id, { status: 'done' }, user, 'ai', message.id);
        if (!r.changed) return;
        return bot.taskCard(chatId, r.event, r.task, user, { byAi: true, replyTo, undo: 'status' });
      }
      // Round 4: disabled (simple create->done): update_task (step / due / title / assignee changes by chat)
      /*
      const f = {};
      const st = S.norm(d.status);
      if (st && st !== task.status) f.status = st;
      if (boss) {
        if (d.due_date && d.due_date !== (task.dueAt || task.dueDate)) f.dueDate = d.due_date;
        if (d.title && d.title !== task.title) f.title = d.title;
        if (d.assignee_name || d.assignee_id) {
          const who = resolvePerson(d.assignee_name, d.assignee_id, members);
          if (who && who.id !== task.assigneeId) f.assigneeId = who.id;
        }
      }
      if (!Object.keys(f).length) return; // nothing changes; stay quiet
      const r = await T.applyUpdate(task.id, f, user, 'ai', message.id);
      const statusOnly = Object.keys(f).length === 1 && f.status;
      return bot.taskCard(chatId, r.event, r.task, user, { byAi: true, replyTo, undo: statusOnly ? 'status' : null });
      */
    }

    if (d.action === 'reassign_task') {
      // boss only; new person from assignee_name, old person from from_name (needed only when the task has several people)
      if (!boss || d.confidence < MIN_CONFIDENCE) return;
      const task = openTasks.find((t) => t.id === d.task_id);
      if (!task) return;
      const [everyone] = await pool.query('SELECT id, name FROM users WHERE active = 1 AND is_bot = 0');
      const to = resolvePerson(d.assignee_name, d.assignee_id, everyone);
      if (!to) return clarify(chatId, user.id, replyTo, 'Task ' + task.id + ' kisko dena hai? Likhiye: /re Task ' + task.id + ' @naam');
      const cur = task.assignees || [];
      let from = d.from_name ? resolvePerson(d.from_name, null, cur) : null;
      if (!from && cur.length === 1) from = cur[0];
      if (!from || cur.some((a) => a.id === to.id)) {
        return clarify(chatId, user.id, replyTo, 'Task ' + task.id + ' kis se hatana hai? Likhiye: /re Task ' + task.id + ' @purana @naya');
      }
      const r = await T.applyUpdate(task.id, { addAssigneeIds: [to.id], removeAssigneeIds: [from.id] }, user, 'ai', message.id);
      if (!r.changed) return;
      return bot.taskCard(chatId, r.event, r.task, user, { byAi: true, replyTo });
    }

    if (d.action === 'list_tasks') {
      let target = sender;
      if (boss && (d.assignee_name || d.assignee_id)) {
        const [people] = await pool.query('SELECT id, name FROM users WHERE active = 1 AND is_bot = 0');
        const who = resolvePerson(d.assignee_name, d.assignee_id, people);
        if (!who) return;
        target = who;
      }
      const s = await T.mySummary(target.id, user.id);
      const cut = (list) => list.slice(0, 10);
      // Round 4: disabled (simple create->done): ['done', 'change_merged', 'testing', 'coding', 'planning', 'todo']
      const ORDER = ['done', 'todo'];
      const payload = { kind: 'summary', replyTo, userId: target.id, userName: target.name, counts: {} };
      for (const k of ORDER) { payload.counts[k] = s[k].length; payload[k] = cut(s[k]); }
      const lines = [target.name + ' ke tasks:'];
      for (const k of ORDER) {
        lines.push(LABEL[k] + ' (' + s[k].length + ')');
        for (const t of payload[k]) lines.push('• ' + t.title + (t.dueDate ? ' - ' + DT.fmtDue(t.dueDate, t.dueAt) : ''));
      }
      return bot.ephemeral(chatId, user.id, lines.join('\n'), payload);
    }
  } catch (e) {
    if (!(e instanceof T.TaskError)) throw e;
    await bot.infoCard(chatId, user.id, 'Nahi ho paya: ' + e.message);
  }
}

module.exports = { onMessage, answerIfAsked, recentLines };
