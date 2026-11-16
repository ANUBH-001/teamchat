import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, FlatList, ScrollView, TouchableOpacity } from 'react-native';
import { useTheme } from '../useTheme';
import { useAuth } from '../auth';
import { api } from '../api';
import { onEvent } from '../realtime';
import { Mine, STATUSES, STATUS_COLOR, STATUS_LABEL, Status, Summary, Task } from '../taskTypes';
import Chip from '../components/Chip';
import TaskRow from '../components/TaskRow';
import TaskModal from '../components/TaskModal';

type Filter = { kind: 'all' } | { kind: 'user'; id: number } | { kind: 'status'; s: Status };

export default function TasksScreen() {
  const t = useTheme();
  const { user } = useAuth();
  const isBoss = user?.role === 'boss';
  const [tasks, setTasks] = useState<Task[]>([]);
  const [sum, setSum] = useState<Summary | null>(null);
  const [mine, setMine] = useState<Mine | null>(null);
  const [tab, setTab] = useState<'all' | 'mine'>('all');
  const [filter, setFilter] = useState<Filter>({ kind: 'all' });
  const [modal, setModal] = useState<{ open: boolean; task: Task | null }>({ open: false, task: null });
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    try {
      const [a, b, c] = await Promise.all([
        api<{ tasks: Task[] }>('GET', '/tasks?assignee=all'),
        api<Summary>('GET', '/tasks/summary'),
        api<Mine>('GET', '/tasks/mine/summary'),
      ]);
      setTasks(a.tasks); setSum(b); setMine(c); setErr('');
    } catch (e: any) { setErr(e.message); }
  }, []);

  useEffect(() => {
    load();
    return onEvent((e) => { if (e.type === 'task' || e.type === 'task_deleted' || e.type === '_open') load(); });
  }, [load]);

  const my = sum?.users.find((u) => u.id === user?.id);
  const withTasks = sum?.users.filter((u) => u.total > 0) ?? [];
  const shown = useMemo(() => tasks.filter((x) =>
    filter.kind === 'all' ? true : filter.kind === 'user' ? x.assigneeId === filter.id : x.status === filter.s), [tasks, filter]);
  const count = (s: Status) => tasks.filter((x) => x.status === s).length;
  const open = (task: Task | null) => setModal({ open: true, task });
  const canOpen = (x: Task) => isBoss || x.assigneeId === user?.id;
  const card = { backgroundColor: t.card, borderRadius: 10, padding: 10, marginRight: 8, minWidth: 130 };
  const hScroll = { horizontal: true, showsHorizontalScrollIndicator: false, contentContainerStyle: { paddingHorizontal: 10 } } as const;

  const bullets = (s: Status) => (mine?.[s] ?? []).length > 0 && (
    <View key={s} style={{ marginBottom: 12 }}>
      <Text style={{ color: STATUS_COLOR[s], fontWeight: '700', marginBottom: 4 }}>{STATUS_LABEL[s]} ({mine![s].length})</Text>
      {mine![s].map((i) => (
        <Text key={i.id} style={{ color: t.text, fontSize: 15, marginBottom: 2 }}>
          {'• ' + i.title + (i.dueDate ? ' (due ' + i.dueDate + ')' : '')}
        </Text>
      ))}
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: t.background }}>
      <View style={{ flexDirection: 'row', padding: 10, paddingBottom: 0 }}>
        <Chip label="All Tasks" active={tab === 'all'} onPress={() => setTab('all')} />
        <Chip label="My Tasks" active={tab === 'mine'} onPress={() => setTab('mine')} />
      </View>
      {!!err && <Text style={{ color: '#D32F2F', padding: 10 }}>{err}</Text>}
      <Text style={{ color: t.subtext, paddingHorizontal: 12, paddingVertical: 6 }}>
        Me: {my?.total ?? 0} total, {my?.done ?? 0} done, {my?.in_progress ?? 0} doing, {my?.todo ?? 0} todo
      </Text>

      {tab === 'mine' ? (
        <ScrollView contentContainerStyle={{ padding: 14 }}>
          {mine && !mine.done.length && !mine.in_progress.length && !mine.todo.length && (
            <Text style={{ color: t.subtext }}>No tasks yet.</Text>
          )}
          {bullets('done')}{bullets('in_progress')}{bullets('todo')}
        </ScrollView>
      ) : (
        <>
          <View>
            <ScrollView {...hScroll}>
              {withTasks.map((u) => (
                <TouchableOpacity key={u.id} style={card} onPress={() => setFilter({ kind: 'user', id: u.id })}>
                  <Text style={{ color: t.text, fontWeight: '600' }}>{u.name}</Text>
                  <Text style={{ color: t.subtext, fontSize: 12 }}>{u.total} total, {u.done} done, {u.todo + u.in_progress} pending</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
          <View>
            <ScrollView {...hScroll}>
              <Chip label={'All ' + tasks.length} active={filter.kind === 'all'} onPress={() => setFilter({ kind: 'all' })} />
              {withTasks.map((u) => (
                <Chip key={u.id} label={u.name + ' ' + u.total} active={filter.kind === 'user' && filter.id === u.id}
                  onPress={() => setFilter({ kind: 'user', id: u.id })} />
              ))}
              {STATUSES.map((s) => (
                <Chip key={s} label={STATUS_LABEL[s] + ' ' + count(s)} color={STATUS_COLOR[s]}
                  active={filter.kind === 'status' && filter.s === s} onPress={() => setFilter({ kind: 'status', s })} />
              ))}
            </ScrollView>
          </View>
          <FlatList
            data={shown}
            keyExtractor={(x) => String(x.id)}
            renderItem={({ item }) => <TaskRow task={item} onPress={() => canOpen(item) && open(item)} />}
            ListEmptyComponent={<Text style={{ color: t.subtext, padding: 16 }}>No tasks.</Text>}
          />
        </>
      )}

      {isBoss && (
        <TouchableOpacity onPress={() => open(null)} style={{ position: 'absolute', right: 18, bottom: 18, width: 56, height: 56,
          borderRadius: 28, backgroundColor: t.accent, alignItems: 'center', justifyContent: 'center', elevation: 4 }}>
          <Text style={{ color: '#fff', fontSize: 30, marginTop: -2 }}>+</Text>
        </TouchableOpacity>
      )}
      <TaskModal visible={modal.open} task={modal.task} people={sum?.users ?? []} isBoss={!!isBoss}
        onClose={() => setModal({ open: false, task: null })} onDone={load} />
    </View>
  );
}
