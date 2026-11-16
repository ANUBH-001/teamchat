// AI task engine. Runs after a chat message is saved (never blocks the send).
// Flow: cheap keyword prefilter -> provider.decide() -> server-side validation -> src/tasks.js (source 'ai')
// -> a 'bot' message from Team Assistant in the same chat (task card / summary / clarify).
// The model only suggests; every permission and task id is checked here and again in tasks.js.
const crypto = require('crypto');
const pool = require('../db');
const rt = require('../realtime');
const T = require('../tasks');
const provider = require('./provider');
const { matchPeople } = require('./names');
const { botUserId } = require('./bot');

const MIN_CONFIDENCE = 0.6;
const MAX_OPEN_TASKS = 60;
const TASK_RE = /(task|kaam|karna|karni|karo|kar do|kar dena|kar diya|kar di|bhej|bana|dekh|chahiye|assign|deadline|\bdue\b|\btak\b|ho gaya|ho gayi|ho gya|ho gyi|ho gai|hogaya|hogayi|complete|\bdone\b|finish|khatam|shuru|start|working on|kar raha|kar rahi|pending|status|baaki|baki|काम|टास्क|करना|करनी|करो|कर दो|कर दिया|हो गया|हो गई|हो गयी|पूरा|खत्म|शुरू|बाकी|भेज|बना|तक)/i;
const LABEL = { todo: 'Pending', in_progress: 'In progress', done: 'Done' };

const cardTask = (t) => ({ id: t.id, title: t.title, assigneeId: t.assigneeId, assigneeName: t.assigneeName, status: t.status, dueDate: t.dueDate });

async function postBot(chatId, body, payload) {
  const { MSG_SELECT, formatMessage } = require('../routes/chats'); // lazy: chats.js requires this file
  const [r] = await pool.query(
    "INSERT INTO messages (chat_id, sender_id, body, client_id, type, payload) VALUES (?, ?, ?, ?, 'bot', ?)",
    [chatId, await botUserId(), body.slice(0, 4000), 'bot-' + crypto.randomUUID(), JSON.stringify(payload)]);
  const [[row]] = await pool.query(MSG_SELECT + 'WHERE m.id = ?', [r.insertId]);
  const message = formatMessage(row, { role: 'member' });
  for (const u of await rt.memberIds(chatId)) rt.sendToUser(u, { type: 'message', message });
  require('../push').notifyMessage(message);
}

function clarify(chatId, replyTo, text, options = []) {
  const opts = options.slice(0, 5).map((t) => ({ id: t.id, title: t.title, assigneeName: t.assigneeName }));
  const body = text + (opts.length ? '\n' + opts.map((t) => '• ' + t.title).join('\n') : '');
  return postBot(chatId, body, { kind: 'clarify', replyTo, text, options: opts });
}

