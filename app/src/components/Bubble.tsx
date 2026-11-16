import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { colorFor, Theme } from '../theme';
import Tick, { TickStatus } from './Tick';
import { Msg } from '../chatTypes';
import BotCard from './BotCard';

export const timeOf = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

type Props = {
  msg: Msg;
  mine: boolean;
  showSender: boolean;
  status: TickStatus;
  t: Theme;
  onLongPress: () => void;
  meId: number;
  isBoss: boolean;
};

export default function Bubble({ msg, mine, showSender, status, t, onLongPress, meId, isBoss }: Props) {
  if (msg.type === 'bot') {
    return <BotCard msg={msg} t={t} meId={meId} isBoss={isBoss} time={timeOf(msg.createdAt)} onLongPress={onLongPress} />;
  }
  return (
    <View style={{ paddingHorizontal: 10, marginVertical: 2, alignItems: mine ? 'flex-end' : 'flex-start' }}>
      <Pressable
        onLongPress={onLongPress}
        style={{
          maxWidth: '80%', paddingHorizontal: 9, paddingVertical: 6, borderRadius: 8,
          backgroundColor: mine ? t.bubbleOut : t.bubbleIn,
        }}
      >
        {showSender && !mine && (
          <Text style={{ color: colorFor(msg.senderId), fontWeight: '600', fontSize: 13, marginBottom: 2 }}>
            {msg.senderName}
          </Text>
        )}
        <Text
          style={{
            color: msg.deleted ? t.subtext : t.text, fontSize: 15,
            fontStyle: msg.deleted ? 'italic' : 'normal',
          }}
        >
          {msg.deleted ? 'This message was deleted' : msg.text}
        </Text>
        <View style={{ flexDirection: 'row', alignSelf: 'flex-end', alignItems: 'center', marginTop: 2 }}>
          <Text style={{ color: t.subtext, fontSize: 11 }}>{timeOf(msg.createdAt)}</Text>
          {mine && !msg.deleted && <Tick status={status} color={t.subtext} />}
        </View>
      </Pressable>
    </View>
  );
}
