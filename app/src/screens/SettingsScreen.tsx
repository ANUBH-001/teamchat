// Round 4: WhatsApp-style main Settings (opened from the Chats top-right menu).
// The old boss-only server switches screen moved to AdminSettingsScreen (Admin panel > Settings).
import React, { useEffect, useState } from 'react';
import { Alert, BackHandler, Image, Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../useTheme';
import { useAuth } from '../auth';
import { usePrefs, setPref, ThemeChoice } from '../prefs';
import Avatar from '../components/Avatar';
import ProfileSheet from '../components/ProfileSheet';
import BackgroundCard from '../components/BackgroundCard';
import AppUpdateCard from '../components/AppUpdateCard';
import { useUser } from '../userStore';
import { showsAdminLabel } from '../adminLabel';
import { useMediaSrc } from '../media';

const THEMES: { k: ThemeChoice; label: string }[] = [{ k: 'system', label: 'System' }, { k: 'light', label: 'Light' }, { k: 'dark', label: 'Dark' }];

function Section({ title }: { title: string }) {
  const t = useTheme();
  return <Text style={{ color: t.accent, fontSize: 13, fontWeight: '700', paddingHorizontal: 20, paddingTop: 22, paddingBottom: 6 }}>{title}</Text>;
}
function Row({ icon, label, sub, onPress, right, danger }: {
  icon: keyof typeof Ionicons.glyphMap; label: string; sub?: string; onPress?: () => void; right?: React.ReactNode; danger?: boolean;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress} disabled={!onPress} android_ripple={{ color: t.border }}
      style={{ flexDirection: 'row', alignItems: 'center', minHeight: 56, paddingHorizontal: 20 }}
    >
      <Ionicons name={icon} size={22} color={danger ? t.danger : t.subtext} />
      <View style={{ flex: 1, marginLeft: 18, paddingVertical: 8 }}>
        <Text style={{ color: danger ? t.danger : t.text, fontSize: 16 }}>{label}</Text>
        {!!sub && <Text style={{ color: t.subtext, fontSize: 12, marginTop: 1 }}>{sub}</Text>}
      </View>
      {right}
    </Pressable>
  );
}
function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  const t = useTheme();
  return <Switch value={value} onValueChange={onChange} trackColor={{ true: t.accent, false: t.border }} thumbColor={t.onAccent} />;
}

export default function SettingsScreen({ onBack, onOpenAdmin }: { onBack: () => void; onOpenAdmin: () => void }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { user, logout } = useAuth();
  const prefs = usePrefs();
  const me = useUser(user?.id);
  const photo = useMediaSrc(me?.avatarUrl || user?.avatarUrl || null);
  const [editing, setEditing] = useState(false);

  // Android back = back to the Chats list
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { onBack(); return true; });
    return () => sub.remove();
  }, [onBack]);
  if (!user) return null;

  return (
    <View style={{ flex: 1, backgroundColor: t.background }}>
      <View style={{ backgroundColor: t.header, paddingTop: insets.top + 10, paddingBottom: 12, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center' }}>
        <Pressable onPress={onBack} hitSlop={10} style={{ paddingHorizontal: 6 }}><Ionicons name="arrow-back" size={24} color={t.onAccent} /></Pressable>
        <Text style={{ color: t.onAccent, fontSize: 20, fontWeight: '700', marginLeft: 8 }}>Settings</Text>
      </View>
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}>
        {/* profile header */}
        <Pressable onPress={() => setEditing(true)} android_ripple={{ color: t.border }} style={{ flexDirection: 'row', alignItems: 'center', padding: 20 }}>
          {photo
            ? <Image source={{ uri: photo }} style={{ width: 72, height: 72, borderRadius: 36 }} />
            : <Avatar name={me?.name || user.name} id={user.id} userId={user.id} emoji={user.avatarEmoji} size={72} />}
          <View style={{ flex: 1, marginLeft: 16 }}>
            <Text numberOfLines={1} style={{ color: t.text, fontSize: 20, fontWeight: '700' }}>{me?.name || user.name}</Text>
            <Text style={{ color: t.subtext, fontSize: 14, marginTop: 2 }}>{user.phone}{showsAdminLabel(user) ? ' · Admin' : ''}</Text>
          </View>
          <Ionicons name="create-outline" size={22} color={t.accent} />
        </Pressable>

        <Section title="Account" />
        <Row
          icon="log-out-outline" label="Logout" sub={user.name} danger
          onPress={() => Alert.alert('Logout', 'Log out of this phone?', [{ text: 'Cancel', style: 'cancel' }, { text: 'Logout', style: 'destructive', onPress: () => { logout(); } }])}
        />

        <Section title="Chats" />
        <Row icon="contrast-outline" label="Theme" />
        <View style={{ flexDirection: 'row', paddingHorizontal: 20, paddingBottom: 8 }}>
          {THEMES.map((o) => {
            const on = prefs.theme === o.k;
            return (
              <Pressable
                key={o.k} onPress={() => setPref('theme', o.k)}
                style={{ flex: 1, height: 40, marginRight: o.k === 'dark' ? 0 : 8, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? t.chip : t.surface, borderWidth: on ? 1.5 : 0, borderColor: t.accent }}
              >
                <Text style={{ color: on ? t.chipText : t.subtext, fontWeight: on ? '700' : '500' }}>{o.label}</Text>
              </Pressable>
            );
          })}
        </View>
        <Row
          icon="text-outline" label="Auto-show voice transcripts" sub="Open the transcript under a voice note automatically"
          right={<Toggle value={prefs.autoTranscripts} onChange={(v) => setPref('autoTranscripts', v)} />}
        />
        <Row
          icon="download-outline" label="Save photos to gallery" sub="Save photos taken with the camera to the gallery"
          right={<Toggle value={prefs.saveToGallery} onChange={(v) => setPref('saveToGallery', v)} />}
        />

        <Section title="Notifications" />
        <View style={{ paddingHorizontal: 16 }}><BackgroundCard /></View>

        <Section title="App update" />
        <View style={{ paddingHorizontal: 16 }}><AppUpdateCard /></View>

        {user.role === 'boss' && (
          <>
            <Section title="Admin" />
            <Row
              icon="shield-checkmark-outline" label="Admin panel" sub="Members, reports, AI and server settings"
              onPress={onOpenAdmin} right={<Ionicons name="chevron-forward" size={20} color={t.subtext} />}
            />
          </>
        )}
      </ScrollView>
      <ProfileSheet
        visible={editing} onClose={() => setEditing(false)} userId={user.id} name={user.name} avatarEmoji={user.avatarEmoji || null}
      />
    </View>
  );
}
