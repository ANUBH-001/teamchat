import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { onEvent } from './realtime';

// Keeps a screen fresh without reopening it: runs `load` (debounced) on the given WebSocket event types,
// on reconnect (`_open`), on the local `refresh` event (emitEvent({ type: 'refresh' })) and when the app returns to the foreground.
export function useLiveRefresh(load: () => void, types: string[], delay = 300) {
  const ref = useRef(load);
  ref.current = load;
  const key = types.join(',');
  useEffect(() => {
    let tm: ReturnType<typeof setTimeout> | null = null;
    const fire = () => {
      if (tm) clearTimeout(tm);
      tm = setTimeout(() => ref.current(), delay);
    };
    const set = new Set(key ? key.split(',') : []);
    const off = onEvent((e) => { if (e.type === '_open' || e.type === 'refresh' || set.has(e.type)) fire(); });
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') fire(); });
    return () => { off(); sub.remove(); if (tm) clearTimeout(tm); };
  }, [key, delay]);
}

// Pull-to-refresh state for a list: <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
export function usePullRefresh(load: () => Promise<unknown> | void) {
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try { await load(); } catch (e) {}
    setRefreshing(false);
  }, [load]);
  return { refreshing, onRefresh };
}
