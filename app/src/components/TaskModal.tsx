import React, { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../useTheme';
import { api } from '../api';
import { UserCount } from '../taskTypes';
import { isoDay } from '../screens/TaskDetailScreen';
import Chip from './Chip';

// Create a task: boss, or any member while the "members can assign" setting is on (members default to themselves).
export default function TaskModal({ visible, people, meId, onClose, onDone }: {
  visible: boolean; people: UserCount[]; meId: number; onClose: () => void; onDone: () => void;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [title, setTitle] = useState('');
  const [project, setProject] = useState('');
  const [assignee, setAssignee] = useState<number | null>(null);
  const [due, setDue] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setTitle(''); setProject(''); setAssignee(meId); setDue(''); setErr(''); setBusy(false);
  }, [visible, meId]);

  const save = async () => {
    if (!title.trim() || busy) return;
    if (due && !/^\d{4}-\d{2}-\d{2}$/.test(due.trim())) { setErr('Due date: use YYYY-MM-DD'); return; }
    setBusy(true);
    try {
      await api('POST', '/tasks', {
        title: title.trim(), project: project.trim() || null, assigneeId: assignee, dueDate: due.trim() || null,
      });
      onDone(); onClose();
    } catch (e: any) { setErr(e.message); setBusy(false); }
  };
  const input = { backgroundColor: t.soft, color: t.text, borderRadius: 12, paddingHorizontal: 14, minHeight: 48, fontSize: 15, marginBottom: 12 } as const;
  const label = { color: t.subtext, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', marginBottom: 6 } as const;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' }}>
        <ScrollView
          style={{ maxHeight: '90%', backgroundColor: t.card, borderTopLeftRadius: 20, borderTopRightRadius: 20 }}
          contentContainerStyle={{ padding: 20, paddingBottom: 20 + insets.bottom }} keyboardShouldPersistTaps="handled"
        >
          <Text style={{ color: t.text, fontSize: 18, fontWeight: '700', marginBottom: 16 }}>New task</Text>
          <TextInput style={input} value={title} onChangeText={setTitle} placeholder="What needs to be done?" placeholderTextColor={t.subtext} />
          <TextInput style={input} value={project} onChangeText={setProject} placeholder="Project (optional)" placeholderTextColor={t.subtext} />
          <Text style={label}>Assign to</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 8 }}>
            {people.map((p) => <Chip key={p.id} label={p.id === meId ? 'Me' : p.name} active={assignee === p.id} onPress={() => setAssignee(p.id)} />)}
          </View>
          <Text style={label}>Due</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            <Chip label="Today" active={due === isoDay(0)} onPress={() => setDue(isoDay(0))} />
            <Chip label="Tomorrow" active={due === isoDay(1)} onPress={() => setDue(isoDay(1))} />
            <Chip label="In 3 days" active={due === isoDay(3)} onPress={() => setDue(isoDay(3))} />
            <Chip label="None" active={!due} onPress={() => setDue('')} />
          </View>
          <TextInput style={[input, { marginTop: 8 }]} value={due} onChangeText={setDue} placeholder="YYYY-MM-DD" placeholderTextColor={t.subtext} />
          {!!err && <Text style={{ color: t.danger, marginBottom: 8 }}>{err}</Text>}
          <View style={{ flexDirection: 'row', marginTop: 4 }}>
            <Pressable onPress={onClose} style={{ flex: 1, minHeight: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: t.soft, marginRight: 8 }}>
              <Text style={{ color: t.text, fontWeight: '600' }}>Cancel</Text>
            </Pressable>
            <Pressable onPress={save} style={{ flex: 1, minHeight: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: t.accent, opacity: title.trim() && !busy ? 1 : 0.5 }}>
              <Text style={{ color: '#fff', fontWeight: '700' }}>{busy ? '...' : 'Create'}</Text>
            </Pressable>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}
