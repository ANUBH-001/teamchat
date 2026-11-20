// Round 4: Calls tab placeholder ("coming soon"). Same top bar style as Chats.
import React from 'react';
import { Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../useTheme';

export default function CallsScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: t.background }}>
      <View style={{ paddingTop: insets.top + 10, paddingBottom: 8, paddingHorizontal: 16 }}>
        <Text style={{ color: t.accent, fontSize: 24, fontWeight: '800' }}>Calls</Text>
      </View>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, paddingBottom: 60 }}>
        <View style={{ width: 96, height: 96, borderRadius: 48, backgroundColor: t.accent, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="call" size={44} color={t.onAccent} />
        </View>
        <Text style={{ color: t.text, fontSize: 20, fontWeight: '700', marginTop: 20 }}>Calls coming soon</Text>
        <Text style={{ color: t.subtext, fontSize: 14, marginTop: 6, textAlign: 'center' }}>Voice and video calls are coming soon.</Text>
      </View>
    </View>
  );
}
