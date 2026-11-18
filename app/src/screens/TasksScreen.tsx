import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, FlatList, ScrollView, TextInput, Pressable, RefreshControl, ActivityIndicator, BackHandler } from 'react-native';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../useTheme';
import { useAuth } from '../auth';
import { api } from '../api';
import { usePublicSettings } from '../publicSettings';
import { useLiveRefresh, usePullRefresh } from '../useLive';
import { ActivityEvent, STATUSES, STATUS_COLOR, STATUS_LABEL, Status, Summary, Task } from '../taskTypes';
import Chip from '../components/Chip';
import TaskRow from '../components/TaskRow';
import TaskModal from '../components/TaskModal';
import TaskBoard from '../components/TaskBoard';
import TaskOverview, { TileKey } from '../components/TaskOverview';
import TaskDetailScreen from './TaskDetailScreen';
import { MyDayPanel, SignoffPanel, StalePanel } from '../components/TodayPanel';

type Seg = 'overview' | 'board' | 'list';
type Filters = { status: Status | 'overdue' | 'open' | 'all'; assignee: 'all' | 'me' | number; project: string; q: string };
const NO_FILTER: Filters = { status: 'all', assignee: 'all', project: '', q: '' };

export default function TasksScreen() {
  const t = useTheme();
  const { user } = useAuth();
  const ps = usePublicSettings();
  const me = user!;
  const isBoss = me.role === 'boss';
  const canCreate = isBoss || ps.membersCanAssign;
  const [seg, setSeg] = useState<Seg>('overview');
  const [tasks, setTasks] = useState<Task[]>([]);
  const [sum, setSum] = useState<Summary | null>(null);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [filters, setFilters] = useState<Filters>(NO_FILTER);
  const [detail, setDetail] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState('');
  const [loaded, setLoaded] = useState(false);
  const focused = useIsFocused();
  const nav = useNavigation();
  // the sub-view draws its own header, so hide the tab header while it is open
  useEffect(() => { nav.setOptions({ headerShown: detail === null }); }, [nav, detail]);
  useEffect(() => {
    if (detail === null || !focused) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { setDetail(null); return true; });
    return () => sub.remove();
  }, [detail, focused]);

  const load = useCallback(async () => {
    try {
      const [a, b, c] = await Promise.all([
        api<{ tasks: Task[] }>('GET', '/tasks?assignee=all'),
        api<Summary>('GET', '/tasks/summary'),
        api<{ events: ActivityEvent[] }>('GET', '/tasks/activity?limit=50').catch(() => ({ events: [] as ActivityEvent[] })),
      ]);
      setTasks(a.tasks); setSum(b); setActivity(c.events); setErr('');
    } catch (e: any) { setErr(e.message); }
    setLoaded(true);
  }, []);
  useEffect(() => { load(); }, [load]);
  // lists, counts and the activity feed follow WebSocket task events, reconnect and app foreground
  useLiveRefresh(load, ['task', 'task_deleted', 'task_stale', 'tasks_purged', 'reset']);
  const { refreshing, onRefresh } = usePullRefresh(load);
  const refreshControl = <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[t.accent]} />;

  const projects = useMemo(() => Array.from(new Set(tasks.map((x) => x.project).filter(Boolean) as string[])).sort(), [tasks]);
  const people = useMemo(() => {
    const m = new Map<number, string>();
    tasks.forEach((x) => { if (x.assigneeId && x.assigneeName) m.set(x.assigneeId, x.assigneeName); });
    return Array.from(m, ([id, name]) => ({ id, name })).filter((p) => p.id !== me.id);
  }, [tasks, me.id]);
  const shown = useMemo(() => {
    const q = filters.q.trim().toLowerCase();
    return tasks.filter((x) => {
      if (filters.status === 'open' ? x.status === 'done' : filters.status === 'overdue' ? !(x.overdue && x.status !== 'done')
        : filters.status !== 'all' && x.status !== filters.status) return false;
      if (filters.assignee === 'me' ? x.assigneeId !== me.id : filters.assignee !== 'all' && x.assigneeId !== filters.assignee) return false;
      if (filters.project && x.project !== filters.project) return false;
      if (q && !(x.title.toLowerCase().includes(q) || (x.assigneeName || '').toLowerCase().includes(q))) return false;
      return true;
    });
  }, [tasks, filters, me.id]);

  const stale = useMemo(() => tasks.filter((x) => x.stale && (isBoss || x.assigneeId === me.id)), [tasks, isBoss, me.id]);
  const openTask = useCallback((x: Task) => setDetail(x.id), []);
  const goList = (f: Partial<Filters>) => { setFilters({ ...NO_FILTER, ...f }); setSeg('list'); };
  const onTile = (k: TileKey) => {
    if (k === 'doneToday') goList({ status: 'done' });
    else goList({ status: k });
  };

  if (detail !== null) return <TaskDetailScreen taskId={detail} onBack={() => setDetail(null)} onChanged={load} />;

  const segBtn = (k: Seg, label: string) => (
    <Pressable
      key={k} onPress={() => setSeg(k)}
      style={{ flex: 1, minHeight: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: seg === k ? t.card : 'transparent', elevation: seg === k ? 1 : 0 }}
    >
      <Text style={{ color: seg === k ? t.text : t.subtext, fontWeight: '600', fontSize: 14 }}>{label}</Text>
    </Pressable>
  );
  const chipRow = (children: React.ReactNode) => (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 12 }} style={{ flexGrow: 0 }}>{children}</ScrollView>
  );
  const setF = (p: Partial<Filters>) => setFilters((f) => ({ ...f, ...p }));

  return (
    <View style={{ flex: 1, backgroundColor: t.background }}>
      <View style={{ flexDirection: 'row', margin: 12, padding: 3, borderRadius: 12, backgroundColor: t.soft }}>
        {segBtn('overview', 'Overview')}{segBtn('board', 'Board')}{segBtn('list', 'List')}
      </View>
      {!!err && <Text style={{ color: t.danger, paddingHorizontal: 16, paddingBottom: 8 }}>{err}</Text>}

      {!loaded ? (
        <ActivityIndicator color={t.accent} style={{ marginTop: 30 }} />
      ) : seg === 'overview' ? (
        <ScrollView refreshControl={refreshControl} contentContainerStyle={{ paddingBottom: 90 }} keyboardShouldPersistTaps="handled">
          {isBoss ? <SignoffPanel onPerson={(id) => goList({ assignee: id })} /> : <MyDayPanel />}
          <StalePanel tasks={stale} days={ps.taskReminderDays || 6} onOpen={(id) => setDetail(id)} />
          <TaskOverview
            sum={sum} activity={activity} canPraise={isBoss && ps.praiseEnabled}
            onTile={onTile} onTeam={(id) => goList({ assignee: id })} onOpenTask={(id) => setDetail(id)}
          />
        </ScrollView>
      ) : seg === 'board' ? (
        <TaskBoard tasks={tasks} onOpen={(id) => setDetail(id)} />
      ) : (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginHorizontal: 12, marginBottom: 4, backgroundColor: t.card, borderRadius: 22, paddingHorizontal: 14, minHeight: 44 }}>
            <Ionicons name="search" size={18} color={t.subtext} />
            <TextInput
              value={filters.q} onChangeText={(q) => setF({ q })} placeholder="Search tasks" placeholderTextColor={t.subtext}
              style={{ flex: 1, color: t.text, fontSize: 15, marginLeft: 8, paddingVertical: 8 }}
            />
          </View>
          {chipRow(
            <>
              <Chip label="All" active={filters.status === 'all'} onPress={() => setF({ status: 'all' })} />
              <Chip label="Open" active={filters.status === 'open'} onPress={() => setF({ status: 'open' })} />
              {STATUSES.map((s) => (
                <Chip key={s} label={STATUS_LABEL[s]} color={STATUS_COLOR[s]} active={filters.status === s} onPress={() => setF({ status: s })} />
              ))}
              <Chip label="Overdue" color="#E5484D" active={filters.status === 'overdue'} onPress={() => setF({ status: 'overdue' })} />
            </>,
          )}
          {chipRow(
            <>
              <Chip label="Everyone" active={filters.assignee === 'all'} onPress={() => setF({ assignee: 'all' })} />
              <Chip label="Me" active={filters.assignee === 'me'} onPress={() => setF({ assignee: 'me' })} />
              {people.map((p) => <Chip key={p.id} label={p.name} active={filters.assignee === p.id} onPress={() => setF({ assignee: p.id })} />)}
            </>,
          )}
          {projects.length > 0 && chipRow(
            <>
              <Chip label="All projects" active={!filters.project} onPress={() => setF({ project: '' })} />
              {projects.map((p) => <Chip key={p} label={p} active={filters.project === p} onPress={() => setF({ project: p })} />)}
            </>,
          )}
          <FlatList
            data={shown}
            keyExtractor={(x) => String(x.id)}
            refreshControl={refreshControl}
            initialNumToRender={14}
            windowSize={9}
            style={{ marginTop: 6 }}
            contentContainerStyle={{ paddingBottom: 90 }}
            renderItem={({ item }) => <TaskRow task={item} onPress={openTask} />}
            ListEmptyComponent={<Text style={{ color: t.subtext, padding: 24, textAlign: 'center' }}>No tasks match.</Text>}
          />
        </>
      )}

      {canCreate && (
        <Pressable
          onPress={() => setCreating(true)}
          style={{ position: 'absolute', right: 18, bottom: 18, width: 56, height: 56, borderRadius: 28, backgroundColor: t.accent, alignItems: 'center', justifyContent: 'center', elevation: 5 }}
        >
          <Ionicons name="add" size={30} color="#fff" />
        </Pressable>
      )}
      <TaskModal
        visible={creating} meId={me.id} onClose={() => setCreating(false)} onDone={load}
        people={(isBoss || ps.membersCanAssign ? sum?.users : sum?.users.filter((u) => u.id === me.id)) ?? []}
      />
    </View>
  );
}
