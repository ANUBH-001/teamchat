import * as Notifications from 'expo-notifications';
import { AppState, Platform, Vibration } from 'react-native';
import { emitEvent, onEvent } from './realtime';
import { api } from './api';
import { enqueue } from './outbox';
import { showBanner } from './bannerStore';
import { getPublicSettings } from './publicSettings';
import { CheckinSettings } from './chatTypes';

// No Firebase/FCM: alerts are LOCAL notifications raised from WebSocket 'message' events.
// They only work while the app process is alive; the foreground service (background.ts) keeps it alive.
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowAlert: true, shouldPlaySound: true, shouldSetBadge: false }),
});

let pendingChatId: number | null = null;
let activeChatId: number | null = null; // chat currently open on screen (set by ChatsScreen)
const mutedChats = new Set<number>(); // muted chats do not notify (except @mentions)

// Called with every GET /chats result (ChatsScreen) and by the alert listener itself.
export function setChatPrefs(chats: { id: number; muted?: boolean }[]) {
  mutedChats.clear();
  for (const c of chats) if (c.muted) mutedChats.add(c.id);
}

// Open a chat from another tab (task detail "Chat mein dekho"): kept until ChatsScreen mounts or handles '_open_chat'.
// messageId (optional): scroll to that message once the chat is open.
let pendingMsgId: number | null = null;
export function setPendingChat(id: number, messageId: number | null = null) { pendingChatId = id; pendingMsgId = messageId; }

export function takePendingChat() {
  const id = pendingChatId;
  pendingChatId = null;
  return id;
}
export function takePendingMessage() {
  const id = pendingMsgId;
  pendingMsgId = null;
  return id;
}

export function setActiveChat(id: number | null) {
  activeChatId = id;
}

// Android "Reply" action (text input) on ask / mention notifications: the typed text is sent as a reply to that
// message through the outbox. clientId comes from the notification id, so a repeated response never sends twice.
const REPLY_CATEGORY = 'reply';
const REPLY_ACTION = 'reply';
function replied(r: Notifications.NotificationResponse) {
  const data: any = r.notification.request.content.data || {};
  const chatId = Number(data.chatId);
  const text = String(r.userText || '').trim();
  if (!chatId || !text) return;
  const replyTo = data.messageId
    ? { id: Number(data.messageId), senderName: String(data.senderName || ''), text: data.preview ? String(data.preview) : null, deleted: false }
    : null;
  enqueue(chatId, text, 'nr' + r.notification.request.identifier, new Date().toISOString(), replyTo).catch(() => {});
  Notifications.dismissNotificationAsync(r.notification.request.identifier).catch(() => {});
}

function opened(r: Notifications.NotificationResponse | null) {
  if (r && r.actionIdentifier === REPLY_ACTION) { replied(r); return; }
  const id = Number(r?.notification.request.content.data?.chatId);
  if (!id) return;
  const mid = Number(r?.notification.request.content.data?.messageId) || null;
  pendingChatId = id; // read by ChatsScreen on mount (cold start / just logged in)
  pendingMsgId = mid;
  emitEvent({ type: '_open_chat', chatId: id, messageId: mid }); // or handled live if already mounted
}

// Call once after login: Android channel + notification permission. Failures are ignored.
export async function setupNotifications() {
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('messages', {
        name: 'Messages',
        importance: Notifications.AndroidImportance.HIGH,
      });
      // quiet channel: task updates for admins (no sound, no vibration, no heads-up)
      await Notifications.setNotificationChannelAsync('tasks', {
        name: 'Task updates',
        importance: Notifications.AndroidImportance.LOW,
        sound: null,
        enableVibrate: false,
      });
    }
    // "Reply" button with a text box on ask / mention notifications. Stays in the background.
    await Notifications.setNotificationCategoryAsync(REPLY_CATEGORY, [{
      identifier: REPLY_ACTION,
      buttonTitle: 'Reply',
      textInput: { submitButtonTitle: 'Send', placeholder: 'Write a reply...' },
      options: { opensAppToForeground: false },
    }]).catch(() => {});
    const { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') await Notifications.requestPermissionsAsync();
  } catch (e) {}
}

const preview = (s: string) => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > 100 ? t.slice(0, 97) + '...' : t;
};

// Round 4: notification text of a message (media shows "📷 Photo" / "🎤 Voice note" + caption)
const textOf = (m: any) => {
  const cap = String(m.text || '').replace(/^↪ Forwarded\n?/, '');
  if (m.type === 'image') return (m.media && m.media.kind === 'geo_image' ? '📍 Photo' : '📷 Photo') + (cap ? ': ' + cap : '');
  if (m.type === 'audio') return '🎤 Voice note';
  return String(m.text || '');
};

