import React, { useState } from 'react';
import { View, Text, Pressable, Alert } from 'react-native';
import { Theme } from '../theme';
import { api } from '../api';
import { Msg, BotPayload } from '../chatTypes';
import StatusPill from './StatusPill';

const ACTION_LABEL = { created: 'Task assigned', completed: 'Task done', updated: 'Task updated' };
const SECTIONS: { key: 'done' | 'in_progress' | 'todo'; label: string }[] = [
  { key: 'done', label: 'Done' }, { key: 'in_progress', label: 'In progress' }, { key: 'todo', label: 'Pending' },
];

type Props = { msg: Msg; t: Theme; meId: number; isBoss: boolean; time: string; onLongPress: (m: Msg) => void };

// Team Assistant message: task card (with Undo), bullet summary, or a plain question/info bubble.
function BotCardBase({ msg, t, meId, isBoss, time, onLongPress }: Props) {
  const [undone, setUndone] = useState(false);
  const [busy, setBusy] = useState(false);
  const p = msg.payload as BotPayload | null | undefined;

  const undo = async () => {
    if (!p || p.kind !== 'task' || busy) return;
    setBusy(true);
    try {
      if (p.undo === 'delete') await api('DELETE', '/tasks/' + p.task.id);
      else await api('POST', '/tasks/' + p.task.id + '/undo');
      setUndone(true);
    } catch (e: any) {
      Alert.alert('Could not undo', e.message);
    } finally {
      setBusy(false);
    }
  };

  let body: React.ReactNode;
  if (msg.deleted) {
    body = <Text style={{ color: t.subtext, fontStyle: 'italic', fontSize: 15 }}>This message was deleted</Text>;
  } else if (p && p.kind === 'task') {
    // create undo = delete task (boss only); status undo = boss or assignee
    const canUndo = !!p.undo && !undone && (isBoss || (p.undo === 'status' && p.task.assigneeId === meId));
    body = (
      <View>
        <Text style={{ color: t.subtext, fontSize: 12, marginBottom: 4 }}>{ACTION_LABEL[p.action]}</Text>
        <Text style={{ color: t.text, fontSize: 15, fontWeight: '600' }}>{p.task.title}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4, flexWrap: 'wrap' }}>
          <Text style={{ color: t.subtext, fontSize: 13, marginRight: 8 }}>
            {p.task.assigneeName || 'Unassigned'}{p.task.dueDate ? '  ·  due ' + p.task.dueDate : ''}
          </Text>
          {!undone && <StatusPill status={p.task.status} />}
        </View>
        {undone && <Text style={{ color: t.subtext, fontSize: 13, marginTop: 6, fontStyle: 'italic' }}>Undone</Text>}
        {canUndo && (
          <Pressable onPress={undo} disabled={busy} style={{ marginTop: 8, alignSelf: 'flex-start', borderWidth: 1, borderColor: t.accent, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 4 }}>
            <Text style={{ color: t.accent, fontWeight: '600', fontSize: 13 }}>{busy ? '...' : 'Undo'}</Text>
          </Pressable>
        )}
      </View>
    );
  } else if (p && p.kind === 'summary') {
    body = (
      <View>
        <Text style={{ color: t.text, fontSize: 15, fontWeight: '600', marginBottom: 4 }}>{p.userName}'s tasks</Text>
        {SECTIONS.map((s) => (
          <View key={s.key} style={{ marginBottom: 4 }}>
            <Text style={{ color: t.subtext, fontSize: 13, fontWeight: '600' }}>{s.label} ({p.counts[s.key]})</Text>
            {p[s.key].map((i) => (
              <Text key={i.id} style={{ color: t.text, fontSize: 14 }}>
                {'• ' + i.title + (i.dueDate ? '  (' + i.dueDate + ')' : '')}
              </Text>
            ))}
            {p.counts[s.key] > p[s.key].length && (
              <Text style={{ color: t.subtext, fontSize: 12 }}>+{p.counts[s.key] - p[s.key].length} more in Tasks tab</Text>
            )}
          </View>
        ))}
      </View>
    );
  } else {
    // clarify / info / unknown payload: show the plain text the server stored
    body = <Text style={{ color: t.text, fontSize: 15 }}>{msg.text}</Text>;
  }

  return (
    <View style={{ paddingHorizontal: 10, marginVertical: 2, alignItems: 'flex-start' }}>
      <Pressable
        onLongPress={() => onLongPress(msg)}
        style={{ maxWidth: '85%', minWidth: '55%', paddingHorizontal: 10, paddingVertical: 7, borderRadius: 8, backgroundColor: t.bubbleIn, borderLeftWidth: 3, borderLeftColor: t.accent }}
      >
        <Text style={{ color: t.accent, fontWeight: '700', fontSize: 13, marginBottom: 3 }}>Team Assistant</Text>
        {body}
        <Text style={{ color: t.subtext, fontSize: 11, alignSelf: 'flex-end', marginTop: 2 }}>{time}</Text>
      </Pressable>
    </View>
  );
}

export default React.memo(BotCardBase);
