import * as Notifications from 'expo-notifications';
import { AppState, Platform, Vibration } from 'react-native';
import { emitEvent, onEvent } from './realtime';

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
