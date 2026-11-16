import Constants from 'expo-constants';

// Priority: EXPO_PUBLIC_SERVER_URL env (e.g. http://localhost:3000 for a USB phone with `adb reverse`),
// then "extra.serverUrl" in app.json. 10.0.2.2 = host machine from the Android emulator.
export const SERVER_URL: string =
  process.env.EXPO_PUBLIC_SERVER_URL ||
  (Constants.expoConfig?.extra as { serverUrl?: string } | undefined)?.serverUrl ||
  'http://10.0.2.2:3000';
