// Round 4 Tasks tab, Google Keep style. Chips: Mine | Team (admin) | Done. Admin: "Take a task..." composer + masonry of
// one card per person. Tick = optimistic, 4 s Undo snackbar, live via ws 'task'. The old Overview / Board / List screen is
// kept in TasksScreenLegacy.tsx ("Round 4: disabled (simple create->done)").
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, TextInput, Pressable, RefreshControl, ActivityIndicator, BackHandler } from 'react-native';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../useTheme';
import { useAuth } from '../auth';
import { api } from '../api';
import { onEvent } from '../realtime';
import { useLiveRefresh, usePullRefresh } from '../useLive';
import { AnyTask, Task, isBrief, isPrivate } from '../taskTypes';
import { Line, linesOf } from '../taskFormat';
import { toast } from '../useVoiceInput';
import { DoneList, KeepCard, MineList, Masonry, estHeight } from '../components/KeepViews';
import TaskComposer from '../components/TaskComposer';
import TaskSheet from '../components/TaskSheet';
import Sheet, { SheetRow } from '../components/Sheet';

type Chip_ = 'mine' | 'team' | 'done';

// Apply one person's tick locally (assignee row + aggregate), for the optimistic update.
function applyTick(task: Task, userId: number, done: boolean): Task {
  const now = new Date().toISOString();
  const assignees = (task.assignees || []).map((a) => (a.id === userId ? { ...a, status: done ? ('done' as const) : ('todo' as const), completedAt: done ? now : null } : a));
  const all = assignees.length > 0 && assignees.every((a) => a.status === 'done');
  return { ...task, assignees, status: task.status === 'closed' ? 'closed' : all ? 'done' : 'todo', completedAt: all ? now : null };
}
const upsert = (list: Task[], nt: Task) => {
  if (nt.status === 'closed') return list.filter((x) => x.id !== nt.id);
  const i = list.findIndex((x) => x.id === nt.id);
  if (i < 0) return [nt, ...list];
  const n = list.slice(); n[i] = nt; return n;
};

