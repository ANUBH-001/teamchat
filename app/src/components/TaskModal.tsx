import React, { useEffect, useState } from 'react';
import { Modal, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useTheme } from '../useTheme';
import { api } from '../api';
import { STATUSES, STATUS_COLOR, STATUS_LABEL, Status, Task, UserCount } from '../taskTypes';
import Chip from './Chip';

// Boss: create / edit / delete. Member (own task): status + undo only.
export default function TaskModal({ visible, task, people, isBoss, onClose, onDone }: {
  visible: boolean; task: Task | null; people: UserCount[]; isBoss: boolean;
  onClose: () => void; onDone: () => void;
}) {
  const t = useTheme();
  const [title, setTitle] = useState('');
  const [assignee, setAssignee] = useState<number | null>(null);
  const [due, setDue] = useState('');
  const [status, setStatus] = useState<Status>('todo');
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!visible) return;
    setTitle(task?.title ?? '');
    setAssignee(task?.assigneeId ?? null);
    setDue(task?.dueDate ?? '');
    setStatus(task?.status ?? 'todo');
    setErr('');
  }, [visible, task]);

  const run = async (fn: () => Promise<any>) => {
    try { await fn(); onDone(); onClose(); } catch (e: any) { setErr(e.message); }
  };
  const save = () => run(() => {
    if (!isBoss) return api('PATCH', '/tasks/' + task!.id, { status });
    const body = { title: title.trim(), assigneeId: assignee, dueDate: due.trim() || null, status };
    return task ? api('PATCH', '/tasks/' + task.id, body) : api('POST', '/tasks', body);
  });
  const input = { backgroundColor: t.background, color: t.text, borderRadius: 8, padding: 10, marginBottom: 10 };
  const btn = (label: string, onPress: () => void, color: string) => (
    <TouchableOpacity onPress={onPress} style={{ padding: 10, marginRight: 8 }}>
      <Text style={{ color, fontWeight: '600' }}>{label}</Text>
    </TouchableOpacity>
  );

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' }}>
        <ScrollView style={{ maxHeight: '85%', backgroundColor: t.card, borderTopLeftRadius: 16, borderTopRightRadius: 16 }}
          contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
          <Text style={{ color: t.text, fontSize: 17, fontWeight: '600', marginBottom: 10 }}>
            {task ? (isBoss ? 'Edit task' : task.title) : 'New task'}
          </Text>
          {isBoss && (
            <>
              <TextInput style={input} value={title} onChangeText={setTitle} placeholder="Title" placeholderTextColor={t.subtext} />
              <Text style={{ color: t.subtext, marginBottom: 4 }}>Assignee</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                {people.map((p) => <Chip key={p.id} label={p.name} active={assignee === p.id} onPress={() => setAssignee(p.id)} />)}
              </View>
              <TextInput style={[input, { marginTop: 8 }]} value={due} onChangeText={setDue}
                placeholder="Due date YYYY-MM-DD (optional)" placeholderTextColor={t.subtext} />
            </>
          )}
          {task && (
            <>
              <Text style={{ color: t.subtext, marginBottom: 4 }}>Status</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                {STATUSES.map((s) => <Chip key={s} label={STATUS_LABEL[s]} color={STATUS_COLOR[s]} active={status === s} onPress={() => setStatus(s)} />)}
              </View>
            </>
          )}
          {!!err && <Text style={{ color: '#D32F2F', marginVertical: 6 }}>{err}</Text>}
          <View style={{ flexDirection: 'row', marginTop: 12, alignItems: 'center' }}>
            {task && btn('Undo', () => run(() => api('POST', '/tasks/' + task.id + '/undo')), t.subtext)}
            {task && isBoss && btn('Delete', () => run(() => api('DELETE', '/tasks/' + task.id)), '#D32F2F')}
            <View style={{ flex: 1 }} />
            {btn('Cancel', onClose, t.subtext)}
            {btn('Save', save, t.accent)}
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}
