import Constants from 'expo-constants';

// Set "extra.serverUrl" in app.json. 10.0.2.2 = host machine from the Android emulator.
export const SERVER_URL: string =
  (Constants.expoConfig?.extra as { serverUrl?: string } | undefined)?.serverUrl ?? 'http://10.0.2.2:3000';
