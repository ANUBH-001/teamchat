import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colorFor, dark, tintFor, Theme } from '../theme';
import Tick, { TickStatus } from './Tick';
import { Msg } from '../chatTypes';
import BotCard from './BotCard';
import CheckinCard from './CheckinCard';
import SwipeReply from './SwipeReply';
import SystemPill from './SystemPill';
import RichText from './RichText';

// Bot cards about one task (kind 'task' | 'ask'): replying to them updates that task (server: commands.handleReply).
export const isTaskCard = (m: Msg) => {
  const p = m.type === 'bot' && m.payload ? (m.payload as { kind?: string; task?: { id?: number } }) : null;
  return !!p && (p.kind === 'task' || p.kind === 'ask') && !!p.task?.id && m.visibleTo == null;
};

export const timeOf = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

type Props = {
  msg: Msg;
  mine: boolean;
  showSender: boolean; // group / All Team: per-user color tint + name
  status: TickStatus;
  t: Theme;
  onLongPress: (m: Msg) => void;
  onReply: (m: Msg) => void;
  onQuotePress: (id: number) => void;
  onReact: (m: Msg, emoji: string) => void;
  onOpenTask: (id: number) => void;
  onSendText: (text: string, mentionIds?: number[]) => void;
  onPrefill?: (text: string) => void; // put text into the composer (ask card "Update")
  meId: number;
  meName: string;
  isBoss: boolean;
  highlight: boolean;
  onCardMic?: (cb: (said: string) => void) => void;
};

function BubbleBase({
  msg, mine, showSender, status, t, onLongPress, onReply, onQuotePress, onReact, onOpenTask, onSendText, onPrefill, meId, meName, isBoss, highlight, onCardMic,
}: Props) {
  if (msg.type === 'system') return <SystemPill text={msg.text || ''} t={t} />;
  if (msg.type === 'checkin_prompt' && !msg.deleted && msg.payload) {
    return <CheckinCard msg={msg} t={t} time={timeOf(msg.createdAt)} onMic={onCardMic} onLongPress={onLongPress} onOpenTask={onOpenTask} />;
  }
  if (msg.type === 'bot') {
    const card = (
      <BotCard msg={msg} t={t} meId={meId} isBoss={isBoss} time={timeOf(msg.createdAt)} onLongPress={onLongPress}
        onOpenTask={onOpenTask} onSendText={onSendText} onPrefill={onPrefill} />
    );
    // task / ask cards: swipe right to reply (the server adds the reply as a note, "desc: ..." = description)
    if (!isTaskCard(msg)) return card;
    return <SwipeReply enabled={!!msg.id && !msg.deleted} onReply={() => onReply(msg)} color={t.subtext}>{card}</SwipeReply>;
  }
  const rt = msg.deleted ? null : msg.replyTo;
  const tinted = showSender && !mine;
  const reactions = msg.deleted ? [] : (msg.reactions ?? []).filter((r) => r.userIds.length > 0);
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
            maxWidth: '80%', paddingHorizontal: 9, paddingVertical: 6, borderRadius: 10,
            backgroundColor: mine ? t.bubbleOut : tinted ? tintFor(msg.senderId, t === dark) : t.bubbleIn,
            borderLeftWidth: tinted ? 3 : 0, borderLeftColor: tinted ? colorFor(msg.senderId) : 'transparent',
          }}
        >
          {showSender && !mine && (
            <Text style={{ color: colorFor(msg.senderId), fontWeight: '700', fontSize: 13, marginBottom: 2 }}>
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
          {msg.deleted ? (
            <Text style={{ color: t.subtext, fontSize: 15, fontStyle: 'italic' }}>This message was deleted</Text>
          ) : (
            <RichText text={msg.text || ''} t={t} meName={meName} mine={mine} style={{ color: t.text, fontSize: 15 }} />
          )}
          <View style={{ flexDirection: 'row', alignSelf: 'flex-end', alignItems: 'center', marginTop: 2 }}>
            {msg.visibleTo != null && (
              <View style={{ flexDirection: 'row', alignItems: 'center', marginRight: 8 }}>
                <Ionicons name="eye-off-outline" size={11} color={t.subtext} />
                <Text style={{ color: t.subtext, fontSize: 11, marginLeft: 3 }}>Only visible to you</Text>
              </View>
            )}
            {!!msg.editedAt && !msg.deleted && <Text style={{ color: t.subtext, fontSize: 11, fontStyle: 'italic', marginRight: 4 }}>edited</Text>}
            <Text style={{ color: t.subtext, fontSize: 11 }}>{timeOf(msg.createdAt)}</Text>
            {mine && !msg.deleted && <Tick status={status} color={t.subtext} />}
          </View>
        </Pressable>
        {reactions.length > 0 && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 2, maxWidth: '80%', justifyContent: mine ? 'flex-end' : 'flex-start' }}>
            {reactions.map((r) => {
              const on = r.userIds.includes(meId);
              return (
                <Pressable
                  key={r.emoji}
                  onPress={() => onReact(msg, r.emoji)}
                  hitSlop={6}
                  style={{
                    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, height: 24, borderRadius: 12, marginRight: 4, marginTop: 2,
                    backgroundColor: on ? 'rgba(37,211,102,0.2)' : t.card, borderWidth: 1, borderColor: on ? t.accent : t.border,
                  }}
                >
                  <Text style={{ fontSize: 13 }}>{r.emoji}</Text>
                  {r.userIds.length > 1 && <Text style={{ color: t.subtext, fontSize: 12, marginLeft: 3 }}>{r.userIds.length}</Text>}
                </Pressable>
              );
            })}
          </View>
        )}
      </View>
    </SwipeReply>
  );
}

export default React.memo(BubbleBase);
