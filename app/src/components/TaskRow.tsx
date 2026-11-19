import React from 'react';
import { Text, Pressable, View } from 'react-native';
import { useTheme } from '../useTheme';
import { OVERDUE_COLOR, Task, assigneeNamesOf } from '../taskTypes';
import { formatDue } from '../dates';
import StatusPill from './StatusPill';
import { AvatarStack } from './Avatar';

export const ROW_H = 72;

function TaskRowBase({ task, onPress, onLongPress }: { task: Task; onPress: (t: Task) => void; onLongPress?: (t: Task) => void }) {
  const t = useTheme();
  const closed = task.status === 'closed';
  const done = task.status === 'done';
  const late = task.overdue && !done && !closed;
  const people = task.assignees || [];
  return (
    <Pressable
      onPress={() => onPress(task)}
      onLongPress={onLongPress ? () => onLongPress(task) : undefined}
      android_ripple={{ color: t.border }}
      style={{
        flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, height: ROW_H, backgroundColor: t.card,
        borderBottomWidth: 1, borderBottomColor: t.border, opacity: closed ? 0.6 : 1,
      }}
    >
      <View style={{ flex: 1, marginRight: 12 }}>
        <Text numberOfLines={2} style={{ color: t.text, fontSize: 15, textDecorationLine: done || closed ? 'line-through' : 'none' }}>
          {task.title}
        </Text>
        <Text numberOfLines={1} style={{ color: late ? t.danger : t.subtext, fontSize: 12, marginTop: 3 }}>
          #{task.id}{task.project ? '  ·  ' + task.project : ''}{!people.length ? '  ·  ' + (assigneeNamesOf(task)[0] || 'Unassigned') : ''}{task.dueDate ? '  ·  ' + formatDue(task.dueDate) : ''}
        </Text>
      </View>
      {!!task.stale && !closed && (
        <View style={{ backgroundColor: OVERDUE_COLOR, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 1, marginRight: 6 }}>
          <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700' }}>{task.ageDays}d</Text>
        </View>
      )}
      {people.length > 0 && <View style={{ marginRight: 8 }}><AvatarStack people={people} size={24} max={3} /></View>}
      <StatusPill status={task.status} />
    </Pressable>
  );
}

export default React.memo(
  TaskRowBase,
  (a, b) => a.task.id === b.task.id && a.task.updatedAt === b.task.updatedAt && a.task.status === b.task.status && a.onPress === b.onPress && a.onLongPress === b.onLongPress,
);
