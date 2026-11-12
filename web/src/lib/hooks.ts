import { useCallback, useEffect, useRef, useState } from 'react';
import type { BroadcastState, NowPlaying } from '../types';
import { demoState } from './demo';

/** Live state over Server-Sent Events, with the client↔server clock offset. */
export function useLiveState() {
  const [state, setState] = useState<BroadcastState | null>(null);
  const [connected, setConnected] = useState(false);
  const offset = useRef(0);
  useEffect(() => {
    const demo = new URLSearchParams(location.search).get('demo');
    if (demo != null) {
      const start = Date.now() - 61_000;
      setConnected(true);
      if (demo === 'idle') {
        setState({ ...demoState(start), active: null });
        return;
      }
      setState(demoState(start));
      const t = window.setInterval(() => setState(demoState(start)), 5000);
      return () => clearInterval(t);
    }
    let es: EventSource | null = null;
    let retry: number | undefined;
    let reload: number | undefined;
    let version: string | null = null;
    // The server announces its build on every (re)connect. A different one means this tab is running an
    // old bundle, so reload; an always-on display would otherwise keep it until someone noticed.
    const onVersion = (e: MessageEvent) => {
      if (version === null) { version = e.data; return; }
      if (version === e.data || reload !== undefined) return;
      const go = () => {
        if (location.hash.startsWith('#settings')) reload = window.setTimeout(go, 15_000); // don't discard a half-filled form
        else location.reload();
      };
      go();
    };
    const open = () => {
      es = new EventSource('/api/stream');
      es.addEventListener('version', onVersion);
      es.onopen = () => setConnected(true);
      es.onmessage = (e) => {
        const s = JSON.parse(e.data) as BroadcastState;
        offset.current = Date.now() - s.serverTime;
        setState(s);
      };
      es.onerror = () => {
        setConnected(false);
        if (es?.readyState === EventSource.CLOSED) {
          es.close();
          retry = window.setTimeout(open, 3000);
        }
      };
    };
    open();
    return () => { es?.close(); clearTimeout(retry); clearTimeout(reload); };
  }, []);
  return { state, connected, clockOffset: offset };
}

/** Smoothly interpolated playback position (ms). */
export function useProgress(np: NowPlaying | null, clockOffset: React.MutableRefObject<number>) {
  const [pos, setPos] = useState(0);
  useEffect(() => {
    if (!np) { setPos(0); return; }
    const calc = () => {
      const elapsed = np.state === 'playing' ? Date.now() - clockOffset.current - np.sampledAt : 0;
      return Math.min(np.track.durationMs || Infinity, Math.max(0, np.progressMs + elapsed));
    };
    setPos(calc());
    if (np.state !== 'playing') return;
    const t = window.setInterval(() => setPos(calc()), 250);
    return () => clearInterval(t);
  }, [np, clockOffset]);
  return pos;
}

/** True while the user has recently interacted; flips false after `timeoutSec` of inactivity. */
export function useActivity(timeoutSec: number) {
  const [active, setActive] = useState(true);
  const timer = useRef<number>();
  const bump = useCallback(() => {
    setActive(true);
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setActive(false), timeoutSec * 1000);
  }, [timeoutSec]);
  useEffect(() => {
    bump();
    const evs = ['pointermove', 'pointerdown', 'keydown', 'wheel', 'touchstart'] as const;
    evs.forEach((e) => window.addEventListener(e, bump, { passive: true }));
    return () => { evs.forEach((e) => window.removeEventListener(e, bump)); clearTimeout(timer.current); };
  }, [bump]);
  return { active, bump };
}

export function useWakeLock(enabled: boolean) {
  useEffect(() => {
    if (!enabled || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let cancelled = false;
    const acquire = async () => {
      try {
        if (document.visibilityState === 'visible') lock = await navigator.wakeLock.request('screen');
      } catch { /* denied or unsupported (needs HTTPS) */ }
      if (cancelled) lock?.release().catch(() => {});
    };
    const onVis = () => { if (document.visibilityState === 'visible') acquire(); };
    acquire();
    document.addEventListener('visibilitychange', onVis);
    return () => { cancelled = true; document.removeEventListener('visibilitychange', onVis); lock?.release().catch(() => {}); };
  }, [enabled]);
}

export function useLocalStorage<T>(key: string, initial: T) {
  const [v, setV] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw == null ? initial : (JSON.parse(raw) as T);
    } catch {
      return initial;
    }
  });
  const set = useCallback((nv: T | ((p: T) => T)) => {
    setV((prev) => {
      const val = typeof nv === 'function' ? (nv as (p: T) => T)(prev) : nv;
      try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* private mode */ }
      return val;
    });
  }, [key]);
  return [v, set] as const;
}

export function useClock(intervalMs = 1000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}
