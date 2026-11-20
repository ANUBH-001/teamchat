import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, Pressable, Switch, TextInput, Alert, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../api';
import { useAuth } from '../auth';
import { useTheme } from '../useTheme';
import { Chat, Msg } from '../chatTypes';
import { MediaGridModal, MediaPreview } from '../components/MediaGrid';
import { Theme } from '../theme';
import { useLiveRefresh } from '../useLive';
import Avatar from '../components/Avatar';
import TaskActionSheet from '../components/TaskActionSheet';
import { AnyTask, isBrief, labelOf, colorOf, assigneeNamesOf } from '../taskTypes';
import { useUser } from '../userStore';
import NewChatScreen from './NewChatScreen';

type Member = { id: number; name: string; role: 'boss' | 'member'; isCreator: boolean; phone?: string; avatarEmoji?: string | null };
type ChatSettings = { botEnabled: boolean; aiDetect: boolean; notifyAdmin: boolean };

const Badge = ({ label, t }: { label: string; t: Theme }) => (
  <Text style={{ color: t.accent, fontSize: 11, fontWeight: '700', borderWidth: 1, borderColor: t.accent, borderRadius: 8, paddingHorizontal: 6, marginLeft: 8, overflow: 'hidden' }}>{label}</Text>
);

function SwitchRow({ label, sub, value, onChange, t }: { label: string; sub?: string; value: boolean; onChange: (v: boolean) => void; t: Theme }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 56, paddingHorizontal: 16 }}>
      <View style={{ flex: 1, paddingRight: 12 }}>
        <Text style={{ color: t.text, fontSize: 15 }}>{label}</Text>
        {!!sub && <Text style={{ color: t.subtext, fontSize: 12, marginTop: 1 }}>{sub}</Text>}
      </View>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: t.accent, false: t.border }} thumbColor="#fff" />
    </View>
  );
}

