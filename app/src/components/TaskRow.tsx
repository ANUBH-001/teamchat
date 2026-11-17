import React from 'react';
import { Text, Pressable, View } from 'react-native';
import { useTheme } from '../useTheme';
import { OVERDUE_COLOR, Task } from '../taskTypes';
import { formatDue } from '../dates';
import StatusPill from './StatusPill';

function TaskRowBase({ task, onPress }: { task: Task; onPress: (t: Task) => void }) {
  const t = useTheme();
  const late = task.overdue && task.status !== 'done';
  return (
    <Pressable
      onPress={() => onPress(task)}
      android_ripple={{ color: t.border }}
      style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, minHeight: 64, backgroundColor: t.card, borderBottomWidth: 1, borderBottomColor: t.border }}
    >
      <View style={{ flex: 1, marginRight: 12 }}>
        <Text numberOfLines={2} style={{ color: t.text, fontSize: 15, textDecorationLine: task.status === 'done' ? 'line-through' : 'none' }}>
          {task.title}
        </Text>
        <Text numberOfLines={1} style={{ color: late ? t.danger : t.subtext, fontSize: 12, marginTop: 3 }}>
          {task.project ? task.project + '  ·  ' : ''}{task.assigneeName ?? 'Unassigned'}{task.dueDate ? '  ·  ' + formatDue(task.dueDate) : ''}
        </Text>
      </View>
      <StatusPill status={task.status} />
    </Pressable>
  );
}

export default React.memo(TaskRowBase);
