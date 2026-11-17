import * as Notifications from 'expo-notifications';
import { AppState, Platform, Vibration } from 'react-native';
import { emitEvent, onEvent } from './realtime';
import { api } from './api';
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

export function takePendingChat() {
  const id = pendingChatId;
  pendingChatId = null;
  return id;
}

export function setActiveChat(id: number | null) {
  activeChatId = id;
}

function opened(r: Notifications.NotificationResponse | null) {
  const id = Number(r?.notification.request.content.data?.chatId);
  if (!id) return;
  pendingChatId = id; // read by ChatsScreen on mount (cold start / just logged in)
  emitEvent({ type: '_open_chat', chatId: id }); // or handled live if already mounted
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
    const { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') await Notifications.requestPermissionsAsync();
  } catch (e) {}
}

const preview = (s: string) => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > 100 ? t.slice(0, 97) + '...' : t;
};

const notify = (title: string, body: string, chatId: number | null | undefined, channelId: 'messages' | 'tasks') => {
  Notifications.scheduleNotificationAsync({
    content: { title, body, data: chatId ? { chatId } : {} },
    trigger: Platform.OS === 'android' ? { channelId } : null,
  }).catch(() => {});
};

async function loadChatPrefs() {
  try { setChatPrefs((await api<{ chats: { id: number; muted?: boolean }[] }>('GET', '/chats')).chats); } catch (e) {}
}

// Watches WebSocket events and raises LOCAL notifications while the app is in the background:
// - 'message': not mine, not deleted; muted chats stay silent unless I am @mentioned; bot/system cards never notify
//   (task changes come as 'task' events instead). Foreground in another chat -> short vibration.
// - 'task' (ws {type:'task', task, event, actorId, actorName, notifyAdmin}): the assignee hears about new / reassigned
//   tasks and praise; an admin gets a QUIET notification (channel 'tasks', no sound) when a task is completed or moved
//   to Testing and the server says notifyAdmin. With the "quiet task notifications" setting off they use the loud channel.
export function listenMessageAlerts(myId: number, role: string = 'member') {
  loadChatPrefs();
  const off = onEvent((e) => {
    try {
      if (e.type === 'chat') { loadChatPrefs(); return; }
      if (e.type === 'task') {
        if (AppState.currentState === 'active' || !e.task || e.actorId === myId) return;
        const task = e.task;
        const ev = String(e.event || '');
        const actor = String(e.actorName || 'Someone');
        const title = preview(String(task.title || ''));
        if (task.assigneeId === myId && (ev === 'created' || ev === 'reassigned')) {
          notify(ev === 'created' ? 'New task' : 'Task reassigned to you', title, task.chatId, 'messages');
        } else if (task.assigneeId === myId && ev === 'praise') {
          notify('👏 ' + actor + ' praised your work', title, task.chatId, 'messages');
        } else if (role === 'boss' && e.notifyAdmin && (ev === 'completed' || ev === 'review')) {
          notify(actor + (ev === 'completed' ? ' completed a task' : ' moved a task to Testing'), title, task.chatId,
            getPublicSettings().quietTaskNotifs ? 'tasks' : 'messages');
        }
        return;
      }
      if (e.type !== 'message' || !e.message) return;
      const m = e.message;
      if (m.deleted || m.senderId === myId || m.type === 'bot' || m.type === 'system') return;
      const mentioned = Array.isArray(m.mentions) && m.mentions.includes(myId);
      if (mutedChats.has(m.chatId) && !mentioned) return;
      if (AppState.currentState === 'active') {
        if (m.chatId !== activeChatId) Vibration.vibrate(150);
        return;
      }
      notify(mentioned ? m.senderName + ' mentioned you' : m.senderName, preview(String(m.text || '')), m.chatId, 'messages');
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
              body: k === 'morning' ? 'Good morning! Aaj ka plan bhejo.' : 'Din ka report bhejo: kya kiya, kya pending.',
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
