import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, FlatList, Pressable, TextInput, Alert, RefreshControl, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../api';
import { useTheme } from '../useTheme';
import { Chat, Person } from '../chatTypes';
import Avatar from '../components/Avatar';
import { useLiveRefresh, usePullRefresh } from '../useLive';

// mode 'dm': tap a person to start a chat. mode 'group': pick members -> name -> create.
// mode 'add': add people to an existing group (hides `exclude`, calls onAdd with the picked ids).
export default function NewChatScreen({
  mode, onBack, onOpen, exclude, onAdd,
}: { mode: 'dm' | 'group' | 'add'; onBack: () => void; onOpen: (c: Chat) => void; exclude?: number[]; onAdd?: (ids: number[]) => Promise<void> }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [people, setPeople] = useState<Person[]>([]);
  const [picked, setPicked] = useState<number[]>([]);
  const [step, setStep] = useState<'pick' | 'name'>('pick');
  const [name, setName] = useState('');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);

  const [loaded, setLoaded] = useState(false);
  const load = useCallback(async () => {
    try { setPeople((await api<{ users: Person[] }>('GET', '/users')).users); } catch (e) {}
    setLoaded(true);
  }, []);
  useEffect(() => { load(); }, [load]);
  useLiveRefresh(load, []); // reconnect / foreground / manual refresh
  const { refreshing, onRefresh } = usePullRefresh(load);

  const startDm = async (p: Person) => {
    try { onOpen((await api<{ chat: Chat }>('POST', '/chats/dm', { userId: p.id })).chat); }
    catch (e: any) { Alert.alert('Error', e.message); }
  };

  const create = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    try { onOpen((await api<{ chat: Chat }>('POST', '/chats', { name: name.trim(), memberIds: picked })).chat); }
    catch (e: any) { Alert.alert('Error', e.message); setBusy(false); }
  };

  const add = async () => {
    if (!onAdd || busy || !picked.length) return;
    setBusy(true);
    try { await onAdd(picked); } catch (e: any) { Alert.alert('Error', e.message); setBusy(false); }
  };

  const shown = people.filter((p) => p.name.toLowerCase().includes(q.toLowerCase()) && !(exclude ?? []).includes(p.id));
  const title = mode === 'dm' ? 'New chat' : mode === 'add' ? 'Add members' : step === 'pick' ? 'Add members' : 'Group name';

  return (
    <View style={{ flex: 1, backgroundColor: t.card }}>
      <View style={{ backgroundColor: t.primary, paddingTop: insets.top + 10, paddingBottom: 12, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center' }}>
        <Pressable onPress={step === 'name' ? () => setStep('pick') : onBack} hitSlop={10} style={{ paddingRight: 12 }}>
          <Text style={{ color: '#fff', fontSize: 28, lineHeight: 30 }}>{'‹'}</Text>
        </Pressable>
        <Text style={{ color: '#fff', fontSize: 18, fontWeight: '600', flex: 1 }}>{title}</Text>
        {mode === 'group' && step === 'pick' && picked.length > 0 && (
          <Pressable onPress={() => setStep('name')} hitSlop={10}><Text style={{ color: '#fff', fontWeight: '700' }}>NEXT</Text></Pressable>
        )}
        {mode === 'add' && picked.length > 0 && (
          <Pressable onPress={add} hitSlop={10}><Text style={{ color: '#fff', fontWeight: '700' }}>{busy ? '...' : 'ADD (' + picked.length + ')'}</Text></Pressable>
        )}
      </View>
      {step === 'name' ? (
        <View style={{ padding: 16 }}>
          <Text style={{ color: t.subtext, marginBottom: 8 }}>{picked.length} members selected</Text>
          <TextInput
            value={name} onChangeText={setName} placeholder="Group name" placeholderTextColor={t.subtext} maxLength={100}
            style={{ color: t.text, borderBottomWidth: 2, borderBottomColor: t.accent, fontSize: 18, paddingVertical: 6 }}
          />
          <Pressable
            onPress={create}
            style={{ marginTop: 24, backgroundColor: t.accent, borderRadius: 8, padding: 12, alignItems: 'center', opacity: name.trim() && !busy ? 1 : 0.5 }}
          >
            <Text style={{ color: '#fff', fontWeight: '700' }}>CREATE GROUP</Text>
          </Pressable>
        </View>
      ) : (
        <>
          <TextInput
            value={q} onChangeText={setQ} placeholder="Search" placeholderTextColor={t.subtext}
            style={{ margin: 10, backgroundColor: t.background, color: t.text, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8 }}
          />
          <FlatList
            keyboardShouldPersistTaps="handled"
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[t.accent]} />}
            initialNumToRender={16}
            windowSize={9}
            ListEmptyComponent={
              loaded
                ? <Text style={{ color: t.subtext, textAlign: 'center', marginTop: 30 }}>No people found</Text>
                : <ActivityIndicator color={t.accent} style={{ marginTop: 30 }} />
            }
            data={shown}
            keyExtractor={(p) => String(p.id)}
            renderItem={({ item }) => {
              const on = picked.includes(item.id);
              return (
                <Pressable
                  onPress={() => mode === 'dm' ? startDm(item) : setPicked((c) => (on ? c.filter((i) => i !== item.id) : [...c, item.id]))}
                  style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 8 }}
                >
                  <Avatar name={item.name} id={item.id} userId={item.id} emoji={item.avatarEmoji} size={42} />
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text style={{ color: t.text, fontSize: 16 }}>{item.name}</Text>
                    <Text style={{ color: t.subtext, fontSize: 13 }}>{item.phone}</Text>
                  </View>
                  {mode !== 'dm' && <Text style={{ color: t.accent, fontSize: 22 }}>{on ? '☑' : '☐'}</Text>}
                </Pressable>
              );
            }}
          />
        </>
      )}
    </View>
  );
}
