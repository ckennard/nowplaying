import type { NowPlaying, SourceId } from './types.js';

export interface Tracked {
  np: NowPlaying | null;
  /** When this source last went from not-playing to playing. Track changes don't reset it. */
  playingSince: number | null;
  /** Last time this source had a playing session. */
  lastActive: number;
}

export const emptyTracked = (): Tracked => ({ np: null, playingSince: null, lastActive: 0 });

/** Paused sessions stay on screen this long before the idle screen takes over. */
export const PAUSED_GRACE_MS = 30 * 60_000;

export function track(prev: Tracked, np: NowPlaying | null, now: number): Tracked {
  const wasPlaying = prev.np?.state === 'playing';
  const isPlaying = np?.state === 'playing';
  return {
    np,
    playingSince: isPlaying ? (wasPlaying && prev.playingSince ? prev.playingSince : now) : null,
    lastActive: isPlaying ? now : np ? prev.lastActive || now : prev.lastActive,
  };
}

export function pickActive(all: Partial<Record<SourceId, Tracked>>, pin: SourceId | null, now: number): SourceId | null {
  if (pin && all[pin]?.np) return pin;
  const entries = Object.entries(all) as [SourceId, Tracked][];
  const playing = entries
    .filter(([, t]) => t.np?.state === 'playing')
    .sort((a, b) => (b[1].playingSince ?? 0) - (a[1].playingSince ?? 0));
  if (playing.length) return playing[0][0];
  const paused = entries
    .filter(([, t]) => t.np && now - t.lastActive < PAUSED_GRACE_MS)
    .sort((a, b) => b[1].lastActive - a[1].lastActive);
  return paused.length ? paused[0][0] : null;
}
