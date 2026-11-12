// The wire types are the server's own, so a change there is a compile error here rather than a silent runtime mismatch.
export type { BroadcastState, Capabilities, ControlCommand, HistoryItem, NowPlaying, SourceId, SourceStatus, Track } from '../../server/src/types';

export type VizMode = 'aurora' | 'art' | 'spectrum' | 'off';
export interface PublicConfig {
  version: string; pinRequired: boolean; spotifyRedirectUri: string; secureContext: boolean; needsSetup: boolean;
  ui: { overlayTimeoutSec: number; panelTimeoutSec: number; defaultViz: VizMode; lyrics: boolean; wakeLock: boolean };
}
