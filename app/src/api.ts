import * as SecureStore from 'expo-secure-store';
import { SERVER_URL } from './config';
import { VERSION_CODE } from './version';
import { markUpdateRequired } from './updateStore';
import { kick } from './sessionStore';

const KEY = 'token';
export type User = {
  id: number; phone: string; name: string; role: 'boss' | 'member'; avatarEmoji?: string | null;
  avatarUrl?: string | null; profileDone?: boolean; // Round 4
};

export const getToken = () => SecureStore.getItemAsync(KEY);
export const saveToken = (t: string) => SecureStore.setItemAsync(KEY, t);
export const clearToken = () => SecureStore.deleteItemAsync(KEY);

export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const token = await getToken();
  let res: Response;
  try {
    res = await fetch(SERVER_URL + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-App-Version': String(VERSION_CODE),
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (e) {
    throw new ApiError('Cannot reach server', 0);
  }
  let data: any = null;
  try {
    data = await res.json();
  } catch (e) {}
  if (res.status === 426) markUpdateRequired(data && data.apkUrl, data && data.error);
  // one login per user: this phone was replaced by a newer login (or the admin logged it out)
  if (res.status === 401 && token && data && data.code === 'SESSION_REPLACED') kick('replaced');
  if (!res.ok) throw new ApiError((data && data.error) || 'Request failed', res.status, data && data.code);
  return data as T;
}

// Round 4: multipart upload (POST /media). Same auth + version headers as api(); no Content-Type (fetch sets the boundary).
export async function apiUpload<T = any>(path: string, form: FormData): Promise<T> {
  const token = await getToken();
  let res: Response;
  // Round 4: a long voice note (> ~5 s of recording) leaves the pooled keep-alive connection idle; the server / proxy closes it
  // and the first POST on that dead socket fails ("Cannot reach server"). One retry opens a fresh connection.
  const post = () => fetch(SERVER_URL + path, {
    method: 'POST',
    headers: { 'X-App-Version': String(VERSION_CODE), ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: form,
  });
  try {
    try { res = await post(); } catch (e1) { await new Promise((r) => setTimeout(r, 300)); res = await post(); }
  } catch (e) {
    throw new ApiError('Cannot reach server', 0);
  }
  let data: any = null;
  try { data = await res.json(); } catch (e) {}
  if (res.status === 426) markUpdateRequired(data && data.apkUrl, data && data.error);
  if (res.status === 401 && token && data && data.code === 'SESSION_REPLACED') kick('replaced');
  if (!res.ok) throw new ApiError((data && data.error) || 'Upload failed', res.status, data && data.code);
  return data as T;
}