// Chat info for every chat type (group, all, dm): members, tasks of this chat, mute / pin, add / remove, leave; admin also sees per-group bot settings.
export default function GroupInfoScreen({ chat, onBack, onChanged, onLeft, onOpenChat, onOpenTask }: {
  chat: Chat; onBack: () => void; onChanged: () => void; onLeft: () => void; onOpenChat: (c: Chat) => void; onOpenTask?: (id: number) => void;
}) {
  const t = useTheme();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const me = user!;
  const isBoss = me.role === 'boss';
  const isGroup = chat.type === 'group';
  const isDm = chat.type === 'dm';
  const [members, setMembers] = useState<Member[]>([]);
  const [name, setName] = useState(chat.name);
  const [editing, setEditing] = useState(false);
  const [muted, setMuted] = useState(!!chat.muted);
  const [cs, setCs] = useState<ChatSettings | null>(null);
  const [adding, setAdding] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [tasks, setTasks] = useState<AnyTask[]>([]);
  const [pinned, setPinned] = useState(!!chat.pinned);
  const [sel, setSel] = useState<number | null>(null);
  // Round 4: Media section = photos among the latest 100 messages of this chat
  const [media, setMedia] = useState<Msg[]>([]);
  const [mediaAll, setMediaAll] = useState(false);
  useEffect(() => {
    api<{ messages: Msg[] }>('GET', '/chats/' + chat.id + '/messages?limit=100').then((r) => setMedia(r.messages)).catch(() => {});
  }, [chat.id]);

  const load = useCallback(async () => {
    try {
      const r = await api<{ chat: Chat; members: Member[]; tasks?: AnyTask[] }>('GET', '/chats/' + chat.id);
      setMembers(r.members);
      setTasks(r.tasks || []);
      if (r.chat) { setName((n) => (editing ? n : r.chat.name)); if (r.chat.muted !== undefined) setMuted(!!r.chat.muted); if (r.chat.pinned !== undefined) setPinned(!!r.chat.pinned); }
    } catch (e) {}
    setLoaded(true);
  }, [chat.id, editing]);
  useEffect(() => { load(); }, [load]);
  useLiveRefresh(load, ['chat']);
  useEffect(() => {
    if (!isBoss) return;
    api<{ settings: ChatSettings }>('GET', '/admin/chats/' + chat.id + '/settings').then((r) => setCs(r.settings)).catch(() => {});
  }, [chat.id, isBoss]);

  const rank = (m: Member) => (m.id === me.id ? 0 : m.isCreator || m.role === 'boss' ? 1 : 2);
  const sortedMembers = [...members].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  const canManage = isGroup && (isBoss || members.some((m) => m.id === me.id && m.isCreator) || chat.createdBy === me.id);
  const fail = (e: any) => Alert.alert('Error', e.message);

  const saveName = async () => {
    const n = name.trim();
    setEditing(false);
    if (!n || n === chat.name) { setName(chat.name); return; }
    try { await api('PATCH', '/chats/' + chat.id, { name: n }); onChanged(); } catch (e) { setName(chat.name); fail(e); }
  };
  const toggleMute = async (v: boolean) => {
    setMuted(v);
    try { await api('PATCH', '/chats/' + chat.id + '/me', { muted: v }); onChanged(); } catch (e) { setMuted(!v); fail(e); }
  };
  const togglePin = async (v: boolean) => {
    setPinned(v);
    try { await api('PATCH', '/chats/' + chat.id + '/me', { pinned: v }); onChanged(); } catch (e) { setPinned(!v); fail(e); }
  };
  const setSetting = async (k: keyof ChatSettings, v: boolean) => {
    if (!cs) return;
    const old = cs;
    setCs({ ...cs, [k]: v });
    try { setCs((await api<{ settings: ChatSettings }>('PUT', '/admin/chats/' + chat.id + '/settings', { [k]: v })).settings); }
    catch (e) { setCs(old); fail(e); }
  };
  const remove = (m: Member) => Alert.alert('Remove member', 'Remove ' + m.name + ' from this group?', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Remove', style: 'destructive', onPress: async () => {
      try { await api('DELETE', '/chats/' + chat.id + '/members/' + m.id); load(); onChanged(); } catch (e) { fail(e); }
    } },
  ]);
  const leave = () => Alert.alert('Leave group', 'Leave "' + chat.name + '"?', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Leave', style: 'destructive', onPress: async () => {
      try { await api('DELETE', '/chats/' + chat.id + '/members/' + me.id); onLeft(); } catch (e) { fail(e); }
    } },
  ]);
  const dm = async (m: Member) => {
    if (m.id === me.id) return;
    try { onOpenChat((await api<{ chat: Chat }>('POST', '/chats/dm', { userId: m.id })).chat); } catch (e) { fail(e); }
  };

  const creator = members.find((m) => m.isCreator);
  const otherId = isDm ? (members.find((m) => m.id !== me.id)?.id ?? chat.otherUserId) : null;
  const other = isDm ? members.find((m) => m.id === otherId) : undefined;
  const otherLive = useUser(otherId);
  const title = isDm ? (otherLive?.name || other?.name || chat.name) : name;

  if (adding) {
    return (
      <NewChatScreen
        mode="add" exclude={members.map((m) => m.id)} onBack={() => setAdding(false)} onOpen={() => {}}
        onAdd={async (ids) => { await api('POST', '/chats/' + chat.id + '/members', { userIds: ids }); setAdding(false); load(); onChanged(); }}
      />
    );
  }

  const card = { backgroundColor: t.card, borderRadius: 16, marginHorizontal: 16, marginTop: 16, overflow: 'hidden' } as const;
  const label = { color: t.subtext, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginHorizontal: 32, marginTop: 20 } as const;
  const line = <View style={{ height: 1, backgroundColor: t.border, marginLeft: 16 }} />;

  return (
    <View style={{ flex: 1, backgroundColor: t.background }}>
      <View style={{ backgroundColor: t.header, paddingTop: insets.top + 10, paddingBottom: 12, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center' }}>
        <Pressable onPress={onBack} hitSlop={10} style={{ paddingRight: 12 }}>
          <Text style={{ color: '#fff', fontSize: 28, lineHeight: 30 }}>{'‹'}</Text>
        </Pressable>
        <Text style={{ color: '#fff', fontSize: 18, fontWeight: '600', flex: 1 }}>{isGroup ? 'Group info' : isDm ? 'Contact info' : 'Chat info'}</Text>
      </View>
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 32 }} keyboardShouldPersistTaps="handled">
        <View style={{ alignItems: 'center', paddingTop: 24 }}>
          {isDm && otherId
            ? <Avatar name={title} id={otherId} userId={otherId} emoji={other?.avatarEmoji || chat.otherUserEmoji} size={88} />
            : <Avatar name={chat.name} id={chat.id} size={88} />}
          {editing ? (
            <TextInput
              value={name} onChangeText={setName} autoFocus maxLength={100} onSubmitEditing={saveName} onBlur={saveName} returnKeyType="done"
              style={{ color: t.text, fontSize: 20, fontWeight: '700', marginTop: 12, minWidth: 200, textAlign: 'center', borderBottomWidth: 2, borderBottomColor: t.accent, paddingVertical: 4 }}
            />
          ) : (
            <Pressable disabled={!canManage} onPress={() => setEditing(true)} style={{ flexDirection: 'row', alignItems: 'center', marginTop: 12, minHeight: 44 }}>
              <Text style={{ color: t.text, fontSize: 20, fontWeight: '700' }}>{title}</Text>
              {canManage && <Ionicons name="pencil" size={16} color={t.subtext} style={{ marginLeft: 8 }} />}
            </Pressable>
          )}
          {isDm ? (
            <>
              {!!other?.phone && <Text style={{ color: t.subtext, fontSize: 14 }}>{other.phone}</Text>}
              {!!other && <Text style={{ color: t.subtext, fontSize: 13 }}>{other.role === 'boss' ? 'Admin' : 'Member'}</Text>}
            </>
          ) : (
            <>
              <Text style={{ color: t.subtext, fontSize: 13 }}>{isGroup ? 'Group' : 'Everyone'} · {members.length || chat.membersCount} members</Text>
              {!!creator && <Text style={{ color: t.subtext, fontSize: 12, marginTop: 2 }}>Created by {creator.name}</Text>}
            </>
          )}
        </View>

        <View style={card}>
          <SwitchRow label="Mute notifications" sub="@mentions still notify you" value={muted} onChange={toggleMute} t={t} />
          {line}
          <SwitchRow label="Pin chat" sub="Keep at the top of the chat list" value={pinned} onChange={togglePin} t={t} />
        </View>

        {isBoss && (
          <>
            <Text style={label}>Admin: task bot in this chat</Text>
            <View style={card}>
              {!cs ? <ActivityIndicator color={t.accent} style={{ margin: 16 }} /> : (
                <>
                  <SwitchRow label="Task bot / commands" sub="Allow /task, /done ... here" value={cs.botEnabled} onChange={(v) => setSetting('botEnabled', v)} t={t} />
                  {line}
                  <SwitchRow label="AI task detection" sub="Detect tasks in normal messages" value={cs.aiDetect} onChange={(v) => setSetting('aiDetect', v)} t={t} />
                  {line}
                  <SwitchRow label="Notify admin" sub="Quiet alerts for task updates here" value={cs.notifyAdmin} onChange={(v) => setSetting('notifyAdmin', v)} t={t} />
                </>
              )}
            </View>
          </>
        )}

        <MediaPreview msgs={media} onSeeAll={() => setMediaAll(true)} />
        <MediaGridModal visible={mediaAll} onClose={() => setMediaAll(false)} msgs={media} />

        <Text style={label}>{isDm ? 'Shared tasks' : 'Tasks in this chat'}</Text>
        <View style={card}>
          {!loaded && <ActivityIndicator color={t.accent} style={{ margin: 16 }} />}
          {loaded && tasks.length === 0 && <Text style={{ color: t.subtext, padding: 16 }}>No open tasks</Text>}
          {tasks.map((k, i) => {
            const names = assigneeNamesOf(k).join(', ');
            return (
              <View key={k.id}>
                {i > 0 && line}
                <Pressable disabled={isBrief(k)} onPress={() => setSel(k.id)} style={{ paddingHorizontal: 16, paddingVertical: 10, minHeight: 56, justifyContent: 'center' }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Text numberOfLines={2} style={{ color: t.text, fontSize: 15, flex: 1 }}>#{k.id} {k.title}</Text>
                    <Text style={{ color: '#fff', backgroundColor: colorOf(k.status), fontSize: 11, fontWeight: '700', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2, marginLeft: 8, overflow: 'hidden' }}>{labelOf(k.status)}</Text>
                  </View>
                  {!!names && <Text numberOfLines={1} style={{ color: t.subtext, fontSize: 12, marginTop: 2 }}>{names}</Text>}
                </Pressable>
              </View>
            );
          })}
        </View>

        {!isDm && <Text style={label}>Members</Text>}
        {!isDm && <View style={card}>
          {canManage && (
            <>
              <Pressable onPress={() => setAdding(true)} style={{ flexDirection: 'row', alignItems: 'center', minHeight: 56, paddingHorizontal: 16 }}>
                <View style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: t.accent, alignItems: 'center', justifyContent: 'center' }}>
                  <Ionicons name="person-add" size={20} color="#fff" />
                </View>
                <Text style={{ color: t.accent, fontSize: 16, fontWeight: '600', marginLeft: 12 }}>Add members</Text>
              </Pressable>
              {line}
            </>
          )}
          {!loaded && <ActivityIndicator color={t.accent} style={{ margin: 16 }} />}
          {sortedMembers.map((m, i) => (
            <View key={m.id}>
              {i > 0 && line}
              <Pressable onPress={() => dm(m)} style={{ flexDirection: 'row', alignItems: 'center', minHeight: 60, paddingHorizontal: 16 }}>
                <Avatar name={m.name} id={m.id} userId={m.id} emoji={m.avatarEmoji} size={42} />
                <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', marginLeft: 12 }}>
                  <Text numberOfLines={1} style={{ color: t.text, fontSize: 16, flexShrink: 1 }}>{m.name}{m.id === me.id ? ' (You)' : ''}</Text>
                  {m.role === 'boss' && <Badge label="Admin" t={t} />}
                  {m.isCreator && <Badge label="Creator" t={t} />}
                </View>
                {canManage && m.id !== me.id && !m.isCreator && (
                  <Pressable onPress={() => remove(m)} hitSlop={8} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
                    <Ionicons name="close-circle-outline" size={24} color={t.danger} />
                  </Pressable>
                )}
              </Pressable>
            </View>
          ))}
        </View>}

        {isGroup && (
          <Pressable onPress={leave} style={{ ...card, flexDirection: 'row', alignItems: 'center', minHeight: 56, paddingHorizontal: 16 }}>
            <Ionicons name="exit-outline" size={22} color={t.danger} />
            <Text style={{ color: t.danger, fontSize: 16, fontWeight: '600', marginLeft: 12 }}>Leave group</Text>
          </Pressable>
        )}
      </ScrollView>
      <TaskActionSheet
        visible={sel != null} onClose={() => setSel(null)} taskId={sel}
        onOpen={onOpenTask ? (id) => { setSel(null); onOpenTask(id); } : undefined} onChanged={() => load()}
      />
    </View>
  );
}
