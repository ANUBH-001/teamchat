import * as SecureStore from 'expo-secure-store';
import { SERVER_URL } from './config';

const KEY = 'token';
export type User = { id: number; phone: string; name: string; role: 'boss' | 'member' };

export const getToken = () => SecureStore.getItemAsync(KEY);
export const saveToken = (t: string) => SecureStore.setItemAsync(KEY, t);
export const clearToken = () => SecureStore.deleteItemAsync(KEY);

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
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
  if (!res.ok) throw new ApiError((data && data.error) || 'Request failed', res.status);
  return data as T;
}
