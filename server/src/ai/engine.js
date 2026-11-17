// Natural-language AI task engine. Runs after a chat message is saved (never blocks the send) and only when the
// message was not a slash command (commands.js runs first).
// Flow: settings (aiDetect global + per chat, botEnabled) -> keyword prefilter -> provider.decide() -> server-side
// validation -> src/tasks.js (source 'ai') -> public task card. Quiet by design: low confidence, no open tasks or
// nothing to change = no reply at all; questions back (clarify), summaries and errors are ephemeral (sender only).
// The model only suggests; every permission and task id is checked here and again in tasks.js.
const pool = require('../db');
const T = require('../tasks');
const settings = require('../settings');
const provider = require('./provider');
const { matchPeople } = require('./names');
const bot = require('./bot');

const MIN_CONFIDENCE = 0.6;
const MAX_OPEN_TASKS = 60;
const TASK_RE = /(task|kaam|karna|karni|karo|kar do|kar dena|kar diya|kar di|bhej|bana|dekh|chahiye|assign|deadline|\bdue\b|\btak\b|ho gaya|ho gayi|ho gya|ho gyi|ho gai|hogaya|hogayi|complete|\bdone\b|finish|khatam|shuru|start|working on|kar raha|kar rahi|pending|status|baaki|baki|testing|काम|टास्क|करना|करनी|करो|कर दो|कर दिया|हो गया|हो गई|हो गयी|पूरा|खत्म|शुरू|बाकी|भेज|बना|तक)/i;
const LABEL = { todo: 'Todo', in_progress: 'Doing', review: 'Testing', done: 'Done' };

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
  // Boss sees all open tasks; a member only their own (so the model can only pick those).
  const openTasks = (await T.listTasks({ assignee: boss ? 'all' : String(user.id) }, user))
    .filter((t) => t.status !== 'done').slice(0, MAX_OPEN_TASKS);

  const d = await provider.decide({ message: text, sender, members, openTasks });
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

    if (d.action === 'complete_task' || d.action === 'update_task' || d.action === 'clarify') {
      if (!openTasks.length || d.confidence < MIN_CONFIDENCE) return; // never a public "no open task"
      // task_id must be one of the allowed open tasks (own for members, any for boss)
      const task = openTasks.find((t) => t.id === d.task_id);
      // plain chat that we can't tie to one task: stay silent (slash commands are the explicit route)
      if (d.action === 'clarify' || !task) return;
      if (d.action === 'complete_task') {
        const r = await T.applyUpdate(task.id, { status: 'done' }, user, 'ai', message.id);
        if (!r.changed) return;
        return bot.taskCard(chatId, 'completed', r.task, user, { byAi: true, replyTo, undo: 'status' });
      }
      const f = {};
      if (d.status && d.status !== task.status) f.status = d.status;
      if (boss) {
        if (d.due_date && d.due_date !== task.dueDate) f.dueDate = d.due_date;
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
    }

    if (d.action === 'list_tasks') {
      let target = sender;
      if (boss && (d.assignee_name || d.assignee_id)) {
        const [people] = await pool.query('SELECT id, name FROM users WHERE active = 1 AND is_bot = 0');
        const who = resolvePerson(d.assignee_name, d.assignee_id, people);
        if (!who) return;
        target = who;
      }
      const s = await T.mySummary(target.id);
      const cut = (list) => list.slice(0, 10);
      const payload = {
        kind: 'summary', replyTo, userId: target.id, userName: target.name,
        counts: { done: s.done.length, review: s.review.length, in_progress: s.in_progress.length, todo: s.todo.length },
        done: cut(s.done), review: cut(s.review), in_progress: cut(s.in_progress), todo: cut(s.todo),
      };
      const lines = [target.name + ' ke tasks:'];
      for (const k of ['done', 'review', 'in_progress', 'todo']) {
        lines.push(LABEL[k] + ' (' + s[k].length + ')');
        for (const t of payload[k]) lines.push('• ' + t.title + (t.dueDate ? ' - ' + t.dueDate : ''));
      }
      return bot.ephemeral(chatId, user.id, lines.join('\n'), payload);
    }
  } catch (e) {
    if (!(e instanceof T.TaskError)) throw e;
    await bot.infoCard(chatId, user.id, 'Nahi ho paya: ' + e.message);
  }
}

module.exports = { onMessage };
