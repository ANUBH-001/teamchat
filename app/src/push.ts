import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { api } from './api';
import { emitEvent } from './realtime';

// Show banners while the app is open too (server only pushes when the user has no live connection, so this is rare).
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowAlert: true, shouldPlaySound: true, shouldSetBadge: false }),
});

let pendingChatId: number | null = null;
export function takePendingChat() {
  const id = pendingChatId;
  pendingChatId = null;
  return id;
}

function opened(r: Notifications.NotificationResponse | null) {
  const id = Number(r?.notification.request.content.data?.chatId);
  if (!id) return;
  pendingChatId = id; // read by ChatsScreen on mount (cold start / just logged in)
  emitEvent({ type: '_open_chat', chatId: id }); // or handled live if already mounted
}

// Call once after login. Failures are ignored (push is optional, e.g. no google-services.json yet).
export async function registerPush() {
  try {
    if (Platform.OS !== 'android') return;
    await Notifications.setNotificationChannelAsync('messages', {
      name: 'Messages',
      importance: Notifications.AndroidImportance.HIGH,
    });
    let { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') status = (await Notifications.requestPermissionsAsync()).status;
    if (status !== 'granted') return;
    const token = (await Notifications.getDevicePushTokenAsync()).data; // native FCM token
    if (typeof token === 'string') await api('POST', '/push/token', { token });
  } catch (e) {}
}

// Listens for notification taps; returns an unsubscribe function.
export function listenNotificationTaps() {
  Notifications.getLastNotificationResponseAsync().then(opened).catch(() => {});
  const sub = Notifications.addNotificationResponseReceivedListener(opened);
  return () => sub.remove();
}
