import React, { useEffect, useState } from 'react';
import { Alert, Pressable, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useTheme } from '../useTheme';
import { useAuth } from '../auth';
import { api } from '../api';
import { Task, isPrivate, simpleStatus } from '../taskTypes';
import { useUsers } from '../userStore';
import { setPendingChat } from '../push';
import { emitEvent } from '../realtime';
import { toast } from '../useVoiceInput';
import { dateTimeOf } from '../taskFormat';
import Avatar from './Avatar';
import Sheet from './Sheet';

type Mode = 'main' | 'title' | 'reassign' | 'from';

// Round 4 task detail (bottom sheet): Task N, title, people with their own tick, created / done info,
// "View in chat"; the admin can reassign, edit the title and close. All through REST (server re-checks).
export default function TaskSheet({ task: given, onClose, onTick, onChanged }: {
  task: Task | null; onClose: () => void; onTick: (task: Task, userId: number, done: boolean) => void; onChanged: (task: Task) => void;
}) {
  const t = useTheme();
  const { user } = useAuth();
  const me = user!;
  const isBoss = me.role === 'boss';
  const nav = useNavigation();
  const users = useUsers();
  const [mode, setMode] = useState<Mode>('main');
  const [text, setText] = useState('');
  const [from, setFrom] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setMode('main'); setFrom(null); }, [given && given.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const task = given;
  if (!task) return null;
  const people = task.assignees || [];

  const run = async (method: string, path: string, body: object | undefined, ok?: string) => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await api<{ task: Task }>(method, path, body);
      if (r && r.task) onChanged(r.task);
      if (ok) toast(ok);
      setMode('main'); setFrom(null);
    } catch (e: any) { toast(e.message || 'Could not do that'); }
    setBusy(false);
  };
  const patch = (body: object, ok?: string) => run('PATCH', '/tasks/' + task.id, body, ok);
  const reassignTo = (to: number) => {
    const cur = people.map((p) => p.id);
    const next = from == null ? [to] : Array.from(new Set(cur.map((i) => (i === from ? to : i))));
    patch({ assigneeIds: next }, 'Reassigned');
  };
  const openChat = () => {
    if (!task.chatId) return;
    const chatId = task.chatId, messageId = task.sourceMessageId;
    onClose();
    setPendingChat(chatId, messageId);
    try { nav.navigate('Chats' as never); } catch (e) {}
    setTimeout(() => emitEvent({ type: '_open_chat', chatId, messageId }), 350);
  };
  const label = { color: t.subtext, fontSize: 11, fontWeight: '700', marginTop: 14, marginBottom: 6 } as const;
  const info = (txt: string) => <Text style={{ color: t.subtext, fontSize: 13, marginTop: 4 }}>{txt}</Text>;
  const btn = (txt: string, onPress: () => void, primary?: boolean, danger?: boolean) => (
    <Pressable onPress={onPress} style={{ flex: 1, minHeight: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', marginRight: 8, backgroundColor: primary ? t.accent : t.surface }}>
      <Text style={{ color: primary ? t.onAccent : danger ? t.danger : t.text, fontWeight: '700' }}>{txt}</Text>
    </Pressable>
  );

  let body: React.ReactNode;
  if (mode === 'title') {
    body = (
      <View>
        <TextInput value={text} onChangeText={setText} autoFocus multiline placeholderTextColor={t.subtext}
          style={{ minHeight: 46, backgroundColor: t.surface, color: t.text, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, fontSize: 15 }} />
        <View style={{ flexDirection: 'row', marginTop: 10 }}>
          {btn('Back', () => setMode('main'))}
          {btn(busy ? '...' : 'Save', () => text.trim() && patch({ title: text.trim() }, 'Saved'), true)}
        </View>
      </View>
    );
  } else if (mode === 'from') {
    // Round 4: multi-person task: first pick whose part moves (the others stay), then the new person
    body = (
      <View>
        <Text style={{ color: t.subtext, fontSize: 13, marginBottom: 6 }}>Whose place?</Text>
        {people.map((p) => (
          <Pressable key={p.id} onPress={() => { setFrom(p.id); setMode('reassign'); }} android_ripple={{ color: t.border }} style={{ flexDirection: 'row', alignItems: 'center', minHeight: 50 }}>
            <Avatar name={p.name} id={p.id} userId={p.id} size={32} />
            <Text style={{ flex: 1, color: t.text, fontSize: 15, marginLeft: 12 }}>{p.id === me.id ? p.name + ' (Me)' : p.name}</Text>
          </Pressable>
        ))}
        <View style={{ flexDirection: 'row', marginTop: 6 }}>{btn('Back', () => { setMode('main'); setFrom(null); })}</View>
      </View>
    );
  } else if (mode === 'reassign') {
    body = (
      <View>
        <Text style={{ color: t.subtext, fontSize: 13, marginBottom: 6 }}>Who should get it?</Text>
        {users.map((u) => (
          <Pressable key={u.id} onPress={() => reassignTo(u.id)} android_ripple={{ color: t.border }} style={{ flexDirection: 'row', alignItems: 'center', minHeight: 50 }}>
            <Avatar name={u.name} id={u.id} userId={u.id} size={32} />
            <Text style={{ flex: 1, color: t.text, fontSize: 15, marginLeft: 12 }}>{u.id === me.id ? 'Me' : u.name}</Text>
          </Pressable>
        ))}
        <View style={{ flexDirection: 'row', marginTop: 6 }}>{btn('Back', () => { setMode('main'); setFrom(null); })}</View>
      </View>
    );
  } else {
    body = (
      <View>
        <Text style={{ color: t.text, fontSize: 18, fontWeight: '700', marginTop: 2 }}>{task.title}{isPrivate(task) ? ' 🔒' : ''}</Text>
        {!!task.description && <Text style={{ color: t.subtext, fontSize: 14, marginTop: 6 }}>{task.description}</Text>}
        <Text style={label}>PEOPLE</Text>
        {people.map((p) => {
          const done = p.status === 'done';
          const can = isBoss || p.id === me.id;
          return (
            <View key={p.id} style={{ flexDirection: 'row', alignItems: 'center', minHeight: 48 }}>
              <Pressable disabled={!can || task.status === 'closed'} onPress={() => onTick(task, p.id, !done)} hitSlop={8} style={{ marginRight: 10, opacity: can ? 1 : 0.45 }}>
                <Ionicons name={done ? 'checkbox' : 'square-outline'} size={24} color={done ? t.accent : t.subtext} />
              </Pressable>
              <Avatar name={p.name} id={p.id} userId={p.id} size={28} />
              <View style={{ flex: 1, marginLeft: 10 }}>
                <Text style={{ color: t.text, fontSize: 15 }}>{p.id === me.id ? p.name + ' (Me)' : p.name}</Text>
                {done && !!p.completedAt && <Text style={{ color: t.subtext, fontSize: 11 }}>Done {dateTimeOf(p.completedAt)}</Text>}
              </View>
              {isBoss && task.status !== 'closed' && !done && (
                <Pressable onPress={() => { setFrom(p.id); setMode('reassign'); }} hitSlop={8} style={{ padding: 6 }}>
                  <Ionicons name="swap-horizontal" size={20} color={t.accent} />
                </Pressable>
              )}
            </View>
          );
        })}
        {info('Created by ' + (task.createdByName || 'someone') + ' · ' + dateTimeOf(task.createdAt))}
        {simpleStatus(task.status) === 'done' && !!task.completedAt && info('Done ' + dateTimeOf(task.completedAt))}
        {task.status === 'closed' && info('Closed')}
        {!!task.chatId && !!task.sourceMessageId && (
          <Pressable onPress={openChat} style={{ flexDirection: 'row', alignItems: 'center', minHeight: 44, marginTop: 10 }}>
            <Ionicons name="chatbubble-ellipses-outline" size={20} color={t.accent} />
            <Text style={{ color: t.accent, fontWeight: '700', fontSize: 15, marginLeft: 10 }}>View in chat</Text>
          </Pressable>
        )}
        {isBoss && task.status !== 'closed' && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 14 }}>
            {people.length > 1 && simpleStatus(task.status) !== 'done' && (
              <Pressable onPress={() => patch({ status: 'done' }, 'Done for everyone')} style={{ minHeight: 40, justifyContent: 'center', paddingHorizontal: 14, borderRadius: 20, backgroundColor: t.accent, marginRight: 8, marginBottom: 8 }}>
                <Text style={{ color: t.onAccent, fontWeight: '700' }}>Done for all</Text>
              </Pressable>
            )}
            {[
              ['Reassign', () => { if (people.length > 1) { setFrom(null); setMode('from'); } else { setFrom(people.length === 1 ? people[0].id : null); setMode('reassign'); } }],
              ['Edit title', () => { setText(task.title); setMode('title'); }],
              ['Close task', () => Alert.alert('Close task', 'Close Task ' + task.id + '?', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Close', style: 'destructive', onPress: () => run('POST', '/tasks/' + task.id + '/close', {}, 'Closed') },
              ])],
            ].map(([l, fn]) => (
              <Pressable key={l as string} onPress={fn as () => void} style={{ minHeight: 40, justifyContent: 'center', paddingHorizontal: 14, borderRadius: 20, backgroundColor: t.surface, marginRight: 8, marginBottom: 8 }}>
                <Text style={{ color: l === 'Close task' ? t.danger : t.text, fontWeight: '600' }}>{l as string}</Text>
              </Pressable>
            ))}
          </View>
        )}
      </View>
    );
  }
  return (
    <Sheet visible onClose={onClose} title={'Task ' + task.id}>
      <View style={{ paddingHorizontal: 20, paddingBottom: 16 }}>{body}</View>
    </Sheet>
  );
}
