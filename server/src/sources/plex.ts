import { settings } from '../config.js';
import { encodeArt, fetchJson } from '../http.js';
import type { ControlCommand, NowPlaying, Source, Track } from '../types.js';
import { castControl, castStatus, looksLikeCast } from './cast.js';

const CLIENT_ID = 'nowplaying-display';

function base(): string {
  return settings().plex.url.replace(/\/+$/, '');
}

function headers(): Record<string, string> {
  return {
    Accept: 'application/json',
    'X-Plex-Token': settings().plex.token,
    'X-Plex-Client-Identifier': CLIENT_ID,
    'X-Plex-Product': 'nowplaying',
  };
}

export async function plexGet<T = any>(path: string): Promise<T | null> {
  return fetchJson<T>(base() + path, { headers: headers() });
}

const num = (v: unknown): number | undefined => {
  const n = typeof v === 'string' ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : undefined;
};

interface AlbumInfo { genres: string[]; label?: string; year?: number }
const albumCache = new Map<string, AlbumInfo>();

async function albumInfo(ratingKey: string | undefined): Promise<AlbumInfo | undefined> {
  if (!ratingKey) return undefined;
  const hit = albumCache.get(ratingKey);
  if (hit) return hit;
  try {
    const j = await plexGet(`/library/metadata/${ratingKey}`);
    const m = j?.MediaContainer?.Metadata?.[0];
    const info: AlbumInfo = {
      genres: (m?.Genre ?? []).map((g: any) => g.tag).filter(Boolean),
      label: m?.studio,
      year: num(m?.year),
    };
    if (albumCache.size > 500) albumCache.clear();
    albumCache.set(ratingKey, info);
    return info;
  } catch {
    return undefined;
  }
}

/** Plex art path -> proxied URL. The proxy adds the token server-side. */
export function plexArt(thumb: string | undefined): string | undefined {
  return thumb ? encodeArt('plex:' + thumb) : undefined;
}

/** Map one /status/sessions Metadata entry (type=track) to NowPlaying. Exported for tests. */
export function mapPlexSession(m: any, album?: AlbumInfo, now = Date.now()): NowPlaying {
  const media = m.Media?.[0] ?? {};
  const part = media.Part?.[0] ?? {};
  const audio = (part.Stream ?? []).find((s: any) => num(s.streamType) === 2) ?? part.Stream?.[0] ?? {};
  const player = m.Player ?? {};
  const session = m.Session ?? {};
  const transcode = m.TranscodeSession;
  const state = player.state === 'paused' ? 'paused' : player.state === 'buffering' || player.state === 'playing' ? 'playing' : 'paused';
  const viaCast = looksLikeCast(player);
  const track: Track = {
    id: String(m.ratingKey ?? m.key ?? m.title),
    title: m.title ?? 'Unknown title',
    artist: m.originalTitle || m.grandparentTitle || 'Unknown artist',
    albumArtist: m.grandparentTitle,
    album: m.parentTitle ?? '',
    year: num(m.parentYear) ?? album?.year ?? num(m.year),
    trackNumber: num(m.index),
    discNumber: num(m.parentIndex),
    genres: album?.genres?.length ? album.genres : (m.Genre ?? []).map((g: any) => g.tag),
    label: album?.label,
    durationMs: num(m.duration) ?? num(media.duration) ?? 0,
    artUrl: plexArt(m.parentThumb || m.thumb || m.grandparentThumb),
  };
  return {
    source: 'plex',
    state,
    track,
    progressMs: num(m.viewOffset) ?? 0,
    sampledAt: now,
    device: { name: player.title || player.product || 'Plex player', type: player.product || player.platform },
    quality: {
      codec: (audio.codec || media.audioCodec || '').toUpperCase() || undefined,
      bitrateKbps: num(audio.bitrate) ?? num(media.bitrate),
      sampleRateHz: num(audio.samplingRate),
      bitDepth: num(audio.bitDepth),
      channels: num(audio.channels) ?? num(media.audioChannels),
      transcoding: transcode ? transcode.audioDecision === 'transcode' : undefined,
    },
    capabilities: { playPause: true, next: true, previous: true, seek: true, volume: viaCast },
    plexStreamId: num(audio.id),
    viaCast,
    // internal fields used for control; stripped before broadcast
    ...({ _player: { machineIdentifier: player.machineIdentifier, address: player.address, sessionId: session.id, playQueueItemID: m.playQueueItemID } } as any),
  };
}

let commandId = 0;

export class PlexSource implements Source {
  id = 'plex' as const;
  private lastPlayQueue: { id?: number } = {};
  private castInfo: { at: number; host?: string; volume?: number; busy?: boolean; error?: string } = { at: 0 };

  private castHost(np: NowPlaying): string | undefined {
    return settings().cast.hostOverride || (np as any)._player?.address;
  }

