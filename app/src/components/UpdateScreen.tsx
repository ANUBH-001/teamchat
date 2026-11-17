import React from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../useTheme';
import { checkVersion, dismissUpdateBanner, useUpdateState } from '../updateStore';
import { VERSION_NAME } from '../version';

// Full-screen block: this app is older than the server's minimum version (or any call answered 426).
export function UpdateScreen() {
  const t = useTheme();
  const { info } = useUpdateState();
  const url = info?.apkUrl || '';
  return (
    <View style={{ flex: 1, backgroundColor: t.background, alignItems: 'center', justifyContent: 'center', padding: 32 }}>
      <View style={{ width: 88, height: 88, borderRadius: 44, backgroundColor: t.accent, alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name="cloud-download" size={44} color="#fff" />
      </View>
      <Text style={{ color: t.text, fontSize: 22, fontWeight: '700', marginTop: 24 }}>Update required</Text>
      <Text style={{ color: t.subtext, fontSize: 15, textAlign: 'center', marginTop: 8, maxWidth: 320 }}>
        {info?.message || 'TeamChat ka naya version install karein. Purana version ab kaam nahi karega.'}
      </Text>
      <Text style={{ color: t.subtext, fontSize: 12, marginTop: 12 }}>
        Installed {VERSION_NAME}{info?.latestVersionName ? '  ·  Latest ' + info.latestVersionName : ''}
      </Text>
      {url ? (
        <Pressable
          onPress={() => Linking.openURL(url).catch(() => {})}
          style={{ marginTop: 28, minHeight: 52, borderRadius: 26, backgroundColor: t.accent, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40 }}
        >
          <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>Download update</Text>
        </Pressable>
      ) : (
        <Text style={{ color: t.subtext, fontSize: 13, textAlign: 'center', marginTop: 24 }}>Download link not set yet. Admin se APK link maangein.</Text>
      )}
      <Pressable onPress={() => checkVersion()} style={{ marginTop: 16, minHeight: 44, justifyContent: 'center', paddingHorizontal: 16 }}>
        <Text style={{ color: t.accent, fontWeight: '600' }}>Check again</Text>
      </Pressable>
    </View>
  );
}

// Dismissible floating banner: a newer (optional) version exists.
export function UpdateBanner() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { info, available } = useUpdateState();
  if (!available || !info) return null;
  return (
    <View
      style={{
        position: 'absolute', left: 12, right: 12, top: insets.top + 8, zIndex: 50, elevation: 8, flexDirection: 'row', alignItems: 'center',
        backgroundColor: t.card, borderRadius: 14, paddingLeft: 14, minHeight: 52, borderLeftWidth: 4, borderLeftColor: t.accent,
      }}
    >
      <View style={{ flex: 1, paddingVertical: 8 }}>
        <Text style={{ color: t.text, fontSize: 14, fontWeight: '600' }}>New version {info.latestVersionName || ''} available</Text>
        {!!info.message && <Text numberOfLines={1} style={{ color: t.subtext, fontSize: 12 }}>{info.message}</Text>}
      </View>
      {!!info.apkUrl && (
        <Pressable onPress={() => Linking.openURL(info.apkUrl).catch(() => {})} style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 10 }}>
          <Text style={{ color: t.accent, fontWeight: '700' }}>Update</Text>
        </Pressable>
      )}
      <Pressable onPress={dismissUpdateBanner} hitSlop={8} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name="close" size={20} color={t.subtext} />
      </Pressable>
    </View>
  );
}
