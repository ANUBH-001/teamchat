import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, Pressable, TextInput, Alert, ActivityIndicator, RefreshControl, LayoutAnimation, Platform, UIManager } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { api, ApiError } from '../api';
import { useAuth } from '../auth';
import { setPendingChat } from '../push';
import { useTheme } from '../useTheme';
import { usePublicSettings } from '../publicSettings';
import { useLiveRefresh, usePullRefresh } from '../useLive';
import { emitEvent } from '../realtime';
import { Assignee, DetailEvent, StepStatus, Task, canClose, colorOf, isAssignee, labelOf } from '../taskTypes';
import { describeEvent, ago, agoText, EVENT_ICON } from '../taskEvents';
import Avatar from '../components/Avatar';
// Round 4: disabled (simple create->done): import StatusChips from '../components/StatusChips';
import StatusChips from '../components/DoneChips';
import StatusPill from '../components/StatusPill';
import PeoplePickSheet from '../components/PeoplePickSheet';
import { copyText } from '../dates';
import Sheet, { SheetRow } from '../components/Sheet';


if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) UIManager.setLayoutAnimationEnabledExperimental(true);

export default function TaskDetailScreen({ taskId, onBack, onChanged }: { taskId: number; onBack: () => void; onChanged?: () => void }) {
  const t = useTheme();
  const { user } = useAuth();
  const ps = usePublicSettings();
  const insets = useSafeAreaInsets();
  const nav = useNavigation<any>();
  const me = user!;
  const [task, setTask] = useState<Task | null>(null);
  const [events, setEvents] = useState<DetailEvent[]>([]);
  const [err, setErr] = useState('');
  const [denied, setDenied] = useState(false);
  const [note, setNote] = useState('');
  const [sheet, setSheet] = useState<null | 'close' | 'people'>(null);
  const [person, setPerson] = useState<Assignee | null>(null);
  const [reason, setReason] = useState('');
  const [editTitle, setEditTitle] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api<{ task: Task; events: DetailEvent[] }>('GET', '/tasks/' + taskId);
      setTask(r.task); setEvents(r.events); setErr(''); setDenied(false);
    } catch (e: any) {
      if (e instanceof ApiError && (e.status === 403 || e.code === 'NOT_ALLOWED')) setDenied(true);
      else setErr(e.message);
    }
  }, [taskId]);
  useEffect(() => { load(); }, [load]);
  useLiveRefresh(load, ['task']);
  const { refreshing, onRefresh } = usePullRefresh(load);

  const isBoss = me.role === 'boss';
  const closed = task?.status === 'closed';
  const creator = !!task && task.createdBy === me.id;
  const mine = !!task && isAssignee(task, me);
  const manage = !!task && (isBoss || creator || mine) && !closed; // title / people (server re-checks)
  const bossOrCreator = !!task && (isBoss || creator); // may add notes
  const myRow = task ? (task.assignees || []).find((a) => a.id === me.id) : null;
  // Round 4: disabled (simple create->done): praise
  const canPraise = false;

  const patch = async (body: object) => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await api<{ task: Task }>('PATCH', '/tasks/' + taskId, body);
      if (r.task) setTask(r.task);
      await load();
      onChanged?.();
    } catch (e: any) { Alert.alert('Could not save', e.message); }
    setBusy(false);
  };
  const post = async (path: string, body: object = {}) => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await api<{ task?: Task }>('POST', '/tasks/' + taskId + path, body);
      if (r && r.task) setTask(r.task);
      await load();
      onChanged?.();
    } catch (e: any) { Alert.alert('Error', e.message); }
    setBusy(false);
  };
  const addNote = async () => {
    const n = note.trim();
    if (!n) return;
    setNote('');
    await patch({ note: n });
  };
  const praise = async () => {
    try { await api('POST', '/tasks/' + taskId + '/praise', {}); Alert.alert('Sent', '👏 Praise sent'); load(); }
    catch (e: any) { Alert.alert('Could not praise', e.message); }
  };
  const doClose = () => { setSheet(null); post('/close', reason.trim() ? { reason: reason.trim() } : {}); setReason(''); };
  const toggle = (id: number) => { LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); setOpen((o) => (o === id ? null : id)); };
  // same mechanism as a notification tap: switch to the Chats tab, then ask ChatsScreen to open the chat
  const openChat = (chatId: number, messageId: number | null = null) => {
    setPendingChat(chatId, messageId); // ChatsScreen takes it on mount if it was never opened
    try { nav.navigate('Chats'); } catch (e) {}
    setTimeout(() => emitEvent({ type: '_open_chat', chatId, messageId }), 350);
  };

  const card = { backgroundColor: t.card, borderRadius: 16, marginHorizontal: 16, marginTop: 16, padding: 16 } as const;
  const label = { color: t.subtext, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 } as const;
  const btn = (text: string, color: string, onPress: () => void, extra: object = {}) => (
    <Pressable onPress={onPress} style={{ flex: 1, minHeight: 48, borderRadius: 14, backgroundColor: t.card, borderWidth: 1, borderColor: color, alignItems: 'center', justifyContent: 'center', ...extra }}>
      <Text style={{ color, fontWeight: '700', fontSize: 15 }}>{text}</Text>
    </Pressable>
  );

  return (
    <View style={{ flex: 1, backgroundColor: t.background }}>
      <View style={{ backgroundColor: t.header, paddingTop: insets.top + 10, paddingBottom: 12, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center' }}>
        <Pressable onPress={onBack} hitSlop={10} style={{ paddingRight: 12 }}>
          <Text style={{ color: '#fff', fontSize: 28, lineHeight: 30 }}>{'‹'}</Text>
        </Pressable>
        <Text style={{ color: '#fff', fontSize: 18, fontWeight: '600', flex: 1 }}>Task #{taskId}</Text>
        {!!task && (
          <Pressable onPress={() => copyText('#' + task.id + ' ' + task.title)} hitSlop={10} style={{ padding: 4 }}>
            <Ionicons name="copy-outline" size={22} color="#fff" />
          </Pressable>
        )}
      </View>
      {denied ? (
        <View style={{ alignItems: 'center', padding: 32 }}>
          <Ionicons name="lock-closed-outline" size={44} color={t.subtext} />
          <Text style={{ color: t.text, fontSize: 16, marginTop: 12, textAlign: 'center' }}>You cannot view this task</Text>
        </View>
      ) : !task ? (
        err ? <Text style={{ color: t.danger, padding: 20 }}>{err}</Text> : <ActivityIndicator color={t.accent} style={{ marginTop: 40 }} />
      ) : (
        <ScrollView
          keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[t.accent]} />}
        >
          <View style={card}>
            {editTitle !== null ? (
              <TextInput
                value={editTitle} onChangeText={setEditTitle} autoFocus multiline
                onBlur={() => { const v = (editTitle || '').trim(); setEditTitle(null); if (v && v !== task.title) patch({ title: v }); }}
                style={{ color: t.text, fontSize: 18, fontWeight: '700', borderBottomWidth: 2, borderBottomColor: t.accent, paddingVertical: 4 }}
              />
            ) : (
              <Pressable disabled={!manage} onPress={() => setEditTitle(task.title)}>
                <Text style={{ color: t.text, fontSize: 18, fontWeight: '700', textDecorationLine: task.status === 'done' || closed ? 'line-through' : 'none' }}>{task.title}</Text>
              </Pressable>
            )}
            <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', marginTop: 10 }}>
              {!!task.project && (
                <View style={{ backgroundColor: t.soft, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 4, marginRight: 8 }}>
                  <Text style={{ color: t.subtext, fontSize: 12, fontWeight: '600' }}>{task.project}</Text>
                </View>
              )}
              <View style={{ backgroundColor: colorOf(task.status), borderRadius: 10, paddingHorizontal: 10, paddingVertical: 4 }}>
                <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>{closed ? 'Closed' : labelOf(task.status)}</Text>
              </View>
            </View>
            {closed && (
              <Text style={{ color: t.subtext, fontSize: 12, marginTop: 8 }}>
                Closed{task.closedAt ? ' · ' + agoText(task.closedAt) : ''}. Reopen it first to change the status or the people.
              </Text>
            )}
            {!!task.description && <Text style={{ color: t.subtext, fontSize: 14, marginTop: 10 }}>{task.description}</Text>}
          </View>

          <View style={card}>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
              <Text style={{ ...label, marginBottom: 0, flex: 1 }}>People ({(task.assignees || []).length})</Text>
              {manage && (
                <Pressable onPress={() => setSheet('people')} hitSlop={8}>
                  <Text style={{ color: t.accent, fontWeight: '700', fontSize: 13 }}>Change</Text>
                </Pressable>
              )}
            </View>
            {(task.assignees || []).map((a, i) => (
              <Pressable
                key={a.id} disabled={!isBoss || !!closed} onPress={() => setPerson(a)}
                style={{ flexDirection: 'row', alignItems: 'center', minHeight: 56, borderTopWidth: i ? 1 : 0, borderTopColor: t.border }}
              >
                <Avatar name={a.name} id={a.id} userId={a.id} emoji={a.avatarEmoji} size={36} />
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text numberOfLines={1} style={{ color: t.text, fontSize: 15 }}>{a.id === me.id ? a.name + ' (Me)' : a.name}</Text>
                  {!!(a.completedAt || a.updatedAt) && <Text style={{ color: t.subtext, fontSize: 11 }}>last change {agoText((a.completedAt || a.updatedAt)!)}</Text>}
                </View>
                <StatusPill status={a.status} />
                {isBoss && !closed && <Ionicons name="chevron-forward" size={18} color={t.subtext} style={{ marginLeft: 6 }} />}
              </Pressable>
            ))}
            {!(task.assignees || []).length && <Text style={{ color: t.subtext }}>{task.assigneeName || 'Unassigned'}</Text>}
            {mine && !closed && !!myRow && (
              <View style={{ marginTop: 12 }}>
                <Text style={label}>My status</Text>
                <StatusChips value={myRow.status} disabled={busy} wrap onPick={(s: StepStatus) => patch({ status: s })} />
              </View>
            )}
          </View>

          <View style={{ ...card, padding: 0 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 52, paddingHorizontal: 16 }}>
              <Ionicons name="create-outline" size={24} color={t.subtext} style={{ width: 36, textAlign: 'center' }} />
              <Text style={{ color: t.subtext, fontSize: 14, marginLeft: 12 }}>Created by {task.createdByName || 'someone'} · {agoText(task.createdAt)}</Text>
            </View>
          </View>

          {!closed && (mine || bossOrCreator) && (
            <View style={card}>
              <Text style={label}>Add note</Text>
              <View style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
                <TextInput
                  value={note} onChangeText={setNote} multiline placeholder="Progress update..." placeholderTextColor={t.subtext}
                  style={{ flex: 1, minHeight: 44, maxHeight: 120, backgroundColor: t.soft, color: t.text, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 8, fontSize: 15 }}
                />
                <Pressable onPress={addNote} style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: t.accent, alignItems: 'center', justifyContent: 'center', marginLeft: 8, opacity: note.trim() ? 1 : 0.5 }}>
                  <Ionicons name="send" size={18} color="#fff" />
                </Pressable>
              </View>
            </View>
          )}

          <View style={{ flexDirection: 'row', marginHorizontal: 16, marginTop: 16 }}>
            {canPraise && !closed && btn('👏 Praise', t.accent, praise, { marginRight: 8 })}
            {btn('Copy', t.subtext, () => copyText('#' + task.id + ' ' + task.title), { marginRight: canClose(task, me) ? 8 : 0 })}
            {canClose(task, me) && !closed && btn('Close', t.danger, () => setSheet('close'))}
            {canClose(task, me) && closed && btn('Reopen', t.accent, () => post('/reopen'))}
          </View>

          <View style={card}>
            <Text style={label}>Timeline</Text>
            {!events.length && <Text style={{ color: t.subtext }}>No activity yet.</Text>}
            {events.map((e, i) => {
              const src = e.source;
              const isOpen = open === e.id;
              return (
                <View key={e.id} style={{ flexDirection: 'row', paddingBottom: i === events.length - 1 ? 0 : 14 }}>
                  <View style={{ alignItems: 'center', width: 28 }}>
                    <Ionicons name={(EVENT_ICON[e.event] || 'ellipse') as any} size={18} color={t.accent} />
                    {i < events.length - 1 && <View style={{ flex: 1, width: 2, backgroundColor: t.border, marginTop: 4 }} />}
                  </View>
                  <View style={{ flex: 1, marginLeft: 8 }}>
                    <Pressable disabled={!src} onPress={() => toggle(e.id)} style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <Text style={{ color: t.text, fontSize: 14, flex: 1 }}>{describeEvent(e, e.actorName || 'Someone')}</Text>
                      {!!src && <Ionicons name={isOpen ? 'chevron-up' : 'chevron-down'} size={18} color={t.subtext} />}
                    </Pressable>
                    {e.event === 'note' && !!e.newValue && (
                      <Text style={{ color: t.text, fontSize: 14, fontStyle: 'italic', marginTop: 2 }}>{'"' + e.newValue + '"'}</Text>
                    )}
                    <Text style={{ color: t.subtext, fontSize: 12, marginTop: 1 }}>{new Date(e.createdAt).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</Text>
                    {!!src && isOpen && (
                      <View style={{ backgroundColor: t.soft, borderRadius: 12, padding: 10, marginTop: 8, borderLeftWidth: 3, borderLeftColor: t.accent }}>
                        <Text style={{ color: t.accent, fontSize: 12, fontWeight: '700' }}>
                          {src.senderName || 'Someone'}{src.chatName ? ' · ' + src.chatName : ''}
                        </Text>
                        {!!src.replyTo && (
                          <View style={{ borderLeftWidth: 2, borderLeftColor: t.border, paddingLeft: 8, marginTop: 6 }}>
                            <Text style={{ color: t.subtext, fontSize: 12, fontWeight: '600' }}>{src.replyTo.senderName}</Text>
                            <Text numberOfLines={3} style={{ color: t.subtext, fontSize: 12 }}>{src.replyTo.text || 'Message is no longer available'}</Text>
                          </View>
                        )}
                        <Text style={{ color: src.text && src.available !== false ? t.text : t.subtext, fontSize: 14, marginTop: 6, fontStyle: src.text && src.available !== false ? 'normal' : 'italic' }}>
                          {src.text && src.available !== false ? src.text : 'Message is no longer available'}
                        </Text>
                        {!!src.chatId && (
                          <Pressable onPress={() => openChat(src.chatId!, src.available ? src.messageId : null)} style={{ alignSelf: 'flex-start', minHeight: 36, justifyContent: 'center', paddingHorizontal: 14, borderRadius: 18, borderWidth: 1, borderColor: t.accent, marginTop: 10 }}>
                            <Text style={{ color: t.accent, fontWeight: '600', fontSize: 13 }}>View in chat</Text>
                          </Pressable>
                        )}
                      </View>
                    )}
                  </View>
                </View>
              );
            })}
          </View>
        </ScrollView>
      )}

      {task && (
        <PeoplePickSheet
          visible={sheet === 'people'} onClose={() => setSheet(null)} title="Assign to" meId={me.id}
          initial={(task.assignees || []).map((a) => a.id)}
          onSave={(ids) => { setSheet(null); patch({ assigneeIds: ids }); }}
        />
      )}
      <Sheet visible={!!person} onClose={() => setPerson(null)} title={person ? person.name + "'s status" : ''}>
        <View style={{ paddingHorizontal: 16, paddingBottom: 16 }}>
          {person && <StatusChips value={person.status} wrap onPick={(s: StepStatus) => { const uid = person.id; setPerson(null); patch({ status: s, userId: uid }); }} />}
        </View>
      </Sheet>
      <Sheet visible={sheet === 'close'} onClose={() => setSheet(null)} title="Close this task?">
        <View style={{ paddingHorizontal: 16, paddingBottom: 16 }}>
          <TextInput
            value={reason} onChangeText={setReason} placeholder="Reason (optional)" placeholderTextColor={t.subtext} maxLength={300}
            style={{ minHeight: 46, backgroundColor: t.soft, color: t.text, borderRadius: 12, paddingHorizontal: 12, fontSize: 15 }}
          />
          <Pressable onPress={doClose} style={{ minHeight: 48, borderRadius: 24, backgroundColor: t.danger, alignItems: 'center', justifyContent: 'center', marginTop: 12 }}>
            <Text style={{ color: '#fff', fontWeight: '700' }}>Close task</Text>
          </Pressable>
        </View>
      </Sheet>
    </View>
  );
}
