import React, { useCallback, useEffect, useState } from 'react';
import { AppState, Linking, Text, TouchableOpacity, View } from 'react-native';
import { useTheme } from '../useTheme';
import { backgroundSupported, batteryUnrestricted, openBatterySettings, serviceRunning } from '../background';

// Account/Admin tab card: foreground-service status + battery settings help.
export default function BackgroundCard() {
  const t = useTheme();
  const [running, setRunning] = useState(false);
  const [battery, setBattery] = useState(false);
  const refresh = useCallback(() => { setRunning(serviceRunning()); setBattery(batteryUnrestricted()); }, []);
  useEffect(() => {
    refresh();
    const timer = setTimeout(refresh, 1500); // the service starts a moment after login
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') refresh(); }); // back from Settings
    return () => { clearTimeout(timer); sub.remove(); };
  }, [refresh]);

  const open = () => { if (!openBatterySettings()) Linking.openSettings().catch(() => {}); };
  const dot = (ok: boolean) => ({ color: ok ? t.accent : '#E53935', fontWeight: '600' as const });

  return (
    <View style={{ backgroundColor: t.card, borderRadius: 10, padding: 14, marginTop: 12, borderWidth: 1, borderColor: t.border }}>
      <Text style={{ color: t.text, fontWeight: '700', fontSize: 16, marginBottom: 6 }}>Background alerts</Text>
      {backgroundSupported ? (
        <>
          <Text style={{ color: t.text }}>Service: <Text style={dot(running)}>{running ? 'Running' : 'Stopped'}</Text></Text>
          <Text style={{ color: t.text, marginTop: 2 }}>
            Battery: <Text style={dot(battery)}>{battery ? 'Unrestricted' : 'Optimized (alerts may stop)'}</Text>
          </Text>
        </>
      ) : (
        <Text style={{ color: t.subtext }}>This app build has no background service (Expo Go). Alerts only arrive while the app is open.</Text>
      )}
      <Text style={{ color: t.subtext, marginTop: 8, lineHeight: 19 }}>
        To keep getting message alerts when the app is closed, tap the button below and set TeamChat to "Allow" / Battery
        "Unrestricted". OnePlus/Oppo/Realme (required, otherwise alerts stop as soon as the screen turns off): App info {'>'}
        Battery usage {'>'} "Allow background activity" (not "Smart mode").
        Xiaomi/Redmi: App info {'>'} Autostart ON and Battery saver {'>'} No restrictions. You can also lock the app in Recents.
      </Text>
      <TouchableOpacity onPress={open} style={{ backgroundColor: t.accent, borderRadius: 20, paddingVertical: 10, alignItems: 'center', marginTop: 10 }}>
        <Text style={{ color: '#fff', fontWeight: '600' }}>Battery settings</Text>
      </TouchableOpacity>
    </View>
  );
}
