import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colorFor, dark, tintFor, Theme } from '../theme';
import Tick, { TickStatus } from './Tick';
import { tickOnBubble } from '../theme';
import { Msg } from '../chatTypes';
import BotCard from './BotCard';
import CheckinCard from './CheckinCard';
import SwipeReply from './SwipeReply';
import SystemPill from './SystemPill';
import RichText from './RichText';
import TaskAttachments from './TaskAttachment';
import { useUser } from '../userStore';
import ImageBubble from './ImageBubble';
import VoiceBubble from './VoiceBubble';
import { Quote } from '../chatTypes';

// Round 4: payload.kind 'ai_answer' = answer to @AI (own AiBubble, not BotCard); payload.quote = "Reply privately" quote.
const isAiAnswer = (m: Msg) => m.type === 'bot' && !!m.payload && (m.payload as any).kind === 'ai_answer';
const quoteOf = (m: Msg): Quote | null => ((m.payload as any)?.quote as Quote) || null;
// "Forward" prefixes the text with this line; it is drawn as a small label instead
export const FWD = '↪ Forwarded\n';
const FWD_RE = /^↪ Forwarded(\n|$)/;
const splitFwd = (s: string | null) => (s && FWD_RE.test(s) ? { fwd: true, body: s.replace(FWD_RE, '') } : { fwd: false, body: s || '' });

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
  attachments?: Msg[]; // bot cards caused by this message (All filter), shown under the bubble
  quote?: string | null; // bot card in the AI filter: one line of the source message
  onTaskChip?: (taskId: number) => void; // "#N" chip on a task-linked text message
  onOpenImage?: (m: Msg) => void; // Round 4: tap on a photo
  starred?: boolean;
};

// Sender line in groups: live name + emoji from the user store (payload snapshot as fallback).
function Sender({ id, name, emoji }: { id: number; name: string; emoji?: string | null }) {
  const u = useUser(id);
  const e = (u && u.avatarEmoji) || emoji || '';
  return (
    <Text numberOfLines={1} style={{ color: colorFor(id), fontWeight: '700', fontSize: 13, marginBottom: 2 }}>
      {(e ? e + ' ' : '') + ((u && u.name) || name)}
    </Text>
  );
}

// Answer to "@AI <question>": distinct card with an "AI" label.
function AiBubble({ msg, t, meName, onLongPress, highlight }: { msg: Msg; t: Theme; meName: string; onLongPress: (m: Msg) => void; highlight: boolean }) {
  return (
    <View style={{ paddingHorizontal: 10, marginVertical: 2, alignItems: 'flex-start', backgroundColor: highlight ? t.chip : 'transparent' }}>
      <Pressable
        onLongPress={() => onLongPress(msg)}
        style={{ maxWidth: '85%', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12, backgroundColor: t.surface, borderWidth: 1, borderColor: t.accent }}
      >
        <Text style={{ color: t.accent, fontWeight: '800', fontSize: 12, marginBottom: 2 }}>{'✨ AI'}</Text>
        <RichText text={msg.text || ''} t={t} meName={meName} style={{ color: t.text, fontSize: 15 }} />
        <Text style={{ color: t.subtext, fontSize: 11, alignSelf: 'flex-end', marginTop: 2 }}>{timeOf(msg.createdAt)}</Text>
      </Pressable>
    </View>
  );
}

