import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../useTheme';
import { useAuth } from '../auth';
import { api } from '../api';
import { AnyTask, assigneeNamesOf, colorOf, isBrief, labelOf } from '../taskTypes';
import Sheet from './Sheet';
import TaskActionSheet from './TaskActionSheet';
import TaskModal from './TaskModal';

type Seg = 'shared' | 'theirs';

// DM task button: tasks shared by me and the other person ("Shared"), and their tasks ("Unke tasks"; brief rows for
// tasks I cannot open). Rows open TaskActionSheet; footer makes a new task for them (TaskModal, prefilled).
export default function DmTasksSheet({ visible, onClose, otherUserId, name, chatId, onOpenTask }: {
  visible: boolean; onClose: () => void; otherUserId: number; name: string; chatId: number; onOpenTask: (id: number) => void;
}) {
  const t = useTheme();
  const { user } = useAuth();
  const me = user!;
  const [seg, setSeg] = useState<Seg>('shared');
  const [tasks, setTasks] = useState<AnyTask[] | null>(null);
  const [err, setErr] = useState('');
  const [actionId, setActionId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const first = name.trim().split(/\s+/)[0] || name;

  const load = useCallback(async () => {
    setTasks(null); setErr('');
    const path = seg === 'shared'
      ? '/tasks?with=' + otherUserId
      : '/tasks?scope=' + (me.role === 'boss' ? 'all' : 'everyone') + '&assignee=' + otherUserId;
    try { setTasks((await api<{ tasks: AnyTask[] }>('GET', path)).tasks || []); }
    catch (e: any) { setErr(e.message || 'Load nahi hua'); setTasks([]); }
  }, [seg, otherUserId, me.role]);

  useEffect(() => { if (visible && !actionId && !creating) load(); }, [visible, seg]); // eslint-disable-line react-hooks/exhaustive-deps

  const segBtn = (k: Seg, label: string) => (
    <Pressable
      key={k} onPress={() => setSeg(k)}
      style={{ flex: 1, minHeight: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: seg === k ? t.accent : 'transparent' }}
    >
      <Text style={{ color: seg === k ? '#fff' : t.text, fontWeight: '600', fontSize: 13 }}>{label}</Text>
    </Pressable>
  );

  return (
    <>
      <Sheet visible={visible && !actionId && !creating} onClose={onClose} title={'Tasks · ' + name}>
        <View style={{ flexDirection: 'row', marginHorizontal: 16, marginBottom: 8, backgroundColor: t.soft, borderRadius: 20, padding: 3 }}>
          {segBtn('shared', 'Shared')}
          {segBtn('theirs', 'Unke tasks')}
        </View>
        {!tasks && <ActivityIndicator color={t.accent} style={{ margin: 20 }} />}
        {!!err && <Text style={{ color: t.danger, paddingHorizontal: 20, paddingBottom: 6 }}>{err}</Text>}
        {tasks && !tasks.length && !err && <Text style={{ color: t.subtext, padding: 20, textAlign: 'center' }}>Koi task nahi</Text>}
        {(tasks || []).map((x) => {
          const brief = isBrief(x);
          return (
            <Pressable
              key={x.id} disabled={brief} onPress={() => setActionId(x.id)} android_ripple={{ color: t.border }}
              style={{ flexDirection: 'row', alignItems: 'center', minHeight: 54, paddingHorizontal: 20, paddingVertical: 6 }}
            >
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colorOf(x.status), marginRight: 12 }} />
              <View style={{ flex: 1 }}>
                <Text numberOfLines={2} style={{ color: t.text, fontSize: 15 }}>{x.title}</Text>
                <Text numberOfLines={1} style={{ color: t.subtext, fontSize: 12 }}>
                  {'#' + x.id + '  ·  ' + labelOf(x.status) + '  ·  ' + (assigneeNamesOf(x).join(', ') || 'Unassigned')}
                </Text>
              </View>
              {brief
                ? <Ionicons name="lock-closed-outline" size={16} color={t.subtext} />
                : <Ionicons name="chevron-forward" size={18} color={t.subtext} />}
            </Pressable>
          );
        })}
        <Pressable
          onPress={() => setCreating(true)}
          style={{ flexDirection: 'row', margin: 16, minHeight: 48, borderRadius: 24, backgroundColor: t.accent, alignItems: 'center', justifyContent: 'center' }}
        >
          <Ionicons name="add" size={20} color="#fff" />
          <Text style={{ color: '#fff', fontWeight: '700', marginLeft: 6 }}>Naya task for {first}</Text>
        </Pressable>
      </Sheet>
      {!!actionId && (
        <TaskActionSheet
          visible={!!actionId} taskId={actionId}
          onClose={() => { setActionId(null); load(); }}
          onOpen={(id) => { setActionId(null); onClose(); onOpenTask(id); }}
        />
      )}
      {creating && (
        <TaskModal
          visible={creating} meId={me.id} initialAssigneeIds={[otherUserId]} chatId={chatId} title={'Naya task for ' + first}
          onClose={() => setCreating(false)}
          onDone={() => { setCreating(false); load(); }}
        />
      )}
    </>
  );
}
