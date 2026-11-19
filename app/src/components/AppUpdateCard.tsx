import React from 'react';
import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native';
import * as Updates from 'expo-updates';
import { useTheme } from '../useTheme';
import { applyNow, checkAndFetch, useOtaState } from '../otaUpdate';
import { VERSION_CODE, VERSION_NAME } from '../version';

// Account/Admin tab card: app version, last OTA update date, "Update app" button.
export default function AppUpdateCard() {
  const t = useTheme();
  const ota = useOtaState();
  const busy = ota.status === 'checking' || ota.status === 'downloading';
  const created = Updates.createdAt ? Updates.createdAt.toLocaleString() : 'built-in';
  const press = async () => {
    const s = await checkAndFetch();
    if (s === 'ready') setTimeout(() => { applyNow(); }, 800);
  };
  const shown = ota.status === 'idle' ? '' : ota.message;
  return (
    <View style={{ backgroundColor: t.card, borderRadius: 10, padding: 14, marginTop: 12, borderWidth: 1, borderColor: t.border }}>
      <Text style={{ color: t.text, fontWeight: '700', fontSize: 16, marginBottom: 6 }}>App update</Text>
      <Text style={{ color: t.text }}>App version {VERSION_NAME} (code {VERSION_CODE})</Text>
      <Text style={{ color: t.subtext, marginTop: 2 }}>Last update: {created}</Text>
      {!!shown && <Text style={{ color: ota.status === 'error' ? '#E53935' : t.subtext, marginTop: 8 }}>{shown}</Text>}
      <TouchableOpacity
        onPress={press}
        disabled={busy}
        style={{ marginTop: 10, minHeight: 44, borderRadius: 10, backgroundColor: t.accent, alignItems: 'center', justifyContent: 'center', opacity: busy ? 0.6 : 1 }}
      >
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff', fontWeight: '700' }}>Update app</Text>}
      </TouchableOpacity>
    </View>
  );
}
