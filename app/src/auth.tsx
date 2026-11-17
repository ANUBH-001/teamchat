import React, { createContext, useContext, useEffect, useState } from 'react';
import { api, ApiError, clearToken, getToken, saveToken, User } from './api';
import { endSession } from './background';
import { isUpdateRequired, subscribeUpdate } from './updateStore';

type Ctx = {
  user: User | null;
  loading: boolean;
  login: (phone: string, pin: string) => Promise<void>;
  activate: (phone: string, inviteCode: string, pin: string) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<Ctx>(null as unknown as Ctx);
export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let unsub: (() => void) | null = null;
    const boot = async () => {
      try {
        if (await getToken()) {
          const r = await api<{ user: User }>('GET', '/auth/me');
          setUser(r.user);
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
    setUser(r.user);
  };

  const value: Ctx = {
    user,
    loading,
    login: async (phone, pin) => finish(await api('POST', '/auth/login', { phone, pin })),
    activate: async (phone, inviteCode, pin) =>
      finish(await api('POST', '/auth/activate', { phone, inviteCode, pin })),
    logout: async () => {
      await endSession(); // stops socket, alerts, foreground service, reminders
      await clearToken();
      setUser(null);
    },
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
