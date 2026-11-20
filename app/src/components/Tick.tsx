import React from 'react';
import { Text } from 'react-native';
import { tickRead, tickReadOnBubble } from '../theme';

export type TickStatus = 'pending' | 'failed' | 'sent' | 'delivered' | 'read';

export default function Tick({ status, color, onBubble }: { status: TickStatus; color: string; onBubble?: boolean }) {
  const glyph = status === 'pending' ? '◷' : status === 'sent' ? '✓' : '✓✓';
  return (
    <Text style={{ color: status === 'failed' ? '#ff5252' : status === 'read' ? (onBubble ? tickReadOnBubble : tickRead) : color, fontSize: 12, marginLeft: 4 }}>{glyph}</Text>
  );
}
