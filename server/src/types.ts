export type SourceId = 'spotify' | 'plex';
export type PlayState = 'playing' | 'paused' | 'stopped';

export interface Track {
  id: string;
  title: string;
  artist: string;
  album: string;
  albumArtist?: string;
  year?: number;
  trackNumber?: number;
  discNumber?: number;
  genres?: string[];
  label?: string;
  durationMs: number;
  /** Same-origin URL (always via /api/art) so the browser can sample colors and never sees tokens. */
  artUrl?: string;
  explicit?: boolean;
}

export interface Quality {
  codec?: string;
  bitrateKbps?: number;
  sampleRateHz?: number;
  bitDepth?: number;
  channels?: number;
  transcoding?: boolean;
}

export interface Capabilities {
  playPause: boolean;
  next: boolean;
  previous: boolean;
  seek: boolean;
  volume: boolean;
}

export interface NowPlaying {
  source: SourceId;
  state: PlayState;
  track: Track;
  progressMs: number;
  /** Epoch ms at which progressMs was sampled; the client interpolates from here. */
  sampledAt: number;
  device: { name: string; type?: string; volumePercent?: number | null };
  quality?: Quality;
  capabilities: Capabilities;
  /** Plex-only: id of the audio stream, for the loudness waveform. */
  plexStreamId?: number;
  /** Plex-only: whether controls go to a Chromecast directly. */
  viaCast?: boolean;
}

export interface SourceStatus {
  configured: boolean;
  ok: boolean;
  error?: string;
  lastPoll?: number;
}

export interface HistoryItem {
  source: SourceId;
  title: string;
  artist: string;
  album: string;
  artUrl?: string;
  playedAt: number;
}

export interface BroadcastState {
  active: NowPlaying | null;
  sessions: Partial<Record<SourceId, NowPlaying | null>>;
  pin: SourceId | null;
  status: Record<SourceId, SourceStatus>;
  history: HistoryItem[];
  queue: Track[];
  serverTime: number;
}

export interface Source {
  id: SourceId;
  isConfigured(): boolean;
  /** Poll once; returns current session or null when nothing is playing. */
  poll(): Promise<NowPlaying | null>;
  /** Recommended delay before next poll. */
  nextDelayMs(current: NowPlaying | null): number;
  queue(current: NowPlaying): Promise<Track[]>;
  control(cmd: ControlCommand, current: NowPlaying | null): Promise<void>;
}

export type ControlCommand =
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'next' }
  | { type: 'previous' }
  | { type: 'seek'; positionMs: number }
  | { type: 'volume'; percent: number };