function taskCard(chatId, replyTo, action, task, undo) {
  const verb = { created: 'Task assigned', completed: 'Task done', updated: 'Task updated' }[action];
  const body = verb + ': ' + task.title + (task.assigneeName ? ' (' + task.assigneeName + ')' : '');
  return postBot(chatId, body, { kind: 'task', replyTo, action, task: cardTask(task), undo });
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
  if (!message || message.type === 'bot' || !message.text) return;
  const text = message.text.slice(0, 1000);
  if (text.length < 3 || !TASK_RE.test(text)) return;

  const chatId = message.chatId;
  const boss = user.role === 'boss';
  const sender = { id: user.id, name: user.name, role: user.role };
  const { chatType, members } = await chatContext(chatId);
  // Boss sees all open tasks; a member only their own (so the model can only pick those).
  const openTasks = (await T.listTasks({ assignee: boss ? 'all' : String(user.id) }, user))
    .filter((t) => t.status !== 'done').slice(0, MAX_OPEN_TASKS);

  const d = await provider.decide({ message: text, sender, members, openTasks });
  if (d.action === 'none') return;
  const replyTo = message.id;

  try {
    if (d.action === 'create_task') {
      if (!boss) return; // only the boss assigns; stay silent for members (no chat spam)
      if (d.confidence < MIN_CONFIDENCE || !d.tasks.length) {
        return clarify(chatId, replyTo, 'Kisko kya kaam dena hai? Likhiye: "<naam> ko <kaam>".');
      }
      for (const it of d.tasks) {
        let who = resolvePerson(it.assignee_name, it.assignee_id, members);
        // DM with no name given: the other person
        if (!who && !it.assignee_name && chatType === 'dm') who = members.find((m) => m.id !== user.id) || null;
        if (!who) {
          await clarify(chatId, replyTo, 'Ye task kisko dena hai' + (it.title ? ' ("' + it.title + '")' : '') +
            '? Is chat ke members: ' + members.map((m) => m.name).join(', '));
          continue;
        }
        if (!it.title) { await clarify(chatId, replyTo, who.name + ' ko kya kaam dena hai?'); continue; }
        try {
          const task = await T.createTask({ title: it.title, assigneeId: who.id, dueDate: it.due_date }, user, 'ai', message.id);
          await taskCard(chatId, replyTo, 'created', task, 'delete');
        } catch (e) {
          if (!(e instanceof T.TaskError)) throw e;
          await postBot(chatId, 'Task nahi bana: ' + e.message, { kind: 'info', replyTo, text: 'Task nahi bana: ' + e.message });
        }
      }
      return;
    }

    if (d.action === 'complete_task' || d.action === 'update_task' || d.action === 'clarify') {
      if (!openTasks.length) {
        const t = boss ? 'Koi open task nahi hai.' : 'Aapka koi open task nahi hai.';
        return postBot(chatId, t, { kind: 'info', replyTo, text: t });
      }
      // task_id must be one of the allowed open tasks (own for members, any for boss)
      const task = openTasks.find((t) => t.id === d.task_id);
      if (d.action === 'clarify' || !task || d.confidence < MIN_CONFIDENCE) {
        return clarify(chatId, replyTo, 'Kaunsa task? Task ka naam likhiye:', openTasks);
      }
      if (d.action === 'complete_task') {
        const fresh = await T.updateTaskStatus(task.id, 'done', user, 'ai', message.id);
        return taskCard(chatId, replyTo, 'completed', fresh, 'status');
      }
      const f = {};
      if (d.status && d.status !== task.status) f.status = d.status;
      if (boss) {
        if (d.due_date && d.due_date !== task.dueDate) f.dueDate = d.due_date;
        if (d.title && d.title !== task.title) f.title = d.title;
        if (d.assignee_name || d.assignee_id) {
          const who = resolvePerson(d.assignee_name, d.assignee_id, members);
          if (!who) return clarify(chatId, replyTo, 'Kisko dena hai? Is chat ke members: ' + members.map((m) => m.name).join(', '));
          if (who.id !== task.assigneeId) f.assigneeId = who.id;
        }
      }
      if (!Object.keys(f).length) return; // nothing changes; stay quiet
      const fresh = await T.updateTask(task.id, f, user, 'ai', message.id);
      const statusOnly = Object.keys(f).length === 1 && f.status;
      return taskCard(chatId, replyTo, f.status === 'done' ? 'completed' : 'updated', fresh, statusOnly ? 'status' : null);
    }

    if (d.action === 'list_tasks') {
      let target = sender;
      if (boss && (d.assignee_name || d.assignee_id)) {
        const [people] = await pool.query('SELECT id, name FROM users WHERE active = 1 AND is_bot = 0');
        const who = resolvePerson(d.assignee_name, d.assignee_id, people);
        if (!who) return clarify(chatId, replyTo, 'Kiske tasks dikhaun? Naam likhiye.');
        target = who;
      }
      const s = await T.mySummary(target.id);
      const cut = (list) => list.slice(0, 10);
      const payload = {
        kind: 'summary', replyTo, userId: target.id, userName: target.name,
        counts: { done: s.done.length, in_progress: s.in_progress.length, todo: s.todo.length },
        done: cut(s.done), in_progress: cut(s.in_progress), todo: cut(s.todo),
      };
      const lines = [target.name + ' ke tasks:'];
      for (const k of ['done', 'in_progress', 'todo']) {
        lines.push(LABEL[k] + ' (' + s[k].length + ')');
        for (const t of payload[k]) lines.push('• ' + t.title + (t.dueDate ? ' - ' + t.dueDate : ''));
      }
      return postBot(chatId, lines.join('\n'), payload);
    }
  } catch (e) {
    if (!(e instanceof T.TaskError)) throw e;
    // e.g. task changed meanwhile / not allowed: tell the chat briefly
    await postBot(chatId, 'Nahi ho paya: ' + e.message, { kind: 'info', replyTo, text: 'Nahi ho paya: ' + e.message });
  }
}

module.exports = { onMessage };
