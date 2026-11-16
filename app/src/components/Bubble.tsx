import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { colorFor, Theme } from '../theme';
import Tick, { TickStatus } from './Tick';
import { Msg } from '../chatTypes';
import BotCard from './BotCard';
import SwipeReply from './SwipeReply';

export const timeOf = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

type Props = {
  msg: Msg;
  mine: boolean;
  showSender: boolean;
  status: TickStatus;
  t: Theme;
  onLongPress: (m: Msg) => void;
  onReply: (m: Msg) => void;
  onQuotePress: (id: number) => void;
  meId: number;
  isBoss: boolean;
  highlight: boolean;
};

function BubbleBase({ msg, mine, showSender, status, t, onLongPress, onReply, onQuotePress, meId, isBoss, highlight }: Props) {
  if (msg.type === 'bot') {
    return <BotCard msg={msg} t={t} meId={meId} isBoss={isBoss} time={timeOf(msg.createdAt)} onLongPress={onLongPress} />;
  }
  const rt = msg.deleted ? null : msg.replyTo;
  return (
    <SwipeReply enabled={!!msg.id && !msg.deleted} onReply={() => onReply(msg)} color={t.subtext}>
      <View
        style={{
          paddingHorizontal: 10, marginVertical: 2, alignItems: mine ? 'flex-end' : 'flex-start',
          backgroundColor: highlight ? 'rgba(37,211,102,0.25)' : 'transparent',
        }}
      >
        <Pressable
          onLongPress={() => onLongPress(msg)}
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
          {!!rt && (
            <Pressable
              onPress={() => onQuotePress(rt.id)}
              style={{
                borderLeftWidth: 4, borderLeftColor: t.accent, backgroundColor: 'rgba(0,0,0,0.08)',
                borderRadius: 4, paddingHorizontal: 8, paddingVertical: 4, marginBottom: 4,
              }}
            >
              <Text numberOfLines={1} style={{ color: t.accent, fontWeight: '700', fontSize: 12 }}>
                {rt.senderName || 'Message'}
              </Text>
              <Text
                numberOfLines={2}
                style={{ color: t.subtext, fontSize: 13, fontStyle: rt.deleted ? 'italic' : 'normal' }}
              >
                {rt.deleted ? 'This message was deleted' : rt.text}
              </Text>
            </Pressable>
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
    </SwipeReply>
  );
}

export default React.memo(BubbleBase);
