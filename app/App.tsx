import React, { useEffect } from 'react';
import { AppState } from 'react-native';
import { setupNotifications, listenNotificationTaps, clearCheckinReminders } from './src/push';
import { startSession } from './src/background';
import { loadCheckinToday, clearCheckinToday } from './src/checkinStore';
import { useColorScheme, View, ActivityIndicator } from 'react-native';
import { AuthProvider, useAuth } from './src/auth';
import LoginScreen from './src/screens/LoginScreen';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import ChatsScreen from './src/screens/ChatsScreen';
import TasksScreen from './src/screens/TasksScreen';
import AdminScreen from './src/screens/AdminScreen';
import { light, dark } from './src/theme';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { checkVersion } from './src/updateStore';
import { checkAndFetch } from './src/otaUpdate';
import { OtaBanner, UpdateBanner, UpdateScreen } from './src/components/UpdateScreen';
import InAppBanner from './src/components/InAppBanner';
import { useUpdateState } from './src/updateStore';

const ICONS: Record<string, keyof typeof Ionicons.glyphMap> = { Chats: 'chatbubbles', Tasks: 'checkbox', Admin: 'people' };

const Tab = createBottomTabNavigator();

export default function App() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <Root />
      </AuthProvider>
    </SafeAreaProvider>
  );
}

function Root() {
  const t = useColorScheme() === 'dark' ? dark : light;
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
  if (!user) return <LoginScreen />;
  return (
    <NavigationContainer>
      <StatusBar style="light" />
      <UpdateBanner />
      <OtaBanner />
      <Tab.Navigator
        screenOptions={({ route }) => ({
          tabBarIcon: ({ color, size }) => <Ionicons name={ICONS[route.name]} color={color} size={size} />,
          headerStyle: { backgroundColor: t.primary },
          headerTintColor: '#FFFFFF',
          tabBarStyle: { backgroundColor: t.card },
          tabBarHideOnKeyboard: true, // more room for the chat + chip row while typing
          tabBarActiveTintColor: t.accent,
          tabBarInactiveTintColor: t.subtext,
        })}
      >
        <Tab.Screen name="Chats" component={ChatsScreen} options={{ headerShown: false }} />
        <Tab.Screen name="Tasks" component={TasksScreen} />
        <Tab.Screen name="Admin" component={AdminScreen} options={{ title: user.role === 'boss' ? 'Admin' : 'Account' }} />
      </Tab.Navigator>
      <InAppBanner root />
    </NavigationContainer>
  );
}
