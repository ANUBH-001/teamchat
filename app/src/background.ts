import { AppRegistry } from 'react-native';
import { requireOptionalNativeModule } from 'expo';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getToken } from './api';
import { startRealtime, stopRealtime } from './realtime';
import { listenMessageAlerts, clearCheckinReminders } from './push';

// Background alerts without Firebase: the local module modules/teamchat-service runs an Android
// foreground service ("TeamChat connected") that keeps this JS process + the WebSocket alive when the
// app is in the background or swiped from recents. The session (socket + alert listener) lives here,
// not in a React effect, so it survives the UI unmounting. Expo Go has no module: same code, no service.
type NativeService = {
  start(): void;
  stop(): void;
  isRunning(): boolean;
  isIgnoringBatteryOptimizations(): boolean;
  openBatterySettings(): boolean;
};
const Native = requireOptionalNativeModule<NativeService>('TeamChatService');
const USER_KEY = 'bgUserId'; // lets the headless task (boot / OS restart) know who is logged in

let session: { userId: number; offAlerts: () => void } | null = null;
let releaseTask: (() => void) | null = null;

function startCore(userId: number) {
  if (session && session.userId === userId) return;
  if (session) session.offAlerts();
  session = { userId, offAlerts: listenMessageAlerts(userId) };
  startRealtime();
}

// After login and on every app open (idempotent).
export function startSession(userId: number) {
  startCore(userId);
  AsyncStorage.setItem(USER_KEY, String(userId)).catch(() => {});
  try { Native?.start(); } catch (e) {}
}

// Logout / token rejected: socket, alerts, service, check-in reminders.
export async function endSession() {
  if (session) { session.offAlerts(); session = null; }
  stopRealtime();
  try { Native?.stop(); } catch (e) {}
  if (releaseTask) { releaseTask(); releaseTask = null; }
  clearCheckinReminders();
  await AsyncStorage.removeItem(USER_KEY).catch(() => {});
}

export const backgroundSupported = !!Native;
export function serviceRunning() {
  try { return !!Native?.isRunning(); } catch (e) { return false; }
}
export function batteryUnrestricted() {
  try { return !!Native?.isIgnoringBatteryOptimizations(); } catch (e) { return false; }
}
export function openBatterySettings() {
  try { return !!Native?.openBatterySettings(); } catch (e) { return false; }
}

// Headless task started by the service. It never ends on its own: while it is active React Native keeps
// JS timers running in the background (needed by the reconnect backoff). Resolved by endSession().
AppRegistry.registerHeadlessTask('TeamChatService', () => async () => {
  if (releaseTask) releaseTask();
  const done = new Promise<void>((r) => { releaseTask = r; });
  try {
    const id = Number(await AsyncStorage.getItem(USER_KEY));
    if (id && (await getToken())) startCore(id); // cold start after boot: no UI, start the socket here
  } catch (e) {}
  await done;
});
