import React from 'react';
import { Text, TouchableOpacity } from 'react-native';
import { useTheme } from '../useTheme';

export default function Chip({ label, active, onPress, color }: {
  label: string; active?: boolean; onPress?: () => void; color?: string;
}) {
  const t = useTheme();
  const c = color ?? t.accent;
  return (
    <TouchableOpacity
      onPress={onPress}
      style={{
        paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, marginRight: 8, marginVertical: 4,
        backgroundColor: active ? c : t.card, borderWidth: 1, borderColor: active ? c : t.border,
      }}
    >
      <Text style={{ color: active ? '#fff' : t.text, fontSize: 13 }}>{label}</Text>
    </TouchableOpacity>
  );
}
