import { settings } from '../config.js';
import { encodeArt, fetchJson } from '../http.js';
import type { NowPlaying, Source } from '../types.js';
import { normalizeServerUrl } from './plex.js';

/** Read-only fallback for when no Plex token is configured: Tautulli's get_activity. */
export function tautulliUrl(cmd: string, extra: Record<string, string> = {}): string {
  const s = settings().tautulli;
  const q = new URLSearchParams({ apikey: s.apiKey, cmd, ...extra });
  const base = normalizeServerUrl(s.url);
  if (!base) throw new Error('Set the Tautulli URL and API key, then save');
  return `${base}/api/v2?${q}`;
}

const n = (v: unknown) => {
  const x = Number(v);
  return Number.isFinite(x) && v !== '' ? x : undefined;
};

export function mapTautulliSession(x: any, now = Date.now()): NowPlaying {
  return {
    source: 'plex',
    state: x.state === 'paused' ? 'paused' : 'playing',
    track: {
      id: String(x.rating_key),
      title: x.title,
      artist: x.original_title || x.grandparent_title,
      albumArtist: x.grandparent_title,
      album: x.parent_title,
      year: n(x.parent_year) ?? n(x.year),
      trackNumber: n(x.media_index),
      discNumber: n(x.parent_media_index),
      genres: x.genres ?? [],
      label: x.studio || undefined,
      durationMs: n(x.duration) ?? 0,
      artUrl: x.parent_thumb || x.thumb ? encodeArt('tautulli:' + (x.parent_thumb || x.thumb)) : undefined,
    },
    progressMs: n(x.view_offset) ?? 0,
    sampledAt: now,
    device: { name: x.player || x.product || 'Plex player', type: x.product },
    quality: {
      codec: (x.stream_audio_codec || x.audio_codec || '').toUpperCase() || undefined,
      bitrateKbps: n(x.stream_audio_bitrate) ?? n(x.audio_bitrate),
      sampleRateHz: n(x.stream_audio_sample_rate) ?? n(x.audio_sample_rate),
      bitDepth: n(x.audio_bitdepth),
      channels: n(x.stream_audio_channels) ?? n(x.audio_channels),
      transcoding: x.stream_audio_decision === 'transcode',
    },
    capabilities: { play: false, pause: false, next: false, previous: false, seek: false, volume: false },
  };
}

export class TautulliSource implements Source {
  id = 'plex' as const;
  isConfigured() {
    const s = settings();
    return Boolean(s.tautulli.url && s.tautulli.apiKey);
  }
  async poll(): Promise<NowPlaying | null> {
    const j = await fetchJson(tautulliUrl('get_activity'));
    const sessions: any[] = (j?.response?.data?.sessions ?? []).filter((x: any) => x.media_type === 'track');
    if (!sessions.length) return null;
    sessions.sort((a, b) => Number(b.state === 'playing') - Number(a.state === 'playing'));
    return mapTautulliSession(sessions[0]);
  }
  nextDelayMs(c: NowPlaying | null) {
    return c?.state === 'playing' ? 3000 : 10000;
  }
  async queue() {
    return [];
  }
  async control(): Promise<void> {
    throw new Error('Controls need a Plex token (Tautulli is read-only)');
  }
}

export async function tautulliTest(): Promise<string> {
  const j = await fetchJson(tautulliUrl('get_server_friendly_name'));
  if (j?.response?.result !== 'success') throw new Error(j?.response?.message || 'Unexpected response');
  return `Connected to Tautulli (server: ${j.response.data})`;
}
