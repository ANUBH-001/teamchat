import React, { useEffect } from 'react';
import { AppState } from 'react-native';
import { setupNotifications, listenNotificationTaps, clearCheckinReminders } from './src/push';
import { startSession } from './src/background';
import { loadCheckinToday, clearCheckinToday } from './src/checkinStore';
import { View, ActivityIndicator } from 'react-native';
import { AuthProvider, useAuth } from './src/auth';
import LoginScreen from './src/screens/LoginScreen';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer, DefaultTheme, DarkTheme } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import ChatsScreen from './src/screens/ChatsScreen';
import TasksScreen from './src/screens/TasksScreen';
// Round 4: Admin tab removed (its content lives in Settings > Admin panel)
// import AdminScreen from './src/screens/AdminScreen';
import CallsScreen from './src/screens/CallsScreen';
import ProfileSetupScreen from './src/screens/ProfileSetupScreen';
import { ThemeProvider } from './src/ThemeProvider';
import { useTheme } from './src/useTheme';
import { dark, tabBarStyleFor } from './src/theme';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { checkVersion } from './src/updateStore';
import { checkAndFetch } from './src/otaUpdate';
import { OtaBanner, UpdateBanner, UpdateScreen } from './src/components/UpdateScreen';
import InAppBanner from './src/components/InAppBanner';
import { useUpdateState } from './src/updateStore';

// Round 4: tabs Chats | Tasks | Calls; active tab = pill behind the icon (chip color) + label below
const ICONS: Record<string, [keyof typeof Ionicons.glyphMap, keyof typeof Ionicons.glyphMap]> = {
  Chats: ['chatbubble', 'chatbubble-outline'], Tasks: ['checkbox', 'checkbox-outline'], Calls: ['call', 'call-outline'],
};

const Tab = createBottomTabNavigator();

export default function App() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <AuthProvider>
          <Root />
        </AuthProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

function Root() {
  const t = useTheme();
  const { user, loading } = useAuth();
  const { required } = useUpdateState();
  // force update: ask the server on start and whenever the app returns to the foreground (any 426 also blocks)
  useEffect(() => {
    checkVersion();
    checkAndFetch();
    const sub = AppState.addEventListener('change', (st) => { if (st === 'active') { checkVersion(); checkAndFetch(); } });
    return () => sub.remove();
  }, []);
  useEffect(() => {
    if (!user) return;
    // socket + alerts + foreground service live in background.ts (kept when the UI unmounts, e.g. swiped
    // from recents); they stop only in endSession() on logout (auth.tsx)
    let live = true;
    setupNotifications().then(() => { if (live) startSession(user.id, user.role); });
    const offTaps = listenNotificationTaps();
    return () => { live = false; offTaps(); };
  }, [user]);
  // members: phone reminders for the daily check-ins (local notifications; settings come from the server)
  useEffect(() => {
    if (!user) return;
    if (user.role !== 'member') { clearCheckinReminders(); return; }
    const sync = () => { loadCheckinToday(true).catch(() => {}); };
    sync();
    const sub = AppState.addEventListener('change', (st) => { if (st === 'active') sync(); });
    return () => { sub.remove(); clearCheckinToday(); }; // reminders are cleared on logout (endSession)
  }, [user]);
  if (required) return <UpdateScreen />;
  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: t.background }}>
        <ActivityIndicator color={t.accent} size="large" />
      </View>
    );
  }
  // Round 4 UI test: status bar icons must be dark in light theme on login / onboarding too
  const sbStyle = t === dark ? 'light' : 'dark';
  if (!user) return <><StatusBar style={sbStyle} /><LoginScreen /></>;
  if (user.profileDone === false) return <><StatusBar style={sbStyle} /><ProfileSetupScreen /></>; // Round 4 onboarding gate
  const isDark = t === dark;
  const navTheme = {
    ...(isDark ? DarkTheme : DefaultTheme),
    colors: { ...(isDark ? DarkTheme : DefaultTheme).colors, primary: t.accent, background: t.background, card: t.card, text: t.text, border: t.border },
  };
  return (
    <NavigationContainer theme={navTheme}>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <UpdateBanner />
      <OtaBanner />
      <Tab.Navigator
        screenOptions={({ route }) => ({
          tabBarIcon: ({ focused, color }) => (
            <View style={{ width: 56, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: focused ? t.chip : 'transparent' }}>
              <Ionicons name={ICONS[route.name][focused ? 0 : 1]} color={focused ? t.chipText : color} size={22} />
            </View>
          ),
          tabBarLabelStyle: { fontSize: 12, fontWeight: '600' },
          headerStyle: { backgroundColor: t.background },
          headerTintColor: t.text,
          headerShadowVisible: false,
          tabBarStyle: tabBarStyleFor(t),
          tabBarHideOnKeyboard: true, // more room for the chat + chip row while typing
          tabBarActiveTintColor: t.accent,
          tabBarInactiveTintColor: t.subtext,
        })}
      >
        <Tab.Screen name="Chats" component={ChatsScreen} options={{ headerShown: false }} />
        <Tab.Screen name="Tasks" component={TasksScreen} />
        <Tab.Screen name="Calls" component={CallsScreen} options={{ headerShown: false }} />
        {/* Round 4: <Tab.Screen name="Admin" component={AdminScreen} options={{ title: user.role === 'boss' ? 'Admin' : 'Account' }} /> */}
      </Tab.Navigator>
      <InAppBanner root />
    </NavigationContainer>
  );
}
