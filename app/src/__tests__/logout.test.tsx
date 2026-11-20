// A-05 / A-06: logout revokes the token on the server (best effort, after the socket is stopped) and clears every per-user
// local store: text outbox, voice outbox (+ files), stars, task cache, people store, background user, signed media URLs and
// the expo-image caches.
import React from 'react';
import { act, render } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const calls: string[] = [];
jest.mock('../config', () => ({ SERVER_URL: 'https://srv.test' }));
jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  return {
    getItemAsync: jest.fn(async (k: string) => store.get(k) ?? null),
    setItemAsync: jest.fn(async (k: string, v: string) => { store.set(k, v); }),
    deleteItemAsync: jest.fn(async (k: string) => { calls.push('clearToken'); store.delete(k); }),
  };
});
jest.mock('expo-file-system', () => ({
  documentDirectory: 'file:///docs/',
  makeDirectoryAsync: jest.fn(async () => {}),
  moveAsync: jest.fn(async () => {}),
  deleteAsync: jest.fn(async () => {}),
}));
jest.mock('expo-image', () => ({ Image: { clearDiskCache: jest.fn(async () => true), clearMemoryCache: jest.fn(async () => true) } }));
jest.mock('expo-image-manipulator', () => ({}));
jest.mock('expo-image-picker', () => ({}));
jest.mock('expo-media-library', () => ({}));
jest.mock('expo', () => ({ requireOptionalNativeModule: () => null })); // no TeamChatService under Jest
jest.mock('../realtime', () => ({
  onEvent: jest.fn(() => () => {}),
  startRealtime: jest.fn(),
  stopRealtime: jest.fn(() => { calls.push('endSession'); }), // the socket is stopped by background.endSession()
}));
jest.mock('../push', () => ({
  applyCheckinSchedule: jest.fn(), listenMessageAlerts: jest.fn(() => () => {}), clearCheckinReminders: jest.fn(), dismissMessageAlerts: jest.fn(),
}));

const fetchMock = jest.fn();
(global as any).fetch = fetchMock;
const json = (status: number, body: any) => ({ status, ok: status < 400, json: async () => body });

import * as SecureStore from 'expo-secure-store';
import * as FS from 'expo-file-system';
import { Image as ExpoImage } from 'expo-image';
import { AuthProvider, useAuth } from '../auth';
import { enqueue, pendingFor, _resetOutboxForTests } from '../outbox';
import { queueVoice, voicePendingFor, __restartForTests } from '../voiceOutbox';
import { toggleStar, isStarred } from '../starStore';
import { putTask, getCachedTask } from '../taskCache';
import { setUser as storeUser, getUser } from '../userStore';
import { mediaSrc, signedMediaUrl } from '../media';

let ctx: ReturnType<typeof useAuth>;
function Grab() { ctx = useAuth(); return null; }

beforeEach(async () => {
  calls.length = 0;
  await AsyncStorage.clear();
  _resetOutboxForTests();
  __restartForTests();
  fetchMock.mockReset();
});

test('logout: POST /auth/logout with the old token after the socket stops, then every per-user store is empty', async () => {
  const user = { id: 7, phone: '9000000007', name: 'Asha', role: 'member' };
  await SecureStore.setItemAsync('token', 'OLD.JWT');
  fetchMock.mockImplementation(async (url: string, init: any) => {
    const path = url.replace('https://srv.test', '');
    calls.push(init.method + ' ' + path + ' ' + (init.headers.Authorization || ''));
    if (path === '/auth/me') return json(200, { user });
    if (path === '/users?includeSelf=1') return json(200, { users: [user] });
    if (path === '/media/sign') return json(200, { urls: { '/media/f/2026/11/a.jpg': '/media/f/2026/11/a.jpg?u=7&e=9999999999&s=' + 'x'.repeat(43) }, expiresAt: 9999999999000 });
    if (path === '/auth/logout') return json(200, { ok: true });
    return json(500, {}); // outbox POSTs fail -> items stay queued
  });
  render(<AuthProvider><Grab /></AuthProvider>);
  await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
  expect(ctx.user && ctx.user.id).toBe(7);

  // per-user data on this phone
  await AsyncStorage.setItem('bgUserId', '7');
  await AsyncStorage.setItem('bgRole', 'member');
  await enqueue(3, 'hello', 'c-text', 'now');
  await queueVoice({ chatId: 3, clientId: 'c-voice', uri: 'file:///cache/rec.m4a', durationMs: 1000, waveform: [0.5], createdAt: 'now' });
  toggleStar({ chatId: 3, messageId: 99, preview: 'secret' });
  putTask({ id: 5, title: 'T' } as any);
  storeUser({ id: 8, name: 'Other', avatarEmoji: null });
  await signedMediaUrl('/media/f/2026/11/a.jpg');
  expect(mediaSrc('/media/f/2026/11/a.jpg')).toContain('&s=');
  calls.length = 0;

  await act(async () => { await ctx.logout(); });

  const i = (s: string) => calls.findIndex((c) => c.startsWith(s));
  expect(i('POST /auth/logout Bearer OLD.JWT')).toBeGreaterThan(i('endSession'));
  expect(i('clearToken')).toBeGreaterThan(i('POST /auth/logout'));
  expect(ctx.user).toBeNull();
  expect(await pendingFor(3, 7, 'Asha')).toEqual([]);
  expect(JSON.parse((await AsyncStorage.getItem('outbox')) || '[]')).toEqual([]);
  expect(await voicePendingFor(3, 7, 'Asha')).toEqual([]);
  expect(FS.deleteAsync).toHaveBeenCalledWith('file:///docs/voice-outbox/', { idempotent: true });
  expect(isStarred(3, 99)).toBe(false);
  expect(await AsyncStorage.getItem('stars.v1')).toBeNull();
  expect(getCachedTask(5)).toBeUndefined();
  expect(getUser(8)).toBeNull();
  expect(await AsyncStorage.getItem('bgUserId')).toBeNull();
  expect(await AsyncStorage.getItem('bgRole')).toBeNull();
  expect(mediaSrc('/media/f/2026/11/a.jpg')).toBeNull();
  expect(ExpoImage.clearDiskCache).toHaveBeenCalled();
  expect(ExpoImage.clearMemoryCache).toHaveBeenCalled();
});

test('logout still clears everything when the server cannot be reached', async () => {
  await SecureStore.setItemAsync('token', 'OLD.JWT');
  fetchMock.mockImplementation(async () => { throw new Error('Network request failed'); });
  render(<AuthProvider><Grab /></AuthProvider>);
  await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
  await enqueue(4, 'queued offline', 'c-off', 'now');
  await act(async () => { await ctx.logout(); });
  expect(calls).toContain('clearToken');
  expect(await pendingFor(4, 7, 'Asha')).toEqual([]);
  expect(await SecureStore.getItemAsync('token')).toBeNull();
});
