import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { api, ApiError, clearToken, getToken, saveToken, User } from './api';
import { endSession } from './background';
import { isUpdateRequired, subscribeUpdate } from './updateStore';
import { onKick, resetKick } from './sessionStore';
import { onEvent } from './realtime';
import { loadUsers, setUser as storeUser } from './userStore';

type Ctx = {
  user: User | null;
  loading: boolean;
  login: (phone: string, pin: string) => Promise<void>;
  activate: (phone: string, inviteCode: string, pin: string) => Promise<void>;
  logout: () => Promise<void>;
  updateMe: (u: Partial<User>) => void; // after PATCH /auth/me (ws 'user' also updates it)
};

const AuthContext = createContext<Ctx>(null as unknown as Ctx);
export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const userRef = useRef<User | null>(null);
  userRef.current = user;

  const doLogout = async () => {
    await endSession(); // stops socket, alerts, foreground service, reminders
    await clearToken();
    setUser(null);
  };

  // One login per user: logged in on another phone (401 SESSION_REPLACED / ws 4409) or logged out by the admin (4401).
  useEffect(() => onKick(async (reason) => {
    if (!userRef.current) return;
    await doLogout();
    Alert.alert(
      reason === 'replaced' ? 'Logout ho gaye' : 'Session khatam',
      reason === 'replaced' ? 'Aap kisi aur phone par login ho gaye. Is phone par dobara login karein.' : 'Admin ne aapko logout kar diya. Dobara login karein.',
    );
  }), []);

  // my own name / emoji changed (PATCH /auth/me here or by the admin)
  useEffect(() => onEvent((e) => {
    const me = userRef.current;
    if (e && e.type === 'user' && e.user && me && e.user.id === me.id) setUser({ ...me, name: e.user.name, avatarEmoji: e.user.avatarEmoji || null });
  }), []);

  useEffect(() => {
    let unsub: (() => void) | null = null;
    const boot = async () => {
      try {
        if (await getToken()) {
          const r = await api<{ user: User }>('GET', '/auth/me');
          setUser(r.user);
          loadUsers();
        }
      } catch (e) {
        // drop the token only when the server rejected it, not when offline
        if (e instanceof ApiError && e.status === 401) { await clearToken(); await endSession(); }
        // blocked by force update: keep the token and retry once the block is lifted ("Check again")
        if (e instanceof ApiError && e.status === 426 && !unsub) {
          unsub = subscribeUpdate(() => {
            if (!isUpdateRequired() && unsub) { unsub(); unsub = null; boot(); }
          });
        }
      }
      setLoading(false);
    };
    boot();
    return () => { if (unsub) unsub(); };
  }, []);

  const finish = async (r: { token: string; user: User }) => {
    await saveToken(r.token);
    resetKick();
    setUser(r.user);
    loadUsers();
  };

  const value: Ctx = {
    user,
    loading,
    login: async (phone, pin) => finish(await api('POST', '/auth/login', { phone, pin })),
    activate: async (phone, inviteCode, pin) =>
      finish(await api('POST', '/auth/activate', { phone, inviteCode, pin })),
    logout: doLogout,
    updateMe: (u) => {
      const me = userRef.current;
      if (!me) return;
      const next = { ...me, ...u };
      setUser(next);
      storeUser({ id: next.id, name: next.name, avatarEmoji: next.avatarEmoji || null, role: next.role });
    },
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
