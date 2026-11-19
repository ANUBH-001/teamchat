import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, FlatList, Alert, Share, Switch, useColorScheme, RefreshControl, ActivityIndicator,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { light, dark } from '../theme';
import { api } from '../api';
import { useAuth } from '../auth';
import { useLiveRefresh, usePullRefresh } from '../useLive';
import ReportsScreen, { CheckinSettingsScreen } from './ReportsScreen';
import SettingsScreen from './SettingsScreen';
import BackgroundCard from '../components/BackgroundCard';
import AppUpdateCard from '../components/AppUpdateCard';
import Avatar from '../components/Avatar';
import ProfileSheet from '../components/ProfileSheet';

type Row = { id: number; phone: string; name: string; role: string; active: boolean; activated: boolean; avatarEmoji?: string | null };

export default function AdminScreen() {
  const t = useColorScheme() === 'dark' ? dark : light;
  const { user, logout } = useAuth();
  const [users, setUsers] = useState<Row[]>([]);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [invite, setInvite] = useState<{ label: string; code: string } | null>(null);
  const [err, setErr] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState<{ id: number; name: string; avatarEmoji: string | null } | null>(null);
  const [sub, setSub] = useState<'main' | 'reports' | 'settings' | 'app'>('main');
  const toMain = useCallback(() => setSub('main'), []);
  const nav = useNavigation();
  // sub-views draw their own header, so hide the tab header while one is open
  useEffect(() => { nav.setOptions({ headerShown: sub === 'main' }); }, [nav, sub]);

  const load = useCallback(async () => {
    try {
      setUsers((await api<{ users: Row[] }>('GET', '/admin/users')).users);
    } catch (e: any) {
      setErr(e.message);
    }
    setLoaded(true);
  }, []);

  const isBoss = user?.role === 'boss';
  const loadIfBoss = useCallback(() => { if (isBoss) return load(); }, [isBoss, load]);
  useEffect(() => { loadIfBoss(); }, [loadIfBoss]);
  // member list stays live: server pushes `users` to bosses on add / reset / activate / deactivate
  useLiveRefresh(loadIfBoss, ['users']);
  const { refreshing, onRefresh } = usePullRefresh(loadIfBoss);

  const run = async (fn: () => Promise<void>) => {
    setErr('');
    try {
      await fn();
      await load();
    } catch (e: any) {
      setErr(e.message);
    }
  };

  const add = () => run(async () => {
    const r = await api<{ inviteCode: string }>('POST', '/admin/users', { name: name.trim(), phone: phone.trim() });
    setInvite({ label: name.trim(), code: r.inviteCode });
    setName('');
    setPhone('');
  });

  const reset = (u: Row) => Alert.alert('Reset PIN / new invite', 'Reset PIN for ' + u.name + '? Uska device logout ho jayega.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Reset', onPress: () => run(async () => {
      const r = await api<{ inviteCode: string }>('POST', '/admin/users/' + u.id + '/invite');
      setInvite({ label: u.name, code: r.inviteCode });
    }) },
  ]);

  const forceLogout = (u: Row) => Alert.alert('Logout device', u.name + ' ko uske phone se logout kar dein?', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Logout', style: 'destructive', onPress: () => run(async () => { await api('POST', '/admin/users/' + u.id + '/logout'); }) },
  ]);

  const toggle = (u: Row) => run(() => api('PATCH', '/admin/users/' + u.id, { active: !u.active }));

  const input = {
    backgroundColor: t.card, color: t.text, borderColor: t.border, borderWidth: 1,
    borderRadius: 8, padding: 10, fontSize: 15, marginBottom: 8,
  } as const;
  const btn = { backgroundColor: t.accent, borderRadius: 20, paddingVertical: 10, alignItems: 'center' } as const;

  const profileBtn = user ? (
    <TouchableOpacity
      onPress={() => setEditing({ id: user.id, name: user.name, avatarEmoji: user.avatarEmoji || null })}
      style={{ ...btn, marginTop: 12, flexDirection: 'row', justifyContent: 'center', minHeight: 48 }}
    >
      <Text style={{ color: '#fff', fontWeight: '600' }}>Edit profile (naam, emoji)</Text>
    </TouchableOpacity>
  ) : null;
  const sheet = editing ? (
    <ProfileSheet
      visible onClose={() => setEditing(null)} userId={editing.id} name={editing.name} avatarEmoji={editing.avatarEmoji}
      onSaved={() => { if (isBoss) load(); }}
    />
  ) : null;

  const logoutBtn = (
    <TouchableOpacity onPress={logout} style={{ ...btn, backgroundColor: t.primary, marginTop: 12 }}>
      <Text style={{ color: '#fff', fontWeight: '600' }}>Log out ({user?.name})</Text>
    </TouchableOpacity>
  );

  if (user?.role !== 'boss') {
    return <View style={{ flex: 1, padding: 16, backgroundColor: t.background }}>
      <Text style={{ color: t.subtext }}>Only the boss can manage members.</Text>
      <BackgroundCard />
      {profileBtn}
      <AppUpdateCard />
      {logoutBtn}
      {sheet}
    </View>;
  }

  if (sub === 'reports') return <ReportsScreen onBack={toMain} />;
  if (sub === 'settings') return <CheckinSettingsScreen onBack={toMain} />;
  if (sub === 'app') return <SettingsScreen onBack={toMain} />;

  return (
    <View style={{ flex: 1, padding: 16, backgroundColor: t.background }}>
      <FlatList
        data={users}
        keyExtractor={(u) => String(u.id)}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[t.accent]} />}
        initialNumToRender={12}
        windowSize={9}
        ListEmptyComponent={
          loaded ? <Text style={{ color: t.subtext }}>No members yet.</Text> : <ActivityIndicator color={t.accent} />
        }
        ListHeaderComponent={
          <View>
            <TouchableOpacity onPress={() => setSub('app')} style={{ ...btn, marginBottom: 16, flexDirection: 'row', justifyContent: 'center', minHeight: 48 }}>
              <Text style={{ color: '#fff', fontWeight: '700' }}>Settings (AI, notifications, app update)</Text>
            </TouchableOpacity>
            <Text style={{ color: t.text, fontWeight: '700', fontSize: 16, marginBottom: 8 }}>Daily check-ins</Text>
            <View style={{ flexDirection: 'row', marginBottom: 16 }}>
              <TouchableOpacity onPress={() => setSub('reports')} style={{ ...btn, flex: 1, marginRight: 8 }}>
                <Text style={{ color: '#fff', fontWeight: '600' }}>Reports</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setSub('settings')} style={{ ...btn, flex: 1, backgroundColor: t.primary }}>
                <Text style={{ color: '#fff', fontWeight: '600' }}>Check-in settings</Text>
              </TouchableOpacity>
            </View>
            <Text style={{ color: t.text, fontWeight: '700', fontSize: 16, marginBottom: 8 }}>Add member</Text>
            <TextInput style={input} placeholder="Name" placeholderTextColor={t.subtext} value={name} onChangeText={setName} />
            <TextInput style={input} placeholder="Phone" placeholderTextColor={t.subtext} keyboardType="phone-pad"
              value={phone} onChangeText={setPhone} />
            <TouchableOpacity onPress={add} style={btn}>
              <Text style={{ color: '#fff', fontWeight: '600' }}>Add and get invite code</Text>
            </TouchableOpacity>
            {!!err && <Text style={{ color: '#D32F2F', marginTop: 8 }}>{err}</Text>}
            {invite && (
              <View style={{ backgroundColor: t.bubbleOut, borderRadius: 8, padding: 12, marginTop: 12 }}>
                <Text style={{ color: t.text }}>Invite code for {invite.label} (shown once):</Text>
                <Text selectable style={{ color: t.text, fontSize: 24, fontWeight: '700', letterSpacing: 3, marginVertical: 6 }}>
                  {invite.code}
                </Text>
                <TouchableOpacity onPress={() => Share.share({ message: 'Team Chat invite code: ' + invite.code })}>
                  <Text style={{ color: t.primary, fontWeight: '600' }}>Copy / Share</Text>
                </TouchableOpacity>
              </View>
            )}
            <Text style={{ color: t.text, fontWeight: '700', fontSize: 16, marginTop: 20, marginBottom: 8 }}>Members</Text>
          </View>
        }
        renderItem={({ item: u }) => (
          <View style={{ backgroundColor: t.card, borderRadius: 8, padding: 12, marginBottom: 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Avatar name={u.name} id={u.id} userId={u.id} emoji={u.avatarEmoji} size={40} />
              <View style={{ flex: 1, marginLeft: 10 }}>
                <Text style={{ color: t.text, fontWeight: '600' }}>
                  {u.name}{u.role === 'boss' ? ' (boss)' : ''}
                </Text>
                <Text style={{ color: t.subtext }}>
                  {u.phone} - {u.activated ? 'activated' : 'not activated'}
                </Text>
              </View>
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 8 }}>
              <TouchableOpacity onPress={() => setEditing({ id: u.id, name: u.name, avatarEmoji: u.avatarEmoji || null })} style={{ marginRight: 16, minHeight: 32, justifyContent: 'center' }}>
                <Text style={{ color: t.primary, fontWeight: '600' }}>Edit profile</Text>
              </TouchableOpacity>
              {u.id !== user?.id && (
                <TouchableOpacity onPress={() => forceLogout(u)} style={{ minHeight: 32, justifyContent: 'center' }}>
                  <Text style={{ color: t.danger, fontWeight: '600' }}>Logout device</Text>
                </TouchableOpacity>
              )}
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 }}>
              <TouchableOpacity onPress={() => reset(u)}>
                <Text style={{ color: t.primary, fontWeight: '600' }}>Reset PIN / new invite</Text>
              </TouchableOpacity>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Text style={{ color: t.subtext, marginRight: 6 }}>{u.active ? 'Active' : 'Deactivated'}</Text>
                <Switch value={u.active} onValueChange={() => toggle(u)} disabled={u.id === user?.id}
                  trackColor={{ true: t.accent, false: t.border }} thumbColor="#fff" />
              </View>
            </View>
          </View>
        )}
        ListFooterComponent={<View><BackgroundCard />{profileBtn}<AppUpdateCard />{logoutBtn}</View>}
      />
      {sheet}
    </View>
  );
}
