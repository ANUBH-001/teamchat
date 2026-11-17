import React, { useState } from 'react';
import { Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { useTheme } from '../useTheme';
import { OVERDUE_COLOR, STATUSES, STATUS_COLOR, STATUS_LABEL, Task } from '../taskTypes';
import { formatDue } from '../dates';
import Avatar from './Avatar';

const Card = React.memo(function Card({ task, onPress }: { task: Task; onPress: (id: number) => void }) {
  const t = useTheme();
  const late = task.overdue && task.status !== 'done';
  return (
    <Pressable
      onPress={() => onPress(task.id)}
      style={{ backgroundColor: t.card, borderRadius: 12, padding: 12, marginBottom: 8, borderLeftWidth: 3, borderLeftColor: late ? t.danger : STATUS_COLOR[task.status] }}
    >
      <Text numberOfLines={3} style={{ color: t.text, fontSize: 14, fontWeight: '600' }}>{task.title}</Text>
      {!!task.project && (
        <View style={{ alignSelf: 'flex-start', backgroundColor: t.soft, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2, marginTop: 6 }}>
          <Text style={{ color: t.subtext, fontSize: 11, fontWeight: '600' }}>{task.project}</Text>
        </View>
      )}
      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8 }}>
        {task.assigneeId ? <Avatar name={task.assigneeName || '?'} id={task.assigneeId} size={22} /> : null}
        <Text numberOfLines={1} style={{ flex: 1, color: t.subtext, fontSize: 12, marginLeft: task.assigneeId ? 6 : 0 }}>{task.assigneeName || 'Unassigned'}</Text>
        {!!task.dueDate && <Text style={{ color: late ? t.danger : t.subtext, fontSize: 11, fontWeight: late ? '700' : '400' }}>{formatDue(task.dueDate)}</Text>}
      </View>
    </Pressable>
  );
});

// Horizontal Kanban: Todo | Doing | Testing | Done. Tap a card for the detail (status buttons live there).
export default function TaskBoard({ tasks, onOpen }: { tasks: Task[]; onOpen: (id: number) => void }) {
  const t = useTheme();
  const { width } = useWindowDimensions();
  const colW = Math.min(280, Math.round(width * 0.78));
  const [h, setH] = useState(0); // columns need a fixed height so each can scroll on its own
  return (
    <ScrollView
      horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ padding: 12 }} style={{ flex: 1 }}
      onLayout={(e) => setH(e.nativeEvent.layout.height)}
    >
      {STATUSES.map((s) => {
        const list = tasks.filter((x) => x.status === s);
        const shown = s === 'done' ? list.slice(0, 30) : list;
        return (
          <View key={s} style={{ width: colW, height: Math.max(200, h - 24), marginRight: 12, backgroundColor: t.soft, borderRadius: 16, padding: 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 6, paddingVertical: 8 }}>
              <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: STATUS_COLOR[s], marginRight: 8 }} />
              <Text style={{ color: t.text, fontWeight: '700', fontSize: 14, flex: 1 }}>{STATUS_LABEL[s]}</Text>
              <Text style={{ color: t.subtext, fontSize: 13 }}>{list.length}</Text>
            </View>
            <ScrollView nestedScrollEnabled showsVerticalScrollIndicator={false}>
              {shown.map((x) => <Card key={x.id} task={x} onPress={onOpen} />)}
              {!shown.length && <Text style={{ color: t.subtext, fontSize: 13, textAlign: 'center', padding: 16 }}>Empty</Text>}
            </ScrollView>
          </View>
        );
      })}
    </ScrollView>
  );
}
