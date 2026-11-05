import crypto from 'node:crypto';
import { settings, updateSettings } from '../config.js';
import { encodeArt, fetchJson, HttpError } from '../http.js';
import type { ControlCommand, NowPlaying, Source, Track } from '../types.js';

const API = 'https://api.spotify.com/v1';
export const SPOTIFY_SCOPES = [
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',
  'user-read-recently-played',
].join(' ');

const pendingStates = new Map<string, { redirectUri: string; at: number }>();

export function spotifyAuthorizeUrl(redirectUri: string): string {
  const s = settings().spotify;
  if (!s.clientId) throw new Error('Set the Spotify client ID first');
  const state = crypto.randomBytes(16).toString('hex');
  for (const [k, v] of pendingStates) if (Date.now() - v.at > 10 * 60_000) pendingStates.delete(k);
  pendingStates.set(state, { redirectUri, at: Date.now() });
  const q = new URLSearchParams({
    response_type: 'code', client_id: s.clientId, scope: SPOTIFY_SCOPES, redirect_uri: redirectUri, state, show_dialog: 'false',
  });
  return `https://accounts.spotify.com/authorize?${q}`;
}

async function tokenRequest(body: Record<string, string>) {
  const s = settings().spotify;
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Basic ' + Buffer.from(`${s.clientId}:${s.clientSecret}`).toString('base64'),
    },
    body: new URLSearchParams(body),
    signal: AbortSignal.timeout(8000),
  });
  const j: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Spotify token error: ${j.error_description || j.error || res.status}`);
  return j as { access_token: string; refresh_token?: string; expires_in: number };
}

export async function spotifyHandleCallback(code: string, state: string): Promise<void> {
  const pending = pendingStates.get(state);
  if (!pending) throw new Error('Login link expired or was already used; try connecting again');
  pendingStates.delete(state);
  const t = await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: pending.redirectUri });
  await updateSettings({
    spotify: { accessToken: t.access_token, refreshToken: t.refresh_token ?? '', expiresAt: Date.now() + t.expires_in * 1000 },
  });
}

let refreshing: Promise<string> | null = null;
async function accessToken(): Promise<string> {
  const s = settings().spotify;
  if (s.accessToken && Date.now() < s.expiresAt - 60_000) return s.accessToken;
  if (!refreshing) {
    refreshing = (async () => {
      const t = await tokenRequest({ grant_type: 'refresh_token', refresh_token: s.refreshToken });
      await updateSettings({
        spotify: {
          accessToken: t.access_token,
          expiresAt: Date.now() + t.expires_in * 1000,
          ...(t.refresh_token ? { refreshToken: t.refresh_token } : {}),
        },
      });
      return t.access_token;
    })().finally(() => { refreshing = null; });
  }
  return refreshing;
}

async function api<T = any>(path: string, init: RequestInit = {}): Promise<T | null> {
  const token = await accessToken();
  return fetchJson<T>(API + path, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) } });
}

function bestImage(images: any[] | undefined): string | undefined {
  if (!images?.length) return undefined;
  const sorted = [...images].sort((a, b) => (b.width ?? 0) - (a.width ?? 0));
  return sorted[0]?.url;
}

export function mapSpotifyItem(item: any): Track {
  if (item?.type === 'episode') {
    return {
      id: item.id,
      title: item.name,
      artist: item.show?.publisher ?? item.show?.name ?? 'Podcast',
      album: item.show?.name ?? '',
      year: item.release_date ? Number(String(item.release_date).slice(0, 4)) : undefined,
      durationMs: item.duration_ms ?? 0,
      artUrl: bestImage(item.images ?? item.show?.images) ? encodeArt(bestImage(item.images ?? item.show?.images)!) : undefined,
      explicit: item.explicit,
    };
  }
  const art = bestImage(item?.album?.images);
  return {
    id: item?.id ?? item?.uri ?? item?.name,
    title: item?.name ?? 'Unknown title',
    artist: (item?.artists ?? []).map((a: any) => a.name).join(', ') || 'Unknown artist',
    albumArtist: item?.album?.artists?.map((a: any) => a.name).join(', '),
    album: item?.album?.name ?? '',
    year: item?.album?.release_date ? Number(String(item.album.release_date).slice(0, 4)) : undefined,
    trackNumber: item?.track_number,
    discNumber: item?.disc_number,
    durationMs: item?.duration_ms ?? 0,
    artUrl: art ? encodeArt(art) : undefined,
    explicit: item?.explicit,
  };
}

export function mapSpotifyPlayer(p: any, now = Date.now()): NowPlaying | null {
  if (!p || !p.item) return null;
  const restrictions = p.actions?.disallows ?? {};
  return {
    source: 'spotify',
    state: p.is_playing ? 'playing' : 'paused',
    track: mapSpotifyItem(p.item),
    progressMs: p.progress_ms ?? 0,
    sampledAt: now,
    device: {
      name: p.device?.name ?? 'Spotify',
      type: p.device?.type,
      volumePercent: p.device?.supports_volume === false ? null : p.device?.volume_percent ?? null,
    },
    capabilities: {
      // Only the action the toggle would send matters: Spotify often (not always) lists the other one as disallowed.
      playPause: p.is_playing ? !restrictions.pausing : !restrictions.resuming,
      next: !restrictions.skipping_next,
      previous: !restrictions.skipping_prev,
      seek: !restrictions.seeking,
      volume: p.device?.supports_volume !== false,
    },
  };
}

export class SpotifySource implements Source {
  id = 'spotify' as const;
  private backoffUntil = 0;

  isConfigured() {
    const s = settings().spotify;
    return Boolean(s.clientId && s.clientSecret && s.refreshToken);
  }

  async poll(): Promise<NowPlaying | null> {
    if (Date.now() < this.backoffUntil) throw new Error('Rate limited by Spotify; waiting');
    try {
      const p = await api('/me/player?additional_types=episode');
      return mapSpotifyPlayer(p);
    } catch (e) {
      if (e instanceof HttpError && e.status === 429) this.backoffUntil = Date.now() + (e.retryAfterSec ?? 30) * 1000;
      throw e;
    }
  }

  nextDelayMs(current: NowPlaying | null) {
    if (Date.now() < this.backoffUntil) return this.backoffUntil - Date.now();
    return current?.state === 'playing' ? 2000 : 10000;
  }

  async queue(): Promise<Track[]> {
    const q = await api('/me/player/queue');
    return (q?.queue ?? []).slice(0, 20).map(mapSpotifyItem);
  }

  async control(cmd: ControlCommand): Promise<void> {
    switch (cmd.type) {
      case 'play': await api('/me/player/play', { method: 'PUT' }); break;
      case 'pause': await api('/me/player/pause', { method: 'PUT' }); break;
      case 'next': await api('/me/player/next', { method: 'POST' }); break;
      case 'previous': await api('/me/player/previous', { method: 'POST' }); break;
      case 'seek': await api(`/me/player/seek?position_ms=${Math.max(0, Math.round(cmd.positionMs))}`, { method: 'PUT' }); break;
      case 'volume': await api(`/me/player/volume?volume_percent=${Math.max(0, Math.min(100, Math.round(cmd.percent)))}`, { method: 'PUT' }); break;
    }
  }
}

export async function spotifyRecent(limit = 12): Promise<any[]> {
  const j = await api(`/me/player/recently-played?limit=${limit}`);
  return j?.items ?? [];
}

export async function spotifyTest(): Promise<string> {
  const me = await api('/me');
  return `Connected as ${me?.display_name ?? me?.id ?? 'Spotify user'}${me?.product ? ` (${me.product})` : ''}`;
}
