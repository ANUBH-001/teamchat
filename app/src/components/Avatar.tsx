import React from 'react';
import { View, Text } from 'react-native';
import { colorFor } from '../theme';

export function initials(name: string) {
  const p = name.trim().split(/\s+/);
  return ((p[0]?.[0] ?? '?') + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase();
}

export default function Avatar({ name, id, size = 48 }: { name: string; id: number; size?: number }) {
  return (
    <View
      style={{
        width: size, height: size, borderRadius: size / 2,
        backgroundColor: colorFor(id), alignItems: 'center', justifyContent: 'center',
      }}
    >
      <Text style={{ color: '#fff', fontWeight: '600', fontSize: size * 0.38 }}>{initials(name)}</Text>
    </View>
  );
}
