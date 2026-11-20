import React from 'react';
import { Text } from 'react-native';
import { tickRead, tickReadOnBubble } from '../theme';

export type TickStatus = 'pending' | 'failed' | 'sent' | 'delivered' | 'read';

// Failed (server rejected it): a warning + how to retry, never ticks (red ✓✓ read as "delivered" on the device test).
export default function Tick({ status, color, onBubble }: { status: TickStatus; color: string; onBubble?: boolean }) {
  if (status === 'failed') {
    return <Text style={{ color: '#ff5252', fontSize: 12, fontWeight: '700', marginLeft: 4 }}>{'⚠ Not sent · Tap to retry'}</Text>;
  }
  const glyph = status === 'pending' ? '◷' : status === 'sent' ? '✓' : '✓✓';
  return (
    <Text style={{ color: status === 'read' ? (onBubble ? tickReadOnBubble : tickRead) : color, fontSize: 12, marginLeft: 4 }}>{glyph}</Text>
  );
}