  /** Refresh Chromecast volume / play-queue id in the background (at most every 15s). */
  private refreshCast(np: NowPlaying) {
    const host = this.castHost(np);
    if (!host || !settings().cast.enabled || this.castInfo.busy) return;
    if (Date.now() - this.castInfo.at < 15000 && this.castInfo.host === host) return;
    this.castInfo.busy = true;
    castStatus(host)
      .then((r) => {
        this.castInfo = { at: Date.now(), host, volume: r.volumePercent };
        this.setPlayQueue(r.playQueueId);
      })
      .catch((e) => { this.castInfo = { at: Date.now(), host, error: e.message }; })
      .finally(() => { this.castInfo.busy = false; });
  }

  isConfigured() {
    const s = settings();
    return Boolean(s.plex.url && s.plex.token);
  }

  async poll(): Promise<NowPlaying | null> {
    const j = await plexGet('/status/sessions');
    const list: any[] = (j?.MediaContainer?.Metadata ?? []).filter((m: any) => m.type === 'track');
    if (!list.length) return null;
    // Prefer a playing session over paused ones; among equals, the furthest-along (most recently active) one.
    list.sort((a, b) => Number(b.Player?.state === 'playing') - Number(a.Player?.state === 'playing'));
    const m = list[0];
    const album = await albumInfo(m.parentRatingKey);
    const np = mapPlexSession(m, album);
    if (np.viaCast) {
      this.refreshCast(np);
      np.device.volumePercent = this.castInfo.volume ?? null;
    }
    return np;
  }

  nextDelayMs(current: NowPlaying | null) {
    return current?.state === 'playing' ? 2500 : 8000;
  }

  async queue(current: NowPlaying): Promise<Track[]> {
    // /status/sessions doesn't include the play queue id; for cast sessions it comes from the
    // receiver's media status (customData.containerKey). Without it, there's no queue to show.
    try {
      const pqId = this.lastPlayQueue.id;
      if (!pqId) return [];
      const j = await plexGet(`/playQueues/${pqId}?window=20&own=1`);
      const items: any[] = j?.MediaContainer?.Metadata ?? [];
      const selected = num(j?.MediaContainer?.playQueueSelectedItemID);
      const idx = items.findIndex((i) => num(i.playQueueItemID) === selected);
      return items.slice(idx + 1).map((m) => mapPlexSession(m).track);
    } catch {
      return [];
    }
  }

  /** Called by the Cast layer when it learns the play queue id from the receiver's media status. */
  setPlayQueue(id: number | undefined) {
    if (id) this.lastPlayQueue.id = id;
  }

  async control(cmd: ControlCommand, current: NowPlaying | null): Promise<void> {
    if (!current) throw new Error('Nothing playing on Plex');
    const p = (current as any)._player ?? {};
    const s = settings();
    if (current.viaCast && s.cast.enabled) {
      const host = s.cast.hostOverride || p.address;
      if (!host) throw new Error('No Chromecast address known; set one in Settings');
      const result = await castControl(host, cmd);
      this.setPlayQueue(result.playQueueId);
      if (result.volumePercent != null) this.castInfo = { ...this.castInfo, at: Date.now(), host, volume: result.volumePercent };
      return;
    }
    // Plex companion remote control via the server (works for Plexamp / Plex Web / desktop).
    const map: Record<string, string> = {
      play: 'play', pause: 'pause', next: 'skipNext', previous: 'skipPrevious', seek: 'seekTo', volume: 'setParameters',
    };
    const params = new URLSearchParams({ type: 'music', commandID: String(++commandId) });
    if (cmd.type === 'seek') params.set('offset', String(Math.round(cmd.positionMs)));
    if (cmd.type === 'volume') params.set('volume', String(Math.round(cmd.percent)));
    const url = `${base()}/player/playback/${map[cmd.type]}?${params}`;
    const res = await fetch(url, {
      headers: { ...headers(), 'X-Plex-Target-Client-Identifier': p.machineIdentifier ?? '' },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) throw new Error(`Plex player rejected ${cmd.type} (${res.status}); this player may not support remote control`);
  }
}

export async function plexLevels(streamId: number, subsample = 200): Promise<number[] | null> {
  try {
    const j = await plexGet(`/library/streams/${streamId}/levels?subsample=${subsample}`);
    const levels: any[] = j?.MediaContainer?.Level ?? [];
    if (!levels.length) return null;
    return levels.map((l) => Number(l.v)).filter(Number.isFinite);
  } catch {
    return null;
  }
}

export async function plexTest(): Promise<string> {
  const j = await plexGet('/identity');
  const id = await plexGet('/');
  return `Connected to ${id?.MediaContainer?.friendlyName ?? 'Plex'} (v${j?.MediaContainer?.version ?? '?'})`;
}

export function plexArtUrl(path: string, width = 1000): string {
  const s = settings();
  const q = new URLSearchParams({
    width: String(width), height: String(width), minSize: '1', upscale: '1', url: path, 'X-Plex-Token': s.plex.token,
  });
  return `${base()}/photo/:/transcode?${q}`;
}
