import type { NowPlaying } from '../types';

/** What the play/pause toggle does for this session, and whether the player currently allows it. */
export function toggleCommand(np: NowPlaying | null): { type: 'play' | 'pause'; enabled: boolean } {
  const type = np?.state === 'playing' ? 'pause' : 'play';
  return { type, enabled: Boolean(np?.capabilities[type]) };
}
