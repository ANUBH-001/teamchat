import React from 'react';
import { Text } from 'react-native';
import { tickRead } from '../theme';

export type TickStatus = 'pending' | 'sent' | 'delivered' | 'read';

export default function Tick({ status, color }: { status: TickStatus; color: string }) {
  const glyph = status === 'pending' ? '◷' : status === 'sent' ? '✓' : '✓✓';
  return (
    <Text style={{ color: status === 'read' ? tickRead : color, fontSize: 12, marginLeft: 4 }}>{glyph}</Text>
  );
}
