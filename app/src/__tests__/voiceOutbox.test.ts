// A-12: a voice note whose upload / POST failed is kept (file + metadata in AsyncStorage), shown as failed with Retry / Delete,
// and every retry reuses ONE clientId so the server dedupes.
import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('expo-file-system', () => ({
  documentDirectory: 'file:///docs/',
  makeDirectoryAsync: jest.fn(async () => {}),
  moveAsync: jest.fn(async () => {}),
  deleteAsync: jest.fn(async () => {}),
}));
jest.mock('../media', () => ({ uploadMedia: jest.fn() }));
jest.mock('../api', () => ({
  api: jest.fn(),
  ApiError: class ApiError extends Error { status: number; constructor(m: string, s: number) { super(m); this.status = s; } },
}));

const FS = require('expo-file-system');
const media = require('../media');
const apiMod = require('../api');
import * as voiceOutbox from '../voiceOutbox';
const load = () => voiceOutbox;

const input = (clientId = 'c1') => ({
  chatId: 7, clientId, uri: 'file:///cache/Audio/rec.m4a', durationMs: 4200, waveform: [0.1, 0.5, 1],
  createdAt: '2026-11-20T10:00:00.000Z', replyToId: 3, text: '/task @A', mentionIds: [11],
});

beforeEach(async () => {
  voiceOutbox.__restartForTests();
  await AsyncStorage.clear();
  jest.clearAllMocks();
});

test('upload fails -> kept and failed; retry reuses the clientId; success cleans up', async () => {
  const vo = load();
  media.uploadMedia.mockRejectedValueOnce(new Error('Network request failed'));
  const item = await vo.queueVoice(input());
  expect(item.uri).toBe('file:///docs/voice-outbox/c1.m4a'); // moved out of the cache dir
  expect(FS.moveAsync).toHaveBeenCalledWith({ from: 'file:///cache/Audio/rec.m4a', to: 'file:///docs/voice-outbox/c1.m4a' });
  await expect(vo.sendQueuedVoice('c1')).rejects.toThrow();
  expect(vo.voiceState('c1')).toBe('failed');
  expect(JSON.parse((await AsyncStorage.getItem('voiceOutbox'))!)).toHaveLength(1);

  media.uploadMedia.mockResolvedValueOnce({ url: '/media/f/a.m4a' });
  apiMod.api.mockResolvedValueOnce({ message: { id: 99, clientId: 'c1', chatId: 7 } });
  const sent = jest.fn();
  vo.onVoiceSent(sent);
  const msg = await vo.sendQueuedVoice('c1');
  expect(msg.id).toBe(99);
  expect(apiMod.api).toHaveBeenCalledWith('POST', '/chats/7/messages', expect.objectContaining({
    type: 'audio', mediaUrl: '/media/f/a.m4a', clientId: 'c1', replyToId: 3, text: '/task @A', mentionIds: [11],
    media: { kind: 'audio', durationMs: 4200, waveform: [0.1, 0.5, 1] },
  }));
  expect(sent).toHaveBeenCalledWith('c1', expect.objectContaining({ id: 99 }));
  expect(JSON.parse((await AsyncStorage.getItem('voiceOutbox'))!)).toHaveLength(0);
  expect(FS.deleteAsync).toHaveBeenCalledWith('file:///docs/voice-outbox/c1.m4a', { idempotent: true });
  expect(vo.voiceState('c1')).toBe(null);
});

test('upload ok but POST fails -> the retry does not upload again (same clientId, same mediaUrl)', async () => {
  const vo = load();
  media.uploadMedia.mockResolvedValue({ url: '/media/f/b.m4a' });
  apiMod.api.mockRejectedValueOnce(new Error('500'));
  await vo.queueVoice(input('c2'));
  await expect(vo.sendQueuedVoice('c2')).rejects.toThrow();
  apiMod.api.mockResolvedValueOnce({ message: { id: 5, clientId: 'c2', chatId: 7 } });
  await vo.sendQueuedVoice('c2');
  expect(media.uploadMedia).toHaveBeenCalledTimes(1);
  const bodies = apiMod.api.mock.calls.map((c: any[]) => c[2]);
  expect(bodies.map((b: any) => b.clientId)).toEqual(['c2', 'c2']);
  expect(bodies.map((b: any) => b.mediaUrl)).toEqual(['/media/f/b.m4a', '/media/f/b.m4a']);
});

test('a failed voice note survives an app restart and shows as a failed audio bubble', async () => {
  const vo = load();
  media.uploadMedia.mockRejectedValueOnce(new Error('offline'));
  await vo.queueVoice(input('c3'));
  await expect(vo.sendQueuedVoice('c3')).rejects.toThrow();
  vo.__restartForTests(); // "restart": in-memory state gone, AsyncStorage kept
  const list = await vo.voicePendingFor(7, 1, 'Me');
  expect(list).toHaveLength(1);
  expect(list[0]).toMatchObject({
    clientId: 'c3', chatId: 7, senderId: 1, type: 'audio', pending: true, mediaUrl: 'file:///docs/voice-outbox/c3.m4a',
    media: { kind: 'audio', durationMs: 4200, waveform: [0.1, 0.5, 1] },
  });
  expect(list[0].id).toBeUndefined();
  expect(vo.voiceState('c3')).toBe('failed'); // not in flight in this process
  expect(await vo.voicePendingFor(8, 1, 'Me')).toHaveLength(0);
});

test('delete removes the item and its file and tells the screen', async () => {
  const vo = load();
  await vo.queueVoice(input('c4'));
  const removed = jest.fn();
  vo.onVoiceRemoved(removed);
  await vo.deleteVoice('c4');
  expect(removed).toHaveBeenCalledWith('c4');
  expect(await vo.voicePendingFor(7, 1, 'Me')).toHaveLength(0);
  expect(FS.deleteAsync).toHaveBeenCalledWith('file:///docs/voice-outbox/c4.m4a', { idempotent: true });
});

test('double Retry tap sends once', async () => {
  const vo = load();
  media.uploadMedia.mockResolvedValue({ url: '/media/f/c.m4a' });
  apiMod.api.mockResolvedValue({ message: { id: 6, clientId: 'c5', chatId: 7 } });
  await vo.queueVoice(input('c5'));
  await Promise.all([vo.sendQueuedVoice('c5'), vo.sendQueuedVoice('c5')]);
  expect(apiMod.api).toHaveBeenCalledTimes(1);
});

test('if moving the file fails the original uri is kept (never lose the recording)', async () => {
  const vo = load();
  FS.moveAsync.mockRejectedValueOnce(new Error('disk'));
  const item = await vo.queueVoice(input('c6'));
  expect(item.uri).toBe('file:///cache/Audio/rec.m4a');
});
