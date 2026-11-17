import React from 'react';
import { View, Text } from 'react-native';
import { colorFor } from '../theme';

export function initials(name: string) {
  const first = (w?: string) => Array.from(w ?? '').find((c) => /[\p{L}\p{N}]/u.test(c)) ?? '';
  const p = name.trim().split(/\s+/).filter((w) => first(w));
  return ((first(p[0]) || '?') + (p.length > 1 ? first(p[p.length - 1]) : '')).toUpperCase();
}

function AvatarBase({ name, id, size = 48 }: { name: string; id: number; size?: number }) {
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

export default React.memo(AvatarBase);
