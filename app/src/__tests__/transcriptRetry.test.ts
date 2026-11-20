// V-04: failed / stuck voice transcripts get a reason and (for the sender or a boss) a "Try again" action.
jest.mock('../api', () => ({
  api: jest.fn(),
  ApiError: class ApiError extends Error { status: number; constructor(m: string, s: number) { super(m); this.status = s; } },
}));
import { ApiError, api } from '../api';
import { requestTranscript, transcriptView, PENDING_STUCK_MS, __resetTranscriptForTests } from '../transcriptRetry';

const now = Date.parse('2026-11-20T10:10:00.000Z');
const msg = (media: any, extra: any = {}) => ({ id: 41, chatId: 7, senderId: 1, createdAt: '2026-11-20T10:09:00.000Z', media: { kind: 'audio', ...media }, ...extra });
const me = { meId: 1, isBoss: false, now };

beforeEach(() => { __resetTranscriptForTests(); (api as jest.Mock).mockReset(); });

test('failed with a reason code -> human reason; retry for the sender', () => {
  const v = transcriptView(msg({ transcriptStatus: 'failed', transcriptError: 'api' }), me);
  expect(v.text).toMatch(/No transcript/);
  expect(v.reason).toBe('The AI service did not respond');
  expect(v.canRetry).toBe(true);
});

test('reason texts for every code', () => {
  const r = (c: string) => transcriptView(msg({ transcriptStatus: 'failed', transcriptError: c }), me).reason;
  expect(r('too_large')).toBe('The voice note is too long');
  expect(r('off')).toBe('AI transcription is turned off');
  expect(r('no_file')).toBeTruthy();
  expect(r('type')).toBeTruthy();
  expect(r('empty')).toBeTruthy();
  expect(r('something_new')).toBe(null); // unknown code from a newer server: no reason line, still retryable
  expect(transcriptView(msg({ transcriptStatus: 'failed', transcriptError: 'something_new' }), me).canRetry).toBe(true);
});

test('a retry cannot help for too_large / type / no_file', () => {
  for (const c of ['too_large', 'type', 'no_file']) {
    expect(transcriptView(msg({ transcriptStatus: 'failed', transcriptError: c }), me).canRetry).toBe(false);
  }
});

test('only the sender or a boss can retry', () => {
  const m = msg({ transcriptStatus: 'failed' });
  expect(transcriptView(m, { ...me, meId: 2 }).canRetry).toBe(false);
  expect(transcriptView(m, { ...me, meId: 2, isBoss: true }).canRetry).toBe(true);
});

test('pending: retry only after 2 minutes', () => {
  const fresh = msg({ transcriptStatus: 'pending' }, { createdAt: new Date(now - PENDING_STUCK_MS + 1000).toISOString() });
  const stuck = msg({ transcriptStatus: 'pending' }, { createdAt: new Date(now - PENDING_STUCK_MS - 1000).toISOString() });
  expect(transcriptView(fresh, me)).toMatchObject({ text: 'Transcribing…', canRetry: false });
  expect(transcriptView(stuck, me)).toMatchObject({ text: 'Transcribing…', canRetry: true });
});

test('no retry for a done transcript or an unsent note', () => {
  expect(transcriptView(msg({ transcriptStatus: 'done', transcript: 'hello' }), me).canRetry).toBe(false);
  expect(transcriptView(msg({ transcriptStatus: 'failed' }, { id: undefined }), me).canRetry).toBe(false);
});

test('request: POST to the new endpoint, then pending until the ws edit arrives', async () => {
  (api as jest.Mock).mockResolvedValueOnce({ ok: true });
  const m = msg({ transcriptStatus: 'failed' });
  expect(await requestTranscript(m as any)).toBe('ok');
  expect(api).toHaveBeenCalledWith('POST', '/chats/7/messages/41/transcribe', {});
  expect(transcriptView(m, me)).toMatchObject({ text: 'Transcribing…', canRetry: false });
});

test('older server (404) hides the action everywhere; 403 hides it for that message', async () => {
  (api as jest.Mock).mockRejectedValueOnce(new (ApiError as any)('Not found', 404));
  const a = msg({ transcriptStatus: 'failed' });
  const b = msg({ transcriptStatus: 'failed' }, { id: 42 });
  expect(await requestTranscript(a as any)).toBe('hidden');
  expect(transcriptView(a, me).canRetry).toBe(false);
  expect(transcriptView(b, me).canRetry).toBe(false);
  __resetTranscriptForTests();
  (api as jest.Mock).mockRejectedValueOnce(new (ApiError as any)('Forbidden', 403));
  expect(await requestTranscript(a as any)).toBe('hidden');
  expect(transcriptView(a, me).canRetry).toBe(false);
  expect(transcriptView(b, me).canRetry).toBe(true);
});

test('network error -> retry stays available', async () => {
  (api as jest.Mock).mockRejectedValueOnce(new Error('Network request failed'));
  const m = msg({ transcriptStatus: 'failed' });
  expect(await requestTranscript(m as any)).toBe('error');
  expect(transcriptView(m, me).canRetry).toBe(true);
});

test('a new status from the server (ws edited) replaces the local pending', async () => {
  (api as jest.Mock).mockResolvedValueOnce({});
  const m = msg({ transcriptStatus: 'failed' });
  await requestTranscript(m as any);
  // ws 'edited' merges a new media object into the message: the server's answer wins over the local "Transcribing…"
  const pending = { ...m, media: { kind: 'audio', transcriptStatus: 'pending' } };
  expect(transcriptView(pending, { ...me, now: now + 60_000 })).toMatchObject({ text: 'Transcribing…', canRetry: false }); // stuck clock restarts at the retry
  const again = { ...m, media: { kind: 'audio', transcriptStatus: 'failed', transcriptError: 'empty' } };
  expect(transcriptView(again, { ...me, now: now + 60_000 })).toMatchObject({ canRetry: true, reason: 'Nothing could be heard' });
});
