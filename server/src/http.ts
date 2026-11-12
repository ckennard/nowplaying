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
    // Prefer the API's own message (Spotify: {"error":{"message":"…"}}) over a raw body dump.
    let detail = text.slice(0, 200);
    try {
      const j = JSON.parse(text);
      detail = j?.error?.message ?? (typeof j?.error === 'string' ? j.error : detail);
    } catch { /* not JSON */ }
    throw new HttpError(res.status, `${res.status} ${res.statusText}: ${detail}`, Number.isFinite(ra) ? ra : undefined);
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
