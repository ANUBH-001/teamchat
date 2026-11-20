// V-04: voice-note transcript failures. Server: media.transcriptError ('off'|'no_file'|'too_large'|'type'|'api'|'empty')
// and POST /chats/:chatId/messages/:messageId/transcribe (sender or boss; 200/202; the result comes by ws 'edited').
// transcriptView() is the pure decision for VoiceBubble; requestTranscript() does the call and remembers the outcome.
import { api, ApiError } from './api';

export const PENDING_STUCK_MS = 2 * 60 * 1000;
export const TRANSCRIPT_REASON: Record<string, string> = {
  off: 'AI transcription band hai',
  no_file: 'Audio file server par nahi mili',
  too_large: 'Voice note bahut lamba hai',
  type: 'Is audio format ka transcript nahi banta',
  api: 'AI service ne jawab nahi diya',
  empty: 'Kuch sunai nahi diya',
};
const NO_RETRY = new Set(['too_large', 'type', 'no_file']); // a retry gives the same answer

type MsgLike = { id?: number; chatId: number; senderId: number; createdAt: string; media?: any };
type Who = { meId: number; isBoss: boolean; now: number };
export type TranscriptView = { text: string | null; reason: string | null; canRetry: boolean };

let unsupported = false; // older server: the endpoint does not exist (404) -> no action anywhere this session
const hidden = new Set<number>(); // 403 for this message
const requested = new Map<number, { at: number; media: unknown }>();

export function transcriptView(msg: MsgLike, who: Who): TranscriptView {
  const m = msg.media || {};
  const status: string | undefined = m.transcriptStatus;
  const code: string | undefined = m.transcriptError;
  const req = msg.id ? requested.get(msg.id) : undefined;
  const localPending = !!req && req.media === msg.media; // asked, nothing new from the server yet
  const allowed = !!msg.id && !unsupported && !hidden.has(msg.id) && (msg.senderId === who.meId || who.isBoss);
  if (m.transcript) return { text: null, reason: null, canRetry: false };
  if (localPending) return { text: 'Transcribing…', reason: null, canRetry: false };
  if (status === 'pending') {
    const since = Math.max(Date.parse(msg.createdAt) || 0, req?.at || 0);
    return { text: 'Transcribing…', reason: null, canRetry: allowed && who.now - since > PENDING_STUCK_MS };
  }
  if (status === 'failed') {
    return { text: 'Transcript nahi bana', reason: (code && TRANSCRIPT_REASON[code]) || null, canRetry: allowed && !(code && NO_RETRY.has(code)) };
  }
  return { text: null, reason: null, canRetry: false };
}

// 'ok' = asked (show pending), 'hidden' = this server / user cannot (hide the action), 'error' = try again later.
export async function requestTranscript(msg: MsgLike): Promise<'ok' | 'hidden' | 'error'> {
  if (!msg.id) return 'hidden';
  try {
    await api('POST', '/chats/' + msg.chatId + '/messages/' + msg.id + '/transcribe', {});
    requested.set(msg.id, { at: Date.now(), media: msg.media });
    return 'ok';
  } catch (e: any) {
    const st = e instanceof ApiError ? e.status : e?.status;
    if (st === 404) { unsupported = true; return 'hidden'; }
    if (st === 403) { hidden.add(msg.id); return 'hidden'; }
    return 'error';
  }
}

export const __resetTranscriptForTests = () => { unsupported = false; hidden.clear(); requested.clear(); };
