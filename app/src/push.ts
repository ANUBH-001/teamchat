import * as Notifications from 'expo-notifications';
import { AppState, Platform, Vibration } from 'react-native';
import { emitEvent, onEvent } from './realtime';
import { CheckinSettings } from './chatTypes';

// No Firebase/FCM: alerts are LOCAL notifications raised from WebSocket 'message' events.
// They only work while the app process is alive (foreground or recently backgrounded).
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowAlert: true, shouldPlaySound: true, shouldSetBadge: false }),
});

let pendingChatId: number | null = null;
let activeChatId: number | null = null; // chat currently open on screen (set by ChatsScreen)

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
    }
    const { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') await Notifications.requestPermissionsAsync();
  } catch (e) {}
}

const preview = (s: string) => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > 100 ? t.slice(0, 97) + '...' : t;
};

// Watches WebSocket 'message' events. Background/inactive -> local notification; foreground in another chat -> vibrate.
export function listenMessageAlerts(myId: number) {
  return onEvent((e) => {
    try {
      if (e.type !== 'message' || !e.message) return;
      const m = e.message;
      if (m.deleted || m.senderId === myId) return;
      if (AppState.currentState === 'active') {
        if (m.chatId !== activeChatId) Vibration.vibrate(150);
        return;
      }
      let title: string;
      let body: string;
      if (m.type === 'bot') {
        const p = m.payload;
        if (!p || p.kind !== 'task' || p.action !== 'created' || !p.task || p.task.assigneeId !== myId) return;
        title = 'New task';
        body = preview(String(p.task.title || ''));
      } else {
        title = m.senderName;
        body = preview(String(m.text || ''));
      }
      Notifications.scheduleNotificationAsync({
        content: { title, body, data: { chatId: m.chatId } },
        trigger: Platform.OS === 'android' ? { channelId: 'messages' } : null,
      }).catch(() => {});
    } catch (err) {}
  });
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