export default function TasksScreen() {
  const t = useTheme();
  const { user } = useAuth();
  const me = user!;
  const isBoss = me.role === 'boss';
  const insets = useSafeAreaInsets();
  const nav = useNavigation();
  const focused = useIsFocused();
  const [chip, setChip] = useState<Chip_>('mine');
  const [q, setQ] = useState('');
  const [searching, setSearching] = useState(false);
  const [menu, setMenu] = useState(false);
  const [tasks, setTasks] = useState<Task[]>([]); // open + done of the last 14 days
  const [doneAll, setDoneAll] = useState<Task[] | null>(null); // Done history (loaded when the Done chip opens)
  const [loaded, setLoaded] = useState(false);
  const [err, setErr] = useState('');
  const [person, setPerson] = useState<number | null>(null); // Team: full list of one person
  const [sheetId, setSheetId] = useState<number | null>(null);
  const [snack, setSnack] = useState<{ msg: string; undo: () => void } | null>(null);
  const snackTm = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chipRef = useRef(chip);
  chipRef.current = chip;

  useEffect(() => { nav.setOptions({ headerShown: false }); }, [nav]);
  useEffect(() => {
    if (person === null || !focused) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { setPerson(null); return true; });
    return () => sub.remove();
  }, [person, focused]);

  const scope = isBoss ? 'all' : 'mine';
  const keep = (list: AnyTask[]) => list.filter((x): x is Task => !isBrief(x) && x.status !== 'closed');
  const loadMain = useCallback(async () => {
    try {
      const r = await api<{ tasks: AnyTask[] }>('GET', '/tasks?scope=' + scope + '&limit=200');
      setTasks(keep(r.tasks)); setErr('');
    } catch (e: any) { setErr(e.message || 'Load nahi hua'); }
    setLoaded(true);
  }, [scope]);
  const loadDone = useCallback(async () => {
    try {
      const r = await api<{ tasks: AnyTask[] }>('GET', '/tasks?status=done&scope=' + scope + '&limit=200');
      setDoneAll(keep(r.tasks));
    } catch (e: any) { setErr(e.message || 'Load nahi hua'); }
  }, [scope]);
  const loadAll = useCallback(async () => { await Promise.all([loadMain(), chipRef.current === 'done' ? loadDone() : Promise.resolve()]); }, [loadMain, loadDone]);

  useEffect(() => { loadMain(); }, [loadMain]);
  useEffect(() => { if (chip === 'done') loadDone(); }, [chip, loadDone]);
  useLiveRefresh(loadAll, ['task_stale', 'tasks_purged', 'reset']);
  const { refreshing, onRefresh } = usePullRefresh(loadAll);

  const merge = useCallback((nt: Task) => {
    setTasks((p) => upsert(p, nt));
    setDoneAll((p) => (p ? (nt.status === 'done' ? upsert(p, nt) : p.filter((x) => x.id !== nt.id)) : p));
  }, []);

  // live: ws 'task' merges in place (admin and assignee both see ticks at once); people changes relist
  useEffect(() => {
    let tm: ReturnType<typeof setTimeout> | null = null;
    const off = onEvent((e) => {
      if (e.type !== 'task' || !e.task || isBrief(e.task)) return;
      const nt = e.task as Task;
      const mineNow = isBoss || (nt.assignees || []).some((a) => a.id === me.id);
      if (!mineNow) { setTasks((p) => p.filter((x) => x.id !== nt.id)); setDoneAll((p) => (p ? p.filter((x) => x.id !== nt.id) : p)); return; }
      merge(nt);
      if (e.event === 'reassigned') { if (tm) clearTimeout(tm); tm = setTimeout(() => loadAll(), 1000); }
    });
    return () => { off(); if (tm) clearTimeout(tm); };
  }, [merge, loadAll, isBoss, me.id]);

  // ---- tick (optimistic) + Undo ----
  const showSnack = (msg: string, undo: () => void) => {
    if (snackTm.current) clearTimeout(snackTm.current);
    setSnack({ msg, undo });
    snackTm.current = setTimeout(() => setSnack(null), 4000);
  };
  useEffect(() => () => { if (snackTm.current) clearTimeout(snackTm.current); }, []);
  const setDone = useCallback(async (task: Task, userId: number, done: boolean, withUndo = true) => {
    merge(applyTick(task, userId, done)); // optimistic: strike + move
    try {
      const r = await api<{ task: Task }>('PATCH', '/tasks/' + task.id, { status: done ? 'done' : 'todo', userId });
      if (r && r.task) merge(r.task);
      if (withUndo) {
        const back = r && r.task ? r.task : applyTick(task, userId, done);
        showSnack(done ? 'Task ' + task.id + ' done' : 'Task ' + task.id + ' wapas pending', () => { setSnack(null); setDone(back, userId, !done, false); });
      }
    } catch (e: any) {
      merge(task); // revert
      toast(e.message || 'Nahi ho paya');
    }
  }, [merge]);
  const onTick = useCallback((l: Line) => setDone(l.task, l.userId, !l.done), [setDone]);
  const onOpen = useCallback((l: Line) => setSheetId(l.task.id), []);

  // ---- derived lines ----
  const ql = q.trim().toLowerCase();
  const matches = (l: Line) => {
    if (!ql) return true;
    const num = ql.replace(/^task\s*|^#/, '');
    return l.task.title.toLowerCase().includes(ql) || l.name.toLowerCase().includes(ql) || String(l.task.id) === num || ('task ' + l.task.id).includes(ql);
  };
  const allLines = useMemo(() => tasks.flatMap(linesOf), [tasks]);
  const mineLines = useMemo(() => allLines.filter((l) => l.userId === me.id && matches(l)), [allLines, me.id, ql]); // eslint-disable-line react-hooks/exhaustive-deps
  const doneLines = useMemo(() => {
    const src = (doneAll || []).flatMap(linesOf).filter((l) => l.done);
    return src.filter((l) => (isBoss || l.userId === me.id) && matches(l));
  }, [doneAll, isBoss, me.id, ql]); // eslint-disable-line react-hooks/exhaustive-deps

  const teamCards = useMemo(() => {
    const priv = allLines.filter((l) => isPrivate(l.task) && matches(l));
    const byUser = new Map<number, { name: string; lines: Line[] }>();
    for (const l of allLines) {
      if (isPrivate(l.task) || !matches(l)) continue;
      if (!byUser.has(l.userId)) byUser.set(l.userId, { name: l.name, lines: [] });
      byUser.get(l.userId)!.lines.push(l);
    }
    return { priv, people: [...byUser.entries()].map(([id, v]) => ({ id, ...v })).sort((a, b) => a.name.localeCompare(b.name)) };
  }, [allLines, ql]); // eslint-disable-line react-hooks/exhaustive-deps

  const sheetTask = sheetId !== null ? tasks.find((x) => x.id === sheetId) || (doneAll || []).find((x) => x.id === sheetId) || null : null;

  const empty = (txt: string) => (
    <View style={{ alignItems: 'center', padding: 36 }}>
      <Text style={{ fontSize: 34 }}>🎉</Text>
      <Text style={{ color: t.subtext, marginTop: 8, textAlign: 'center' }}>{txt}</Text>
    </View>
  );

  let body: React.ReactNode;
  if (!loaded) body = <ActivityIndicator color={t.accent} style={{ marginTop: 40 }} />;
  else if (chip === 'mine') {
    body = mineLines.length ? <MineList lines={mineLines} me={me.id} isBoss={isBoss} onTick={onTick} onOpen={onOpen} /> : empty('Koi task nahi 🎉');
  } else if (chip === 'done') {
    body = doneAll === null ? <ActivityIndicator color={t.accent} style={{ marginTop: 40 }} /> : doneLines.length ? <DoneList lines={doneLines} onOpen={onOpen} /> : empty('Abhi tak koi task done nahi');
  } else if (person !== null) {
    const p = teamCards.people.find((x) => x.id === person);
    body = (
      <View style={{ paddingHorizontal: 12 }}>
        <Pressable onPress={() => setPerson(null)} style={{ flexDirection: 'row', alignItems: 'center', minHeight: 40, marginBottom: 6 }}>
          <Ionicons name="arrow-back" size={20} color={t.text} />
          <Text style={{ color: t.text, fontWeight: '700', marginLeft: 8 }}>{p ? p.name : 'Team'}</Text>
        </Pressable>
        {p ? <MineList lines={p.lines} me={me.id} isBoss={isBoss} onTick={onTick} onOpen={onOpen} /> : empty('Koi task nahi 🎉')}
      </View>
    );
  } else {
    const items: { key: string; h: number; node: React.ReactNode }[] = [];
    if (teamCards.priv.length) {
      items.push({ key: 'priv', h: estHeight(teamCards.priv), node: <KeepCard title="My tasks" lock lines={teamCards.priv} me={me.id} isBoss={isBoss} onTick={onTick} onOpen={onOpen} /> });
    }
    for (const p of teamCards.people) {
      items.push({
        key: 'u' + p.id, h: estHeight(p.lines),
        node: <KeepCard title={p.name} userId={p.id} lines={p.lines} me={me.id} isBoss={isBoss} onTick={onTick} onOpen={onOpen} onTitle={() => setPerson(p.id)} />,
      });
    }
    body = items.length ? <Masonry items={items} /> : empty('Koi task nahi 🎉');
  }

  const chipBtn = (k: Chip_, label: string) => {
    const on = chip === k;
    return (
      <Pressable key={k} onPress={() => { setChip(k); setPerson(null); }} style={{ height: 34, paddingHorizontal: 16, borderRadius: 17, marginRight: 8, justifyContent: 'center', backgroundColor: on ? t.chip : t.surface }}>
        <Text style={{ color: on ? t.chipText : t.subtext, fontWeight: on ? '700' : '500', fontSize: 14 }}>{label}</Text>
      </Pressable>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: t.background }}>
      <View style={{ paddingTop: insets.top + 10, paddingBottom: 6, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center' }}>
        <Text style={{ flex: 1, color: t.accent, fontSize: 24, fontWeight: '800' }}>Tasks</Text>
        <Pressable onPress={() => { setSearching((v) => !v); if (searching) setQ(''); }} hitSlop={8} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="search" size={24} color={t.text} />
        </Pressable>
        <Pressable onPress={() => setMenu(true)} hitSlop={8} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="ellipsis-vertical" size={22} color={t.text} />
        </Pressable>
      </View>
      {searching && (
        <View style={{ flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, marginBottom: 8, backgroundColor: t.surface, borderRadius: 24, paddingHorizontal: 14 }}>
          <Ionicons name="search" size={18} color={t.subtext} />
          <TextInput
            value={q} onChangeText={setQ} autoFocus placeholder="Title, Task 22 ya naam" placeholderTextColor={t.subtext}
            style={{ flex: 1, color: t.text, paddingHorizontal: 10, paddingVertical: 9, fontSize: 15 }}
          />
          {!!q && <Pressable onPress={() => setQ('')} hitSlop={8}><Ionicons name="close-circle" size={18} color={t.subtext} /></Pressable>}
        </View>
      )}
      <View style={{ height: 44 }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, alignItems: 'center' }}>
          {chipBtn('mine', 'Mine')}{isBoss && chipBtn('team', 'Team')}{chipBtn('done', 'Done')}
        </ScrollView>
      </View>
      {!!err && <Text style={{ color: t.danger, paddingHorizontal: 16, paddingBottom: 6 }}>{err}</Text>}
      <ScrollView
        keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingTop: 6, paddingBottom: 100 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[t.accent]} />}
      >
        {isBoss && chip !== 'done' && person === null && <TaskComposer meId={me.id} onCreated={(nt) => merge(nt)} />}
        {body}
      </ScrollView>

      {!!snack && (
        <View style={{ position: 'absolute', left: 16, right: 16, bottom: 16, minHeight: 48, borderRadius: 12, backgroundColor: t.text, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, elevation: 6 }}>
          <Text style={{ flex: 1, color: t.background, fontSize: 14 }}>{snack.msg}</Text>
          <Pressable onPress={snack.undo} hitSlop={8}><Text style={{ color: t.accent2, fontWeight: '800' }}>UNDO</Text></Pressable>
        </View>
      )}
      <TaskSheet
        task={sheetTask} onClose={() => setSheetId(null)}
        onTick={(task, userId, done) => setDone(task, userId, done)} onChanged={merge}
      />
      <Sheet visible={menu} onClose={() => setMenu(false)}>
        <SheetRow icon="refresh-outline" label="Refresh" onPress={() => { setMenu(false); loadAll(); }} />
      </Sheet>
    </View>
  );
}