// reply: the message the notification's "Reply" action answers
type ReplyTarget = { messageId: number; senderName: string; preview: string };
const notify = (title: string, body: string, chatId: number | null | undefined, channelId: 'messages' | 'tasks', reply?: ReplyTarget | null) => {
  const withReply = !!(reply && chatId && reply.messageId);
  Notifications.scheduleNotificationAsync({
    content: {
      title, body,
      data: chatId ? { chatId, ...(withReply ? reply : {}) } : {},
      ...(withReply ? { categoryIdentifier: REPLY_CATEGORY } : {}),
    },
    trigger: Platform.OS === 'android' ? { channelId } : null,
  }).catch(() => {});
};

async function loadChatPrefs() {
  try { setChatPrefs((await api<{ chats: { id: number; muted?: boolean }[] }>('GET', '/chats')).chats); } catch (e) {}
}

// Watches WebSocket events and raises LOCAL notifications while the app is in the background:
// - 'message': not mine, not deleted; muted chats stay silent unless I am @mentioned; bot/system cards never notify
//   (task changes come as 'task' events instead). Foreground in another chat -> short vibration.
// - 'task' (ws {type:'task', task, event, actorId, actorName, notifyAdmin}): assignees hear about new / reassigned
//   tasks and praise; an admin gets a QUIET notification (channel 'tasks') for completed / done / testing /
//   change_merged when the server says notifyAdmin (loud channel when "quiet task notifications" is off); the asker
//   hears 'answered'. @mentions and /ask cards: top banner (InAppBanner) in the foreground when that chat is not open;
//   in the background a notification with an Android "Reply" text action.
export function listenMessageAlerts(myId: number, role: string = 'member') {
  loadChatPrefs();
  const off = onEvent((e) => {
    try {
      if (e.type === 'chat') { loadChatPrefs(); return; }
      // admin: a member signed off (quiet), a task is pending 6+ days (quiet)
      if (e.type === 'signoff' && role === 'boss') {
        if (AppState.currentState === 'active') return;
        const c = e.counts || {};
        notify(String(e.userName || 'Member') + (e.updated ? ' updated their sign-off' : ' signed off'),
          'Done ' + (c.done ?? 0) + ' · Left ' + (c.left ?? 0), null, 'tasks');
        return;
      }
      if (e.type === 'task_stale' && e.task) {
        if (AppState.currentState === 'active') return;
        if (role === 'boss' && e.task.assigneeId !== myId) {
          notify(e.days + '+ days pending: ' + (e.task.assigneeName || ''), preview(String(e.task.title || '')), e.task.chatId, 'tasks');
        }
        return; // the assignee hears it from the reminder card in their check-in chat
      }
      if (e.type === 'task') {
        if (!e.task || e.actorId === myId) return;
        const task = e.task;
        const ev = String(e.event || '');
        const actor = String(e.actorName || 'Someone');
        const title = preview(String(task.title || ''));
        // an assignee answered my /ask: the server sends 'answered' to the asker
        if (ev === 'answered') {
          if (AppState.currentState === 'active') {
            if (task.chatId && task.chatId !== activeChatId) showBanner({ chatId: task.chatId, title: actor + ' replied', body: title });
          } else notify(actor + ' replied', title, task.chatId, 'messages');
          return;
        }
        if (AppState.currentState === 'active') return;
        const assignee = task.assigneeId === myId || (Array.isArray(task.assignees) && task.assignees.some((a: any) => a && a.id === myId));
        if (assignee && (ev === 'created' || ev === 'reassigned')) {
          notify(ev === 'created' ? 'New task' : 'Task assigned to you', title, task.chatId, 'messages');
        } else if (assignee && (ev === 'completed' || ev === 'done')) {
          notify(actor + ' marked your task Done', title, task.chatId, 'messages'); // someone else (e.g. admin) ticked my task
        } else if (assignee && ev === 'praise') {
          notify('👏 ' + actor + ' praised your work', title, task.chatId, 'messages');
        } else if (role === 'boss' && e.notifyAdmin && ['completed', 'done', 'testing', 'review', 'change_merged'].includes(ev)) {
          const what = ev === 'completed' ? ' completed a task' : ev === 'done' ? ' marked their part Done'
            : ev === 'change_merged' ? ': Change merged' : ' moved a task to Testing';
          notify(actor + what, title, task.chatId, getPublicSettings().quietTaskNotifs ? 'tasks' : 'messages');
        }
        return;
      }
      if (e.type !== 'message' || !e.message) return;
      const m = e.message;
      const mentioned = Array.isArray(m.mentions) && m.mentions.includes(myId);
      // bot cards that ask ME something: "/ask" status question, 6-day pending reminder
      const kind = m.type === 'bot' && m.payload ? m.payload.kind : null;
      if (mentioned && (kind === 'ask' || kind === 'reminder') && !m.deleted) {
        const head = kind === 'ask' ? String(m.payload.actorName || 'Someone') + ' asked for a status update' : 'Task is pending';
        const body = preview(String(m.payload.task?.title || m.text || ''));
        if (AppState.currentState === 'active') {
          if (m.chatId !== activeChatId) { Vibration.vibrate(150); showBanner({ chatId: m.chatId, title: head, body, messageId: m.id }); }
          return;
        }
        notify(head, body, m.chatId, 'messages',
          kind === 'ask' && m.id ? { messageId: m.id, senderName: String(m.senderName || 'Bot'), preview: body } : null);
        return;
      }
      if (m.deleted || m.senderId === myId || m.type === 'bot' || m.type === 'system') return;
      if (mutedChats.has(m.chatId) && !mentioned) return;
      // a slash command's own text ("/task anubhav ...", "/ask #12") is not news: the bot card / task event notifies
      if (/^\/[a-z]/i.test(String(m.text || '')) && !mentioned) return;
      if (AppState.currentState === 'active') {
        if (m.chatId !== activeChatId) {
          Vibration.vibrate(150);
          if (mentioned) showBanner({ chatId: m.chatId, title: m.senderName + ' mentioned you', body: preview(textOf(m)), messageId: m.id });
        }
        return;
      }
      const body = preview(textOf(m));
      notify(mentioned ? m.senderName + ' mentioned you' : m.senderName, body, m.chatId, 'messages',
        mentioned && m.id ? { messageId: m.id, senderName: String(m.senderName || ''), preview: body } : null);
    } catch (err) {}
  });
  return off;
}

