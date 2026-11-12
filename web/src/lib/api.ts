import type { ControlCommand, SourceId } from '../types';

export function pinHeader(): Record<string, string> {
  try {
    const p = sessionStorage.getItem('np.pin');
    return p ? { 'X-Admin-Pin': p } : {};
  } catch {
    return {};
  }
}

export async function api<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...pinHeader(), ...(init.headers ?? {}) },
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(j.error || `HTTP ${res.status}`), { status: res.status });
  return j as T;
}

export function control(cmd: ControlCommand, source?: SourceId) {
  return api('/api/control', { method: 'POST', body: JSON.stringify({ ...cmd, source }) });
}

export function setPin(pin: SourceId | null) {
  return api('/api/pin', { method: 'POST', body: JSON.stringify({ pin }) });
}
