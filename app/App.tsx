import React, { useEffect } from 'react';
import { startRealtime, stopRealtime } from './src/realtime';
import { registerPush, listenNotificationTaps } from './src/push';
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

const Tab = createBottomTabNavigator();

export default function App() {
  return (
    <AuthProvider>
      <Root />
    </AuthProvider>
  );
}

function Root() {
  const t = useColorScheme() === 'dark' ? dark : light;
  const { user, loading } = useAuth();
  useEffect(() => {
    if (!user) return;
    startRealtime();
    registerPush();
    const offTaps = listenNotificationTaps();
    return () => { stopRealtime(); offTaps(); };
  }, [user]);
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
      <Tab.Navigator
        screenOptions={{
          headerStyle: { backgroundColor: t.primary },
          headerTintColor: '#FFFFFF',
          tabBarStyle: { backgroundColor: t.card },
          tabBarActiveTintColor: t.accent,
          tabBarInactiveTintColor: t.subtext,
        }}
      >
        <Tab.Screen name="Chats" component={ChatsScreen} options={{ headerShown: false }} />
        <Tab.Screen name="Tasks" component={TasksScreen} />
        <Tab.Screen name="Admin" component={AdminScreen} options={{ title: user.role === 'boss' ? 'Admin' : 'Account' }} />
      </Tab.Navigator>
    </NavigationContainer>
  );
}
