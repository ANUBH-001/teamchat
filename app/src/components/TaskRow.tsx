import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { useTheme } from '../useTheme';
import { Task } from '../taskTypes';
import StatusPill from './StatusPill';

export default function TaskRow({ task, onPress }: { task: Task; onPress: () => void }) {
  const t = useTheme();
  return (
    <TouchableOpacity
      onPress={onPress}
      style={{ flexDirection: 'row', alignItems: 'center', padding: 12, backgroundColor: t.card,
        borderBottomWidth: 1, borderBottomColor: t.border }}
    >
      <View style={{ flex: 1, marginRight: 8 }}>
        <Text style={{ color: t.text, fontSize: 15, textDecorationLine: task.status === 'done' ? 'line-through' : 'none' }}>
          {task.title}
        </Text>
        <Text style={{ color: t.subtext, fontSize: 12, marginTop: 2 }}>
          {task.assigneeName ?? 'Unassigned'}{task.dueDate ? '  ·  due ' + task.dueDate : ''}
        </Text>
      </View>
      <StatusPill status={task.status} />
    </TouchableOpacity>
  );
}
