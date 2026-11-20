import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../useTheme';
import { api } from '../api';
import { CheckinToday, DayTask } from '../chatTypes';
import { StepStatus, STATUS_COLOR } from '../taskTypes';
// Round 4: disabled (simple create->done): import StatusChips from './StatusChips';
import StatusChips from './DoneChips';
import { loadCheckinToday, onCheckinToday, peekCheckinToday } from '../checkinStore';
import { useLiveRefresh } from '../useLive';

// Old keys (old payloads) are shown as their new step.
// Round 4: disabled (simple create->done): old 6-step mapping. Now only Done / Not done.
const norm = (st: string): StepStatus => (st === 'done' || st === 'closed' ? 'done' : 'todo');

export function Flags({ task }: { task: DayTask }) {
  const t = useTheme();
  const tag = (label: string, color: string) => (
    <View key={label} style={{ backgroundColor: color, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 1, marginLeft: 6 }}>
      <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700' }}>{label}</Text>
    </View>
  );
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', marginTop: 2 }}>
      <Text style={{ color: t.subtext, fontSize: 12 }}>
        Task {task.id}{task.project ? '  ·  ' + task.project : ''}
      </Text>
      {!!task.stale && tag((task.ageDays ?? 6) + '+ days', '#F5A623')}
    </View>
  );
}

export function Counts({ c }: { c: { given: number; done: number; left: number } }) {
  const t = useTheme();
  const box = (n: number, label: string, color: string) => (
    <View style={{ flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 12, backgroundColor: t.soft, marginHorizontal: 3 }}>
      <Text style={{ color, fontSize: 20, fontWeight: '800' }}>{n}</Text>
      <Text style={{ color: t.subtext, fontSize: 11 }}>{label}</Text>
    </View>
  );
  return (
    <View style={{ flexDirection: 'row', marginHorizontal: -3, marginTop: 8 }}>
      {box(c.given, 'Given today', t.text)}{box(c.done, 'Done', STATUS_COLOR.done)}{box(c.left, 'Left', STATUS_COLOR.todo)}
    </View>
  );
}

// Member's "My day": today's tasks (open + done today) with Done / In progress / Not started and "Submit sign-off".
// Used by the evening check-in card and the Tasks tab. Live: refetches on task events; local picks survive refreshes.
export default function MyDay({ compact }: { compact?: boolean }) {
  const t = useTheme();
  const [d, setD] = useState<CheckinToday | null>(peekCheckinToday());
  const [picks, setPicks] = useState<Record<number, StepStatus>>({});
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => { loadCheckinToday(true).then(() => setFailed(false)).catch(() => setFailed(true)); }, []);
  useEffect(() => {
    const off = onCheckinToday(setD);
    loadCheckinToday().catch(() => setFailed(true));
    return off;
  }, []);
  useLiveRefresh(load, ['task', 'tasks_purged', 'reset']);

  if (!d) {
    return failed
      ? <Text style={{ color: t.subtext, fontSize: 13, fontStyle: 'italic', marginTop: 6 }}>Could not load. Check your connection.</Text>
      : <ActivityIndicator color={t.accent} style={{ alignSelf: 'flex-start', marginVertical: 8 }} />;
  }
  const list = [...d.tasks, ...d.doneToday];
  const so = d.signoff.signoff;
  const cur = (x: DayTask) => picks[x.id] ?? norm(x.status);

  const submit = async () => {
    if (busy) return;
    setBusy(true); setErr('');
    try {
      const taskStatuses: Record<string, StepStatus> = {};
      for (const x of list) if (picks[x.id] && picks[x.id] !== norm(x.status)) taskStatuses[String(x.id)] = picks[x.id];
      await api('POST', '/checkins/signoff', { taskStatuses, note: note.trim() || undefined });
      setPicks({}); setNote('');
      await loadCheckinToday(true);
    } catch (e: any) { setErr(e.message || 'Could not submit'); }
    setBusy(false);
  };

  return (
    <View>
      <Counts c={d.counts} />
      {!list.length && <Text style={{ color: t.subtext, fontSize: 13, marginTop: 10 }}>No tasks for today.</Text>}
      {list.map((x) => (
        <View key={x.id} style={{ marginTop: 12 }}>
          <Text numberOfLines={compact ? 2 : 3} style={{ color: t.text, fontSize: 15, fontWeight: '600', textDecorationLine: cur(x) === 'done' ? 'line-through' : 'none' }}>
            {x.title}
          </Text>
          <Flags task={x} />
          <View style={{ marginTop: 6 }}>
            <StatusChips value={cur(x)} small onPick={(st) => setPicks((p) => ({ ...p, [x.id]: st }))} />
          </View>
        </View>
      ))}
      <TextInput
        value={note} onChangeText={setNote} multiline placeholder="Note (optional): any problems, plan for tomorrow..." placeholderTextColor={t.subtext}
        style={{ minHeight: 44, maxHeight: 120, backgroundColor: t.soft, color: t.text, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, fontSize: 14, marginTop: 14 }}
      />
      {!!err && <Text style={{ color: t.danger, fontSize: 13, marginTop: 6 }}>{err}</Text>}
      <Pressable
        onPress={submit} disabled={busy}
        style={{ flexDirection: 'row', minHeight: 48, borderRadius: 24, backgroundColor: t.accent, alignItems: 'center', justifyContent: 'center', marginTop: 12, opacity: busy ? 0.6 : 1 }}
      >
        <Ionicons name="checkmark-done" size={20} color="#fff" />
        <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15, marginLeft: 8 }}>
          {busy ? 'Sending...' : so ? 'Update sign-off' : 'Submit sign-off'}
        </Text>
      </Pressable>
      {!!so && (
        <Text style={{ color: t.accent, fontSize: 12, fontWeight: '600', textAlign: 'center', marginTop: 8 }}>
          Signed off ✓ {new Date(so.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · Done {so.counts.done} · Left {so.counts.left}
        </Text>
      )}
    </View>
  );
}
