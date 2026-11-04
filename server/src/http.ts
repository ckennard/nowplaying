export class HttpError extends Error {
  constructor(public status: number, message: string, public retryAfterSec?: number) {
    super(message);
  }
}

export async function fetchJson<T = any>(url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<T | null> {
  const { timeoutMs = 8000, ...rest } = init;
  const res = await fetch(url, { ...rest, signal: AbortSignal.timeout(timeoutMs) });
  if (res.status === 204) return null;
  const text = await res.text();
  if (!res.ok) {
    const ra = Number(res.headers.get('retry-after'));
    throw new HttpError(res.status, `${res.status} ${res.statusText}: ${text.slice(0, 200)}`, Number.isFinite(ra) ? ra : undefined);
  }
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export function encodeArt(src: string): string {
  return '/api/art?src=' + encodeURIComponent(src);
}
