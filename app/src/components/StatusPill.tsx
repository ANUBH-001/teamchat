import React from 'react';
import { Text, View } from 'react-native';
import { Status, STATUS_COLOR, STATUS_LABEL } from '../taskTypes';

export default function StatusPill({ status }: { status: Status }) {
  return (
    <View style={{ backgroundColor: STATUS_COLOR[status], borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 }}>
      <Text style={{ color: '#fff', fontSize: 11, fontWeight: '600' }}>{STATUS_LABEL[status]}</Text>
    </View>
  );
}
