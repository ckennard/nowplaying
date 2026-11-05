export type SourceId = 'spotify' | 'plex';
export interface Track {
  id: string; title: string; artist: string; album: string; albumArtist?: string; year?: number;
  trackNumber?: number; discNumber?: number; genres?: string[]; label?: string; durationMs: number;
  artUrl?: string; explicit?: boolean;
}
export interface NowPlaying {
  source: SourceId; state: 'playing' | 'paused' | 'stopped'; track: Track; progressMs: number; sampledAt: number;
  device: { name: string; type?: string; volumePercent?: number | null };
  quality?: { codec?: string; bitrateKbps?: number; sampleRateHz?: number; bitDepth?: number; channels?: number; transcoding?: boolean };
  capabilities: { play: boolean; pause: boolean; next: boolean; previous: boolean; seek: boolean; volume: boolean };
  plexStreamId?: number; viaCast?: boolean;
}
export interface SourceStatus { configured: boolean; ok: boolean; error?: string; lastPoll?: number }
export interface HistoryItem { source: SourceId; title: string; artist: string; album: string; artUrl?: string; playedAt: number }
export interface BroadcastState {
  active: NowPlaying | null; sessions: Partial<Record<SourceId, NowPlaying | null>>; pin: SourceId | null;
  status: Record<SourceId, SourceStatus>; history: HistoryItem[]; queue: Track[]; serverTime: number;
}
export type VizMode = 'aurora' | 'art' | 'spectrum' | 'off';
export interface PublicConfig {
  version: string; pinRequired: boolean; spotifyRedirectUri: string; secureContext: boolean; needsSetup: boolean;
  ui: { overlayTimeoutSec: number; panelTimeoutSec: number; defaultViz: VizMode; lyrics: boolean; wakeLock: boolean };
}
