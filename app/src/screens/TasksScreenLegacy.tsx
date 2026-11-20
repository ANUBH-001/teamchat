// Round 4: disabled (simple create->done). Old Overview / Board / List Tasks screen, kept for reference; not imported anywhere.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, FlatList, ScrollView, TextInput, Pressable, RefreshControl, BackHandler, Alert, Platform } from 'react-native';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../useTheme';
import { useAuth } from '../auth';
import { api } from '../api';
import { onEvent } from '../realtime';
import { usePublicSettings } from '../publicSettings';
import { useLiveRefresh, usePullRefresh } from '../useLive';
import { ActivityEvent, AnyTask, STEPS, StepStatus, Summary, Task, assigneeIdsOf, assigneeNamesOf, colorOf, isBrief, labelOf, myStatusOf } from '../taskTypes';
import { isoDay } from '../dates';
import Chip from '../components/Chip';
import TaskRow, { ROW_H } from '../components/TaskRow';
import BriefRow from '../components/BriefRow';
import TaskModal from '../components/TaskModal';
import TaskBoard from '../components/TaskBoard';
import TaskActionSheet from '../components/TaskActionSheet';
import TaskOverview, { TileKey } from '../components/TaskOverview';
import TaskDetailScreen from './TaskDetailScreen';
import { MyDayPanel, SignoffPanel, StalePanel } from '../components/TodayPanel';

type Seg = 'overview' | 'board' | 'list';
// member: mine | everyone. boss: all (active) | closed.
type View_ = 'mine' | 'everyone' | 'all' | 'closed';
type Filters = { status: StepStatus | 'overdue' | 'open' | 'all'; assignee: 'all' | 'me' | number; project: string; q: string };
const NO_FILTER: Filters = { status: 'all', assignee: 'all', project: '', q: '' };
const HEADER_H = 36;

type Item = { k: 'task'; task: AnyTask } | { k: 'head'; label: string; color?: string };

const urlFor = (v: View_) => (v === 'closed' ? '/tasks?status=closed&limit=200' : '/tasks?scope=' + v + '&limit=200');

// Group a member's own tasks: Overdue / Due today / This week / Later / Done
function groupMine(list: Task[]): Item[] {
  const today = isoDay(0), week = isoDay(7);
  const g: Record<string, Task[]> = { Overdue: [], 'Due today': [], 'This week': [], Later: [], Done: [] };
  for (const x of list) {
    const d = x.dueDate ? x.dueDate.slice(0, 10) : null;
    if (x.status === 'done' || x.status === 'closed') g.Done.push(x);
    else if (d && d < today) g.Overdue.push(x);
    else if (d === today) g['Due today'].push(x);
    else if (d && d <= week) g['This week'].push(x);
    else g.Later.push(x);
  }
  const out: Item[] = [];
  for (const k of Object.keys(g)) {
    if (!g[k].length) continue;
    out.push({ k: 'head', label: k + ' · ' + g[k].length, color: k === 'Overdue' ? '#E5484D' : undefined });
    for (const x of g[k]) out.push({ k: 'task', task: x });
  }
  return out;
}

function Skeleton() {
  const t = useTheme();
  return (
    <View>
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <View key={i} style={{ height: ROW_H, paddingHorizontal: 16, justifyContent: 'center', borderBottomWidth: 1, borderBottomColor: t.border, backgroundColor: t.card }}>
          <View style={{ height: 14, width: i % 2 ? '55%' : '75%', borderRadius: 7, backgroundColor: t.soft }} />
          <View style={{ height: 10, width: '35%', borderRadius: 5, backgroundColor: t.soft, marginTop: 10 }} />
        </View>
      ))}
    </View>
  );
}

