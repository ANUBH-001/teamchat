import React from 'react';
import { Text, View } from 'react-native';
import { colorOf, labelOf } from '../taskTypes';

// Any status string: new steps, closed, and legacy in_progress / review from old payloads.
export default function StatusPill({ status }: { status: string }) {
  return (
    <View style={{ backgroundColor: colorOf(status), borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 }}>
      <Text style={{ color: '#fff', fontSize: 11, fontWeight: '600' }}>{labelOf(status)}</Text>
    </View>
  );
}
