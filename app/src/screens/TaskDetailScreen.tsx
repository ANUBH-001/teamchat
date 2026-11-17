import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, Pressable, TextInput, Alert, ActivityIndicator, RefreshControl } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../api';
import { useAuth } from '../auth';
import { useTheme } from '../useTheme';
import { usePublicSettings } from '../publicSettings';
import { useLiveRefresh, usePullRefresh } from '../useLive';
import { OVERDUE_COLOR, STATUSES, STATUS_COLOR, STATUS_LABEL, Status, Task, TaskEvent } from '../taskTypes';
import { describeEvent, ago, EVENT_ICON } from '../taskEvents';
import { Person } from '../chatTypes';
import Avatar from '../components/Avatar';
import { formatDue } from '../dates';
import Sheet, { SheetRow } from '../components/Sheet';

export const isoDay = (offset: number) => {
  const d = new Date(Date.now() + offset * 86400000);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
};

export default function TaskDetailScreen({ taskId, onBack, onChanged }: { taskId: number; onBack: () => void; onChanged?: () => void }) {
  const t = useTheme();
  const { user } = useAuth();
  const ps = usePublicSettings();
  const insets = useSafeAreaInsets();
  const me = user!;
  const [task, setTask] = useState<Task | null>(null);
  const [events, setEvents] = useState<TaskEvent[]>([]);
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const [people, setPeople] = useState<Person[]>([]);
  const [sheet, setSheet] = useState<null | 'assignee' | 'due'>(null);
  const [dueText, setDueText] = useState('');
  const [editTitle, setEditTitle] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api<{ task: Task; events: TaskEvent[] }>('GET', '/tasks/' + taskId);
      setTask(r.task); setEvents(r.events); setErr('');
    } catch (e: any) { setErr(e.message); }
  }, [taskId]);
  useEffect(() => { load(); }, [load]);
  useLiveRefresh(load, ['task', 'task_deleted']);
  const { refreshing, onRefresh } = usePullRefresh(load);

  const isBoss = me.role === 'boss';
  const canManage = !!task && (isBoss || task.createdBy === me.id);
  const canStatus = !!task && (isBoss || task.assigneeId === me.id);
  const canPraise = !!task && ps.praiseEnabled && canManage && task.assigneeId !== me.id && (task.status === 'review' || task.status === 'done');

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
  const del = () => Alert.alert('Delete task', 'Delete "' + task?.title + '"?', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: async () => {
      try { await api('DELETE', '/tasks/' + taskId); onChanged?.(); onBack(); } catch (e: any) { Alert.alert('Error', e.message); }
    } },
  ]);
  const openSheet = async (k: 'assignee' | 'due') => {
    setSheet(k);
    if (k === 'due') setDueText(task?.dueDate ?? '');
    if (k === 'assignee' && !people.length) {
      try { setPeople((await api<{ users: Person[] }>('GET', '/users')).users); } catch (e) {}
    }
  };
  const saveDue = (v: string | null) => {
    if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) { Alert.alert('Date', 'Use YYYY-MM-DD'); return; }
    setSheet(null);
    patch({ dueDate: v });
  };

  const card = { backgroundColor: t.card, borderRadius: 16, marginHorizontal: 16, marginTop: 16, padding: 16 } as const;
  const label = { color: t.subtext, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 } as const;
  const overdue = !!task && task.overdue && task.status !== 'done';

  return (
    <View style={{ flex: 1, backgroundColor: t.background }}>
      <View style={{ backgroundColor: t.primary, paddingTop: insets.top + 10, paddingBottom: 12, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center' }}>
        <Pressable onPress={onBack} hitSlop={10} style={{ paddingRight: 12 }}>
          <Text style={{ color: '#fff', fontSize: 28, lineHeight: 30 }}>{'‹'}</Text>
        </Pressable>
        <Text style={{ color: '#fff', fontSize: 18, fontWeight: '600', flex: 1 }}>Task #{taskId}</Text>
      </View>
      {!task ? (
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
              <Pressable disabled={!canManage} onPress={() => setEditTitle(task.title)}>
                <Text style={{ color: t.text, fontSize: 18, fontWeight: '700', textDecorationLine: task.status === 'done' ? 'line-through' : 'none' }}>{task.title}</Text>
              </Pressable>
            )}
            <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', marginTop: 10 }}>
              {!!task.project && (
                <View style={{ backgroundColor: t.soft, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 4, marginRight: 8 }}>
                  <Text style={{ color: t.subtext, fontSize: 12, fontWeight: '600' }}>{task.project}</Text>
                </View>
              )}
              <View style={{ backgroundColor: STATUS_COLOR[task.status], borderRadius: 10, paddingHorizontal: 10, paddingVertical: 4 }}>
                <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>{STATUS_LABEL[task.status]}</Text>
              </View>
              {overdue && <Text style={{ color: OVERDUE_COLOR, fontSize: 12, fontWeight: '700', marginLeft: 8 }}>Overdue</Text>}
            </View>
            {!!task.description && <Text style={{ color: t.subtext, fontSize: 14, marginTop: 10 }}>{task.description}</Text>}
          </View>

          <View style={{ ...card, padding: 0 }}>
            <Pressable disabled={!canManage} onPress={() => openSheet('assignee')} style={{ flexDirection: 'row', alignItems: 'center', minHeight: 60, paddingHorizontal: 16 }}>
              {task.assigneeId ? <Avatar name={task.assigneeName || '?'} id={task.assigneeId} size={36} /> : <Ionicons name="person-outline" size={24} color={t.subtext} />}
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={{ color: t.subtext, fontSize: 12 }}>Assigned to</Text>
                <Text style={{ color: t.text, fontSize: 16 }}>{task.assigneeName || 'Unassigned'}</Text>
              </View>
              {canManage && <Ionicons name="chevron-forward" size={20} color={t.subtext} />}
            </Pressable>
            <View style={{ height: 1, backgroundColor: t.border, marginLeft: 16 }} />
            <Pressable disabled={!canManage} onPress={() => openSheet('due')} style={{ flexDirection: 'row', alignItems: 'center', minHeight: 60, paddingHorizontal: 16 }}>
              <Ionicons name="calendar-outline" size={24} color={overdue ? OVERDUE_COLOR : t.subtext} style={{ width: 36, textAlign: 'center' }} />
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={{ color: t.subtext, fontSize: 12 }}>Due date</Text>
                <Text style={{ color: overdue ? OVERDUE_COLOR : t.text, fontSize: 16 }}>{task.dueDate ? formatDue(task.dueDate) : 'No due date'}</Text>
              </View>
              {canManage && <Ionicons name="chevron-forward" size={20} color={t.subtext} />}
            </Pressable>
            <View style={{ height: 1, backgroundColor: t.border, marginLeft: 16 }} />
            <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 52, paddingHorizontal: 16 }}>
              <Ionicons name="create-outline" size={24} color={t.subtext} style={{ width: 36, textAlign: 'center' }} />
              <Text style={{ color: t.subtext, fontSize: 14, marginLeft: 12 }}>Created by {task.createdByName || 'someone'} · {ago(task.createdAt)} ago</Text>
            </View>
          </View>

          {canStatus && (
            <View style={card}>
              <Text style={label}>Status</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -4 }}>
                {STATUSES.map((s: Status) => {
                  const on = task.status === s;
                  return (
                    <Pressable
                      key={s} disabled={busy || on} onPress={() => patch({ status: s })}
                      style={{
                        width: '50%', padding: 4,
                      }}
                    >
                      <View style={{ minHeight: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? STATUS_COLOR[s] : t.soft, borderWidth: 1, borderColor: on ? STATUS_COLOR[s] : t.border }}>
                        <Text style={{ color: on ? '#fff' : t.text, fontWeight: '600' }}>{STATUS_LABEL[s]}</Text>
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          )}

          {(canStatus || canManage) && (
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

          {(canPraise || canManage) && (
            <View style={{ flexDirection: 'row', marginHorizontal: 16, marginTop: 16 }}>
              {canPraise && (
                <Pressable onPress={praise} style={{ flex: 1, minHeight: 48, borderRadius: 14, backgroundColor: t.card, borderWidth: 1, borderColor: t.accent, alignItems: 'center', justifyContent: 'center', marginRight: canManage ? 8 : 0 }}>
                  <Text style={{ color: t.accent, fontWeight: '700', fontSize: 15 }}>👏 Praise</Text>
                </Pressable>
              )}
              {canManage && (
                <Pressable onPress={del} style={{ flex: 1, minHeight: 48, borderRadius: 14, backgroundColor: t.card, borderWidth: 1, borderColor: t.danger, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ color: t.danger, fontWeight: '700', fontSize: 15 }}>Delete</Text>
                </Pressable>
              )}
            </View>
          )}

          <View style={card}>
            <Text style={label}>Timeline</Text>
            {!events.length && <Text style={{ color: t.subtext }}>No activity yet.</Text>}
            {events.map((e, i) => (
              <View key={e.id} style={{ flexDirection: 'row', paddingBottom: i === events.length - 1 ? 0 : 14 }}>
                <View style={{ alignItems: 'center', width: 28 }}>
                  <Ionicons name={(EVENT_ICON[e.event] || 'ellipse') as any} size={18} color={t.accent} />
                  {i < events.length - 1 && <View style={{ flex: 1, width: 2, backgroundColor: t.border, marginTop: 4 }} />}
                </View>
                <View style={{ flex: 1, marginLeft: 8 }}>
                  <Text style={{ color: t.text, fontSize: 14 }}>{describeEvent(e, e.actorName || 'Someone')}</Text>
                  {e.event === 'note' && !!e.newValue && (
                    <Text style={{ color: t.text, fontSize: 14, fontStyle: 'italic', marginTop: 2 }}>{'"' + e.newValue + '"'}</Text>
                  )}
                  <Text style={{ color: t.subtext, fontSize: 12, marginTop: 1 }}>{new Date(e.createdAt).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</Text>
                </View>
              </View>
            ))}
          </View>
        </ScrollView>
      )}

      <Sheet visible={sheet === 'assignee'} onClose={() => setSheet(null)} title="Assign to">
        {people.map((p) => (
          <Pressable key={p.id} onPress={() => { setSheet(null); patch({ assigneeId: p.id }); }} style={{ flexDirection: 'row', alignItems: 'center', minHeight: 56, paddingHorizontal: 20 }}>
            <Avatar name={p.name} id={p.id} size={36} />
            <Text style={{ color: t.text, fontSize: 16, marginLeft: 12, flex: 1 }}>{p.name}</Text>
            {task?.assigneeId === p.id && <Ionicons name="checkmark" size={20} color={t.accent} />}
          </Pressable>
        ))}
        {!people.length && <ActivityIndicator color={t.accent} style={{ margin: 20 }} />}
      </Sheet>
      <Sheet visible={sheet === 'due'} onClose={() => setSheet(null)} title="Due date">
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 16 }}>
          {[['Today', isoDay(0)], ['Tomorrow', isoDay(1)], ['In 3 days', isoDay(3)], ['Next week', isoDay(7)]].map(([l, d]) => (
            <Pressable key={l} onPress={() => saveDue(d)} style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 16, borderRadius: 22, backgroundColor: t.soft, marginRight: 8, marginBottom: 8 }}>
              <Text style={{ color: t.text, fontWeight: '600' }}>{l}</Text>
            </Pressable>
          ))}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 8 }}>
          <TextInput
            value={dueText} onChangeText={setDueText} placeholder="YYYY-MM-DD" placeholderTextColor={t.subtext}
            style={{ flex: 1, minHeight: 44, backgroundColor: t.soft, color: t.text, borderRadius: 12, paddingHorizontal: 12, fontSize: 15 }}
          />
          <Pressable onPress={() => saveDue(dueText.trim() || null)} style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 18, borderRadius: 22, backgroundColor: t.accent, marginLeft: 8 }}>
            <Text style={{ color: '#fff', fontWeight: '700' }}>Save</Text>
          </Pressable>
        </View>
        <SheetRow icon="close-circle-outline" label="Clear due date" onPress={() => saveDue(null)} />
      </Sheet>
    </View>
  );
}