export default function TasksScreenLegacy() {
  const t = useTheme();
  const { user } = useAuth();
  const ps = usePublicSettings();
  const me = user!;
  const isBoss = me.role === 'boss';
  const [seg, setSeg] = useState<Seg>('overview');
  const [view, setView] = useState<View_>(isBoss ? 'all' : 'mine');
  const [tasks, setTasks] = useState<AnyTask[]>([]);
  const [sum, setSum] = useState<Summary | null>(null);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [filters, setFilters] = useState<Filters>(NO_FILTER);
  const [detail, setDetail] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [sheetTask, setSheetTask] = useState<Task | null>(null);
  const [err, setErr] = useState('');
  const [loaded, setLoaded] = useState(false);
  const focused = useIsFocused();
  const nav = useNavigation();
  const viewRef = useRef(view);
  viewRef.current = view;
  // the sub-view draws its own header, so hide the tab header while it is open
  useEffect(() => { nav.setOptions({ headerShown: detail === null }); }, [nav, detail]);
  useEffect(() => {
    if (detail === null || !focused) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { setDetail(null); return true; });
    return () => sub.remove();
  }, [detail, focused]);

  const loadSide = useCallback(async () => {
    const [b, c] = await Promise.all([
      api<Summary>('GET', '/tasks/summary').catch(() => null),
      api<{ events: ActivityEvent[] }>('GET', '/tasks/activity?limit=50').catch(() => ({ events: [] as ActivityEvent[] })),
    ]);
    if (b) setSum(b);
    setActivity(c.events);
  }, []);
  const loadList = useCallback(async () => {
    const v = viewRef.current;
    try {
      const a = await api<{ tasks: AnyTask[] }>('GET', urlFor(v));
      if (viewRef.current === v) { setTasks(a.tasks); setErr(''); }
    } catch (e: any) { setErr(e.message); }
    setLoaded(true);
  }, []);
  const loadAll = useCallback(async () => { await Promise.all([loadList(), loadSide()]); }, [loadList, loadSide]);

  useEffect(() => { setLoaded(false); loadList(); }, [view, loadList]);
  useEffect(() => { loadSide(); }, [loadSide]);
  // reconnect / foreground / purge: full reload
  useLiveRefresh(loadAll, ['task_stale', 'tasks_purged', 'reset']);

  // ws 'task': apply the payload in place; summary + activity debounced (3 s); reassigned -> list too
  useEffect(() => {
    let tm: ReturnType<typeof setTimeout> | null = null;
    let relist = false;
    const off = onEvent((e) => {
      if (e.type !== 'task' || !e.task) return;
      const nt = e.task as Task;
      const v = viewRef.current;
      setTasks((prev) => {
        const i = prev.findIndex((x) => x.id === nt.id);
        const fits = v === 'closed' ? nt.status === 'closed' : nt.status !== 'closed';
        if (!fits) return i >= 0 ? prev.filter((x) => x.id !== nt.id) : prev;
        if (i >= 0) { const n = prev.slice(); n[i] = nt; return n; }
        return v === 'everyone' ? prev : [nt, ...prev];
      });
      if (e.event === 'reassigned') relist = true;
      if (tm) clearTimeout(tm);
      tm = setTimeout(() => { loadSide(); if (relist) { relist = false; loadList(); } }, 3000);
    });
    return () => { off(); if (tm) clearTimeout(tm); };
  }, [loadSide, loadList, me]); // eslint-disable-line react-hooks/exhaustive-deps

  const { refreshing, onRefresh } = usePullRefresh(loadAll);
  const refreshControl = <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[t.accent]} />;

  // "#12" search: the list is capped, so ask the server when nothing local matches
  const [extra, setExtra] = useState<AnyTask[]>([]);
  useEffect(() => {
    const q = filters.q.trim();
    if (!/^#\d+$/.test(q)) { setExtra([]); return; }
    const tm = setTimeout(() => {
      api<{ tasks: AnyTask[] }>('GET', '/tasks?q=' + encodeURIComponent(q) + (view === 'everyone' ? '&scope=everyone' : '')).then((r) => setExtra(r.tasks)).catch(() => {});
    }, 400);
    return () => clearTimeout(tm);
  }, [filters.q, view]);

  const full = useMemo(() => tasks.filter((x): x is Task => !isBrief(x)), [tasks]);
  const projects = useMemo(() => Array.from(new Set(full.map((x) => x.project).filter(Boolean) as string[])).sort(), [full]);
  const people = useMemo(() => {
    const m = new Map<number, string>();
    full.forEach((x) => (x.assignees || []).forEach((a) => m.set(a.id, a.name)));
    return Array.from(m, ([id, name]) => ({ id, name })).filter((p) => p.id !== me.id);
  }, [full, me.id]);

  const shown = useMemo(() => {
    const q = filters.q.trim().toLowerCase();
    const idq = /^#?\d+$/.test(q) ? Number(q.replace('#', '')) : null;
    const src = extra.length ? [...tasks, ...extra.filter((x) => !tasks.some((y) => y.id === x.id))] : tasks;
    return src.filter((x) => {
      if (idq !== null && x.id === idq) return true;
      const full_ = !isBrief(x) ? x : null;
      const closed = x.status === 'closed';
      const late = !!full_ && full_.overdue && x.status !== 'done' && !closed;
      if (filters.status === 'open' ? x.status === 'done' || closed : filters.status === 'overdue' ? !late
        : filters.status !== 'all' && x.status !== filters.status) return false;
      if (filters.assignee !== 'all') {
        const ids = isBrief(x) ? x.assigneeIds : assigneeIdsOf(x);
        if (!ids.includes(filters.assignee === 'me' ? me.id : filters.assignee)) return false;
      }
      if (filters.project && (!full_ || full_.project !== filters.project)) return false;
      if (q && !(x.title.toLowerCase().includes(q) || assigneeNamesOf(x).join(' ').toLowerCase().includes(q))) return false;
      return true;
    });
  }, [tasks, extra, filters, me.id]);

  const grouped = !isBoss && view === 'mine' && seg === 'list';
  const items: Item[] = useMemo(
    () => (grouped ? groupMine(shown.filter((x): x is Task => !isBrief(x))) : shown.map((x) => ({ k: 'task' as const, task: x }))),
    [grouped, shown],
  );
  const layout = useMemo(() => {
    let off = 0;
    return items.map((it) => { const length = it.k === 'head' ? HEADER_H : ROW_H; const r = { length, offset: off }; off += length; return r; });
  }, [items]);

  const stale = useMemo(() => full.filter((x) => x.stale && x.status !== 'closed' && (isBoss || (x.assignees || []).some((a) => a.id === me.id))), [full, isBoss, me.id]);
  const openTask = useCallback((x: Task) => setDetail(x.id), []);
  const openId = useCallback((id: number) => setDetail(id), []);
  const longPress = useCallback((x: Task) => { snap.current = x; setSheetTask(x); }, []);
  const goList = (f: Partial<Filters>) => { setFilters({ ...NO_FILTER, ...f }); setSeg('list'); };
  const onTile = (k: TileKey) => {
    if (k === 'doneToday') goList({ status: 'done' });
    else goList({ status: k });
  };

  // after a status change from the quick-action sheet: merge the task + offer Undo
  const snap = useRef<Task | null>(null);
  const sig = (x: Task) => (x.assignees || []).map((a) => a.id + a.status).join() + x.status;
  const onSheetChanged = useCallback((nt: Task) => {
    const before = snap.current;
    snap.current = nt;
    setTasks((prev) => {
      const i = prev.findIndex((x) => x.id === nt.id);
      const v = viewRef.current;
      const fits = v === 'closed' ? nt.status === 'closed' : nt.status !== 'closed';
      if (!fits) return i >= 0 ? prev.filter((x) => x.id !== nt.id) : prev;
      if (i < 0) return prev;
      const n = prev.slice(); n[i] = nt; return n;
    });
    if (before && before.status !== 'closed' && nt.status !== 'closed' && sig(before) !== sig(nt)) {
      // multi-assignee: say MY new step (the task's aggregate can stay lower until everyone moves)
      const mine = myStatusOf(nt, me);
      const what = mine ? 'Mera status → ' + labelOf(mine) + (mine !== nt.status ? ' (task: ' + labelOf(nt.status) + ')' : '') : labelOf(nt.status);
      Alert.alert('Status badla', '#' + nt.id + ' · ' + what, [
        { text: 'Theek hai', style: 'cancel' },
        { text: 'Undo', onPress: () => {
          api<{ task?: Task }>('POST', '/tasks/' + nt.id + '/undo', {}).then((r) => {
            if (r && r.task) { snap.current = r.task; setTasks((p) => p.map((x) => (x.id === r.task!.id ? r.task! : x))); setSheetTask(r.task); }
            loadSide(); loadList();
          }).catch((e) => Alert.alert('Undo nahi hua', e.message));
        } },
      ]);
    }
  }, [loadSide, loadList]);

  if (detail !== null) return <TaskDetailScreen taskId={detail} onBack={() => setDetail(null)} onChanged={loadAll} />;

  const segBtn = (k: Seg, label: string) => (
    <Pressable
      key={k} onPress={() => setSeg(k)}
      style={{ flex: 1, minHeight: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: seg === k ? t.card : 'transparent', elevation: seg === k ? 1 : 0 }}
    >
      <Text style={{ color: seg === k ? t.text : t.subtext, fontWeight: '600', fontSize: 14 }}>{label}</Text>
    </Pressable>
  );
  const chipRow = (children: React.ReactNode) => (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 12 }} style={{ flexGrow: 0, flexShrink: 0 }}>{children}</ScrollView>
  );
  const setF = (p: Partial<Filters>) => setFilters((f) => ({ ...f, ...p }));
  const viewBtn = (k: View_, label: string) => (
    <Pressable
      key={k} onPress={() => setView(k)}
      style={{ flex: 1, minHeight: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: view === k ? t.accent : 'transparent' }}
    >
      <Text style={{ color: view === k ? '#fff' : t.subtext, fontWeight: '600', fontSize: 13 }}>{label}</Text>
    </Pressable>
  );
  const effSeg: Seg = view === 'closed' && seg === 'board' ? 'list' : seg;

  const empty = (
    <View style={{ alignItems: 'center', padding: 28 }}>
      <Ionicons name="checkbox-outline" size={40} color={t.subtext} />
      <Text style={{ color: t.subtext, marginTop: 8, textAlign: 'center' }}>
        {filters.q || filters.status !== 'all' || filters.assignee !== 'all' || filters.project ? 'Koi task match nahi hua.' : view === 'closed' ? 'Koi closed task nahi.' : 'Abhi koi task nahi.'}
      </Text>
      {view !== 'closed' && view !== 'everyone' && (
        <Pressable onPress={() => setCreating(true)} style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 20, borderRadius: 22, backgroundColor: t.accent, marginTop: 14 }}>
          <Text style={{ color: '#fff', fontWeight: '700' }}>+ Naya task</Text>
        </Pressable>
      )}
    </View>
  );

  const renderItem = ({ item }: { item: Item }) => {
    if (item.k === 'head') {
      return (
        <View style={{ height: HEADER_H, justifyContent: 'center', paddingHorizontal: 16 }}>
          <Text style={{ color: item.color || t.subtext, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 }}>{item.label}</Text>
        </View>
      );
    }
    return isBrief(item.task) ? <BriefRow task={item.task} /> : <TaskRow task={item.task} onPress={openTask} onLongPress={longPress} />;
  };

  return (
    <View style={{ flex: 1, backgroundColor: t.background }}>
      <View style={{ flexDirection: 'row', margin: 12, marginBottom: 6, padding: 3, borderRadius: 12, backgroundColor: t.soft }}>
        {segBtn('overview', 'Overview')}{segBtn('board', 'Board')}{segBtn('list', 'List')}
      </View>
      {seg !== 'overview' && (
        <View style={{ flexDirection: 'row', marginHorizontal: 12, marginBottom: 6, padding: 2, borderRadius: 20, backgroundColor: t.soft }}>
          {isBoss ? <>{viewBtn('all', 'Active')}{viewBtn('closed', 'Closed')}</> : <>{viewBtn('mine', 'Mine')}{viewBtn('everyone', 'Everyone')}</>}
        </View>
      )}
      {!!err && <Text style={{ color: t.danger, paddingHorizontal: 16, paddingBottom: 8 }}>{err}</Text>}

      {!loaded ? (
        <Skeleton />
      ) : effSeg === 'overview' ? (
        <ScrollView refreshControl={refreshControl} contentContainerStyle={{ paddingBottom: 90 }} keyboardShouldPersistTaps="handled">
          {isBoss ? <SignoffPanel onPerson={(id) => goList({ assignee: id })} /> : <MyDayPanel />}
          <StalePanel tasks={stale} days={ps.taskReminderDays || 6} onOpen={openId} />
          <TaskOverview
            sum={sum} activity={activity} canPraise={isBoss && ps.praiseEnabled} isBoss={isBoss}
            onTile={onTile} onTeam={(id) => goList({ assignee: id })} onOpenTask={openId}
          />
        </ScrollView>
      ) : effSeg === 'board' ? (
        <TaskBoard tasks={shown.filter((x): x is Task => !isBrief(x))} onOpen={openId} onLongPress={longPress} />
      ) : (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginHorizontal: 12, marginBottom: 4, backgroundColor: t.card, borderRadius: 22, paddingHorizontal: 14, minHeight: 44 }}>
            <Ionicons name="search" size={18} color={t.subtext} />
            <TextInput
              value={filters.q} onChangeText={(q) => setF({ q })} placeholder="Search tasks ya #12" placeholderTextColor={t.subtext}
              style={{ flex: 1, color: t.text, fontSize: 15, marginLeft: 8, paddingVertical: 8 }}
            />
          </View>
          {view !== 'closed' && chipRow(
            <>
              <Chip label="All" active={filters.status === 'all'} onPress={() => setF({ status: 'all' })} />
              <Chip label="Open" active={filters.status === 'open'} onPress={() => setF({ status: 'open' })} />
              {STEPS.map((s) => (
                <Chip key={s} label={labelOf(s)} color={colorOf(s)} active={filters.status === s} onPress={() => setF({ status: s })} />
              ))}
              <Chip label="Overdue" color="#E5484D" active={filters.status === 'overdue'} onPress={() => setF({ status: 'overdue' })} />
            </>,
          )}
          {isBoss && chipRow(
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
            data={items}
            keyExtractor={(x) => (x.k === 'head' ? 'h' + x.label : String(x.task.id))}
            refreshControl={refreshControl}
            initialNumToRender={14}
            windowSize={9}
            removeClippedSubviews={Platform.OS === 'android'}
            getItemLayout={(_, i) => ({ length: layout[i].length, offset: layout[i].offset, index: i })}
            style={{ marginTop: 6 }}
            contentContainerStyle={{ paddingBottom: 90 }}
            renderItem={renderItem}
            ListEmptyComponent={empty}
          />
        </>
      )}

      <Pressable
        onPress={() => setCreating(true)}
        style={{ position: 'absolute', right: 18, bottom: 18, width: 56, height: 56, borderRadius: 28, backgroundColor: t.accent, alignItems: 'center', justifyContent: 'center', elevation: 5 }}
      >
        <Ionicons name="add" size={30} color="#fff" />
      </Pressable>
      <TaskModal visible={creating} meId={me.id} onClose={() => setCreating(false)} onDone={() => { loadAll(); }} />
      <TaskActionSheet
        visible={!!sheetTask} onClose={() => setSheetTask(null)} task={sheetTask}
        onOpen={openId} onChanged={onSheetChanged}
      />
    </View>
  );
}
