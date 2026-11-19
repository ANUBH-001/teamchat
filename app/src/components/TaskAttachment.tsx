import React from 'react';
import { View } from 'react-native';
import { Theme } from '../theme';
import { Msg } from '../chatTypes';
import BotCard from './BotCard';

const timeOf = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

// Bot cards caused by one message, shown under that message's bubble in a bracket (All filter): compact task card
// (event icon, title, status pill, people, Open / Undo / Praise), ask card with its buttons, pickers, errors.
// Long-press a card = the normal message menu for that card (Reply / Pin / Delete for my ephemeral ones).
export default function TaskAttachments({ cards, mine, t, meId, isBoss, onLongPress, onOpenTask, onSendText, onPrefill, onReply }: {
  cards: Msg[]; mine: boolean; t: Theme; meId: number; isBoss: boolean;
  onLongPress: (m: Msg) => void; onOpenTask: (id: number) => void; onSendText: (text: string, mentionIds?: number[]) => void;
  onPrefill?: (text: string) => void; onReply: (m: Msg) => void;
}) {
  return (
    <View
      style={{
        width: '85%', maxWidth: 420, marginTop: 2, paddingLeft: mine ? 0 : 8, paddingRight: mine ? 8 : 0,
        borderLeftWidth: mine ? 0 : 2, borderRightWidth: mine ? 2 : 0, borderColor: t.border,
      }}
    >
      {cards.map((c) => (
        <BotCard
          key={c.clientId || String(c.id)} msg={c} t={t} meId={meId} isBoss={isBoss} time={timeOf(c.createdAt)} compact
          onLongPress={onLongPress} onOpenTask={onOpenTask} onSendText={onSendText} onPrefill={onPrefill} onReply={onReply}
        />
      ))}
    </View>
  );
}
