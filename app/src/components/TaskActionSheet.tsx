import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, Text, TextInput, View } from 'react-native';
import { useTheme } from '../useTheme';
import { useAuth } from '../auth';
import { api } from '../api';
import { canClose, canView, isAssignee, myStatusOf, STATUS_COLOR, STATUS_LABEL, StepStatus, Task } from '../taskTypes';
import { toast } from '../useVoiceInput';
import Sheet, { SheetRow } from './Sheet';
// Round 4: disabled (simple create->done): import StatusChips from './StatusChips';
import StatusChips from './DoneChips';
import PeoplePickSheet from './PeoplePickSheet';
import { AvatarStack } from './Avatar';

type Mode = 'main' | 'title' | 'desc' | 'note' | 'people';

// Quick actions on one task (check-in card rows, DM tasks sheet, long-press on a task row, chat cards):
// my status (done / pending: assignee or admin only), edit title, description, note, people (add / remove / replace, Me first), ask,
// open detail, close / reopen (admin only). Everything goes through REST; the server re-checks every permission (errors -> toast).
// startMode 'desc': open straight in the description editor (ask card "Description" button).
export default function TaskActionSheet({ visible, onClose, taskId, task: given, onOpen, onChanged, startMode }: {
  visible: boolean; onClose: () => void; taskId?: number | null; task?: Task | null;
  onOpen?: (id: number) => void; onChanged?: (task: Task) => void; startMode?: 'desc';
}) {
  const t = useTheme();
  const { user } = useAuth();
  const me = user!;
  const [task, setTask] = useState<Task | null>(given || null);
  const [mode, setMode] = useState<Mode>('main');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const id = given ? given.id : taskId || null;

  useEffect(() => {
    if (!visible) return;
    setMode(startMode || 'main'); setErr('');
    setText(startMode === 'desc' && given ? given.description || '' : '');
    setTask(given && given.assignees ? given : null);
    if (!id) return;
    api<{ task: Task }>('GET', '/tasks/' + id).then((r) => {
      setTask(r.task);
      if (startMode === 'desc') setText(r.task.description || '');
    }).catch((e) => setErr(e.message));
  }, [visible, id]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (method: string, path: string, body?: object, okMsg?: string) => {
    if (busy || !task) return;
    setBusy(true);
    try {
      const r = await api<{ task: Task }>(method, path, body);
      if (r && r.task) { setTask(r.task); onChanged?.(r.task); }
      if (okMsg) toast(okMsg);
      if (startMode === 'desc' && mode === 'desc') onClose(); else setMode('main'); // opened for the description: done
    } catch (e: any) { toast(e.message || 'Could not do that'); }
    setBusy(false);
  };
  const patch = (body: object, okMsg?: string) => run('PATCH', '/tasks/' + task!.id, body, okMsg);

  if (!visible) return null;
  const isBoss = me.role === 'boss';
  const mine = !!task && isAssignee(task, me);
  const creator = !!task && task.createdBy === me.id;
  const closed = task?.status === 'closed';
  const manage = !!task && (isBoss || creator || mine);
  const myStatus = task ? myStatusOf(task, me) : null;

  const editor = (label: string, multiline: boolean, onSave: (v: string) => void) => (
    <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
      <Text style={{ color: t.subtext, fontSize: 12, fontWeight: '700', marginBottom: 6 }}>{label}</Text>
      <TextInput value={text} onChangeText={setText} autoFocus multiline={multiline} placeholderTextColor={t.subtext}
        style={{ minHeight: multiline ? 88 : 46, maxHeight: 180, backgroundColor: t.soft, color: t.text, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, fontSize: 15, textAlignVertical: multiline ? 'top' : 'center' }} />
      <View style={{ flexDirection: 'row', marginTop: 10 }}>
        <Pressable onPress={() => setMode('main')} style={{ flex: 1, minHeight: 44, borderRadius: 22, backgroundColor: t.soft, alignItems: 'center', justifyContent: 'center', marginRight: 8 }}>
          <Text style={{ color: t.text, fontWeight: '600' }}>Back</Text>
        </Pressable>
        <Pressable onPress={() => onSave(text.trim())} style={{ flex: 1, minHeight: 44, borderRadius: 22, backgroundColor: t.accent, alignItems: 'center', justifyContent: 'center', opacity: busy ? 0.5 : 1 }}>
          <Text style={{ color: '#fff', fontWeight: '700' }}>{busy ? '...' : 'Save'}</Text>
        </Pressable>
      </View>
    </View>
  );

  const header = task && (
    <View style={{ paddingHorizontal: 20, paddingBottom: 10 }}>
      <Text style={{ color: t.text, fontSize: 17, fontWeight: '700' }} numberOfLines={3}>{task.title}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 6, flexWrap: 'wrap' }}>
        <Text style={{ color: t.subtext, fontSize: 12, marginRight: 8 }}>Task {task.id}</Text>
        <View style={{ backgroundColor: STATUS_COLOR[task.status], borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2, marginRight: 8 }}>
          <Text style={{ color: '#fff', fontSize: 11, fontWeight: '700' }}>{STATUS_LABEL[task.status]}</Text>
        </View>
        <AvatarStack people={task.assignees || []} size={20} />
      </View>
    </View>
  );

  const main = task && (
    <>
      {header}
      {mine && !closed && (
        <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
          <Text style={{ color: t.subtext, fontSize: 12, fontWeight: '700', marginBottom: 6 }}>MY STATUS</Text>
          <StatusChips value={myStatus} disabled={busy} onPick={(s: StepStatus) => patch({ status: s }, STATUS_LABEL[s])} />
        </View>
      )}
      {!mine && isBoss && !closed && (
        <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
          <Text style={{ color: t.subtext, fontSize: 12, fontWeight: '700', marginBottom: 6 }}>EVERYONE'S STATUS</Text>
          <StatusChips value={task.status} disabled={busy} onPick={(s: StepStatus) => patch({ status: s }, STATUS_LABEL[s])} />
        </View>
      )}
      {manage && !closed && <SheetRow icon="create-outline" label="Edit title" onPress={() => { setText(task.title); setMode('title'); }} />}
      {canView(task, me) && <SheetRow icon="document-text-outline" label="Description" onPress={() => { setText(task.description || ''); setMode('desc'); }} />}
      {canView(task, me) && <SheetRow icon="chatbox-ellipses-outline" label="Add a note" onPress={() => { setText(''); setMode('note'); }} />}
      {manage && !closed && <SheetRow icon="people-outline" label="People (add / remove / reassign)" onPress={() => setMode('people')} />}
      {onOpen && <SheetRow icon="open-outline" label="Open task" onPress={() => { onClose(); onOpen(task.id); }} />}
      {canClose(task, me) && !closed && (
        <SheetRow icon="close-circle-outline" label="Close task" danger onPress={() => Alert.alert('Close task', 'Close "' + task.title + '"?', [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Close', style: 'destructive', onPress: () => run('POST', '/tasks/' + task.id + '/close', {}, 'Closed') },
        ])} />
      )}
      {canClose(task, me) && closed && <SheetRow icon="refresh-outline" label="Reopen" onPress={() => run('POST', '/tasks/' + task.id + '/reopen', {}, 'Reopened')} />}
    </>
  );

  return (
    <>
      <Sheet visible={visible && mode !== 'people'} onClose={onClose}>
        {!task && (err ? <Text style={{ color: t.danger, padding: 20 }}>{err}</Text> : <ActivityIndicator color={t.accent} style={{ margin: 24 }} />)}
        {task && mode === 'main' && main}
        {task && mode === 'title' && editor('TITLE', false, (v) => (v ? patch({ title: v }, 'Saved') : null))}
        {task && mode === 'desc' && editor('DESCRIPTION', true, (v) => patch({ description: v || null }, 'Saved'))}
        {task && mode === 'note' && editor('NOTE', true, (v) => (v ? patch({ note: v }, 'Note added') : null))}
      </Sheet>
      {task && (
        <PeoplePickSheet
          visible={visible && mode === 'people'} onClose={() => setMode('main')} title={'People on Task ' + task.id} meId={me.id}
          initial={(task.assignees || []).map((a) => a.id)}
          onSave={(ids) => patch({ assigneeIds: ids }, 'Saved')}
        />
      )}
    </>
  );
}