// Logout: remove this user's message alerts still in the shade (the next user must not see them).
export function dismissMessageAlerts() {
  Notifications.dismissAllNotificationsAsync().catch(() => {});
}

// Listens for notification taps; returns an unsubscribe function.
export function listenNotificationTaps() {
  Notifications.getLastNotificationResponseAsync().then(opened).catch(() => {});
  const sub = Notifications.addNotificationResponseReceivedListener(opened);
  return () => sub.remove();
}

// ---- Daily check-in reminders: LOCAL weekly notifications (no Firebase) ----
// Members only. Times come from GET /checkins/today (settings) and are the phone's local time
// (the server uses the same zone, Asia/Kolkata by default). Stable identifiers: checkin-<kind>-<day 0-6>.
const KINDS = ['morning', 'evening'] as const;
let lastSchedule = ''; // signature of what is scheduled now (skip rescheduling when unchanged)
let scheduling: Promise<void> = Promise.resolve();

const parseTime = (v: string) => {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(v);
  return m ? { hour: Number(m[1]), minute: Number(m[2]) } : null;
};

export function applyCheckinSchedule(s: CheckinSettings, chatId: number | null) {
  const sig = JSON.stringify([s.enabled, s.morningTime, s.eveningTime, [...s.days].sort(), chatId]);
  if (sig === lastSchedule) return scheduling;
  lastSchedule = sig;
  scheduling = scheduling.then(async () => {
    try {
      // cancel all 14 stable ids first (cancelling a missing id is harmless), then schedule the wanted ones
      for (const k of KINDS) for (let d = 0; d < 7; d++) {
        await Notifications.cancelScheduledNotificationAsync('checkin-' + k + '-' + d).catch(() => {});
      }
      if (!s.enabled) return;
      for (const k of KINDS) {
        const time = parseTime(k === 'morning' ? s.morningTime : s.eveningTime);
        if (!time) continue;
        for (const d of s.days) {
          if (!Number.isInteger(d) || d < 0 || d > 6) continue;
          await Notifications.scheduleNotificationAsync({
            identifier: 'checkin-' + k + '-' + d,
            content: {
              title: 'Daily Check-in',
              body: k === 'morning' ? "Good morning! Check today's tasks." : 'Time for your sign-off: what is done, what is left.',
              data: chatId ? { chatId } : {},
            },
            trigger: {
              type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
              weekday: d + 1, // expo: 1 = Sunday; server: 0 = Sunday
              hour: time.hour, minute: time.minute,
              ...(Platform.OS === 'android' ? { channelId: 'messages' } : {}),
            },
          });
        }
      }
    } catch (e) {
      lastSchedule = ''; // retry on the next sync
    }
  });
  return scheduling;
}

// Remove every check-in reminder (logout / boss) and forget the signature.
export function clearCheckinReminders() {
  lastSchedule = '';
  scheduling = scheduling.then(async () => {
    for (const k of KINDS) for (let d = 0; d < 7; d++) {
      await Notifications.cancelScheduledNotificationAsync('checkin-' + k + '-' + d).catch(() => {});
    }
  });
  return scheduling;
}