function BubbleBase({
  msg, mine, showSender, status, t, onLongPress, onReply, onQuotePress, onReact, onOpenTask, onSendText, onPrefill, meId, meName, isBoss, highlight, onCardMic,
  attachments, quote, onTaskChip, onOpenImage, starred,
}: Props) {
  if (msg.type === 'system') return <SystemPill text={msg.text || ''} t={t} />;
  if (msg.type === 'checkin_prompt' && !msg.deleted && msg.payload) {
    return <CheckinCard msg={msg} t={t} time={timeOf(msg.createdAt)} onMic={onCardMic} onLongPress={onLongPress} onOpenTask={onOpenTask} />;
  }
  if (isAiAnswer(msg) && !msg.deleted) return <AiBubble msg={msg} t={t} meName={meName} onLongPress={onLongPress} highlight={highlight} />;
  if (msg.type === 'bot') {
    const card = (
      <BotCard msg={msg} t={t} meId={meId} isBoss={isBoss} time={timeOf(msg.createdAt)} onLongPress={onLongPress}
        onOpenTask={onOpenTask} onSendText={onSendText} onPrefill={onPrefill} onReply={onReply} quote={quote} />
    );
    // task / ask cards: swipe right to reply (the server adds the reply as a note, "desc: ..." = description)
    if (!isTaskCard(msg)) return card;
    return <SwipeReply enabled={!!msg.id && !msg.deleted} onReply={() => onReply(msg)} color={t.subtext}>{card}</SwipeReply>;
  }
  const rt = msg.deleted ? null : msg.replyTo;
  // Round 4: my bubble is solid accent, so text on it uses bubbleOutText and a light sub color
  const main = mine ? t.bubbleOutText : t.text;
  const sub = mine ? tickOnBubble : t.subtext;
  const accentOn = mine ? t.bubbleOutText : t.accent;
  const tinted = showSender && !mine;
  const reactions = msg.deleted ? [] : (msg.reactions ?? []).filter((r) => r.userIds.length > 0);
  // task link (reply-chain note / "#N" message); command messages have their card instead
  const isImg = msg.type === 'image' && !msg.deleted;
  const isAud = msg.type === 'audio' && !msg.deleted;
  const { fwd, body: textBody } = splitFwd(msg.text);
  const pq = quoteOf(msg);
  const overlayTime = isImg && !textBody; // time sits on the photo when there is no caption
  const chip = !msg.deleted && msg.taskId && !/^\s*\//.test(msg.text || '') ? msg.taskId : null;
  return (
    <SwipeReply enabled={!!msg.id && !msg.deleted} onReply={() => onReply(msg)} color={t.subtext}>
      <View
        style={{
          paddingHorizontal: 10, marginVertical: 2, alignItems: mine ? 'flex-end' : 'flex-start',
          backgroundColor: highlight ? t.chip : 'transparent',
        }}
      >
        <Pressable
          onLongPress={() => onLongPress(msg)}
          onPress={status === 'failed' ? () => onLongPress(msg) : undefined} // failed: a tap opens Retry / Delete
          style={{
            maxWidth: '80%', paddingHorizontal: isImg ? 4 : 9, paddingVertical: isImg ? 4 : 6, borderRadius: 10,
            backgroundColor: mine ? t.bubbleOut : tinted ? tintFor(msg.senderId, t === dark) : t.bubbleIn,
            borderLeftWidth: tinted ? 3 : 0, borderLeftColor: tinted ? colorFor(msg.senderId) : 'transparent',
          }}
        >
          {showSender && !mine && <Sender id={msg.senderId} name={msg.senderName} emoji={msg.senderEmoji} />}
          {!!rt && (
            <Pressable
              onPress={() => onQuotePress(rt.id)}
              style={{
                borderLeftWidth: 4, borderLeftColor: accentOn, backgroundColor: 'rgba(0,0,0,0.12)',
                borderRadius: 4, paddingHorizontal: 8, paddingVertical: 4, marginBottom: 4,
              }}
            >
              <Text numberOfLines={1} style={{ color: accentOn, fontWeight: '700', fontSize: 12 }}>
                {rt.senderName || 'Message'}
              </Text>
              <Text
                numberOfLines={2}
                style={{ color: sub, fontSize: 13, fontStyle: rt.deleted ? 'italic' : 'normal' }}
              >
                {rt.deleted ? 'This message was deleted' : rt.text}
              </Text>
            </Pressable>
          )}
          {!!pq && !msg.deleted && (
            <View style={{ borderLeftWidth: 4, borderLeftColor: accentOn, backgroundColor: 'rgba(0,0,0,0.12)', borderRadius: 4, paddingHorizontal: 8, paddingVertical: 4, marginBottom: 4 }}>
              <Text numberOfLines={1} style={{ color: accentOn, fontWeight: '700', fontSize: 12 }}>{pq.senderName}</Text>
              <Text numberOfLines={3} style={{ color: sub, fontSize: 13 }}>{pq.text}</Text>
            </View>
          )}
          {fwd && !msg.deleted && <Text style={{ color: sub, fontSize: 11, fontStyle: 'italic', marginBottom: 2 }}>{'↪ Forwarded'}</Text>}
          {msg.deleted ? (
            <Text style={{ color: sub, fontSize: 15, fontStyle: 'italic' }}>This message was deleted</Text>
          ) : isImg ? (
            <ImageBubble msg={msg} onOpen={onOpenImage || (() => {})} onLongPress={onLongPress} textColor={main} linkColor={mine ? t.onAccent : t.accent}>
              {overlayTime && (
                <View style={{ position: 'absolute', right: 6, bottom: 6, flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.45)', borderRadius: 10, paddingHorizontal: 6, paddingVertical: 1 }}>
                  <Text style={{ color: '#fff', fontSize: 11 }}>{timeOf(msg.createdAt)}</Text>
                  {mine && <Tick status={status} color="#fff" onBubble />}
                </View>
              )}
            </ImageBubble>
          ) : isAud ? (
            <VoiceBubble msg={msg} mine={mine} t={t} />
          ) : (
            <RichText text={textBody} t={t} meName={meName} mine={mine} style={{ color: main, fontSize: 15 }} />
          )}
          {(isImg || isAud) && !!textBody && !msg.deleted && (
            <View style={{ paddingHorizontal: isImg ? 5 : 0, paddingTop: 3 }}>
              <RichText text={textBody} t={t} meName={meName} mine={mine} style={{ color: main, fontSize: 15 }} />
            </View>
          )}
          {!overlayTime && <View style={{ flexDirection: 'row', alignSelf: 'flex-end', alignItems: 'center', marginTop: 2 }}>
            {chip && (
              <Pressable
                onPress={() => onTaskChip && onTaskChip(chip)} hitSlop={8}
                style={{ flexDirection: 'row', alignItems: 'center', borderRadius: 8, paddingHorizontal: 6, paddingVertical: 1, marginRight: 8, backgroundColor: 'rgba(0,0,0,0.12)' }}
              >
                <Ionicons name="checkbox-outline" size={11} color={accentOn} />
                <Text style={{ color: accentOn, fontSize: 11, fontWeight: '700', marginLeft: 3 }}>#{chip}</Text>
              </Pressable>
            )}
            {msg.visibleTo != null && (
              <View style={{ flexDirection: 'row', alignItems: 'center', marginRight: 8 }}>
                <Ionicons name="eye-off-outline" size={11} color={sub} />
                <Text style={{ color: sub, fontSize: 11, marginLeft: 3 }}>Only visible to you</Text>
              </View>
            )}
            {!!msg.editedAt && !msg.deleted && <Text style={{ color: sub, fontSize: 11, fontStyle: 'italic', marginRight: 4 }}>edited</Text>}
            {starred && <Ionicons name="star" size={11} color={sub} style={{ marginRight: 4 }} />}
            <Text style={{ color: sub, fontSize: 11 }}>{timeOf(msg.createdAt)}</Text>
            {mine && !msg.deleted && <Tick status={status} color={sub} onBubble />}
          </View>}
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
                    backgroundColor: on ? t.chip : t.card, borderWidth: 1, borderColor: on ? t.accent : t.border,
                  }}
                >
                  <Text style={{ fontSize: 13 }}>{r.emoji}</Text>
                  {r.userIds.length > 1 && <Text style={{ color: t.subtext, fontSize: 12, marginLeft: 3 }}>{r.userIds.length}</Text>}
                </Pressable>
              );
            })}
          </View>
        )}
        {!!attachments && attachments.length > 0 && (
          <TaskAttachments
            cards={attachments} mine={mine} t={t} meId={meId} isBoss={isBoss} onLongPress={onLongPress} onOpenTask={onOpenTask}
            onSendText={onSendText} onPrefill={onPrefill} onReply={onReply}
          />
        )}
      </View>
    </SwipeReply>
  );
}

export default React.memo(BubbleBase);
