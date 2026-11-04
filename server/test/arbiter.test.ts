import { describe, expect, it } from 'vitest';
import { emptyTracked, pickActive, track, PAUSED_GRACE_MS } from '../src/arbiter';
import type { NowPlaying } from '../src/types';

const np = (source: 'spotify' | 'plex', state: 'playing' | 'paused', id = 'x'): NowPlaying => ({
  source, state, track: { id, title: id, artist: 'a', album: 'b', durationMs: 1000 }, progressMs: 0, sampledAt: 0,
  device: { name: 'd' }, capabilities: { playPause: true, next: true, previous: true, seek: true, volume: true },
});

describe('arbiter', () => {
  it('picks the source that started playing most recently', () => {
    let s = track(emptyTracked(), np('spotify', 'playing'), 1000);
    let p = track(emptyTracked(), np('plex', 'playing'), 2000);
    expect(pickActive({ spotify: s, plex: p }, null, 3000)).toBe('plex');
    // Spotify auto-advancing to the next track does not steal focus.
    s = track(s, np('spotify', 'playing', 'y'), 4000);
    expect(pickActive({ spotify: s, plex: p }, null, 4000)).toBe('plex');
    // Pausing and resuming Spotify does.
    s = track(s, np('spotify', 'paused', 'y'), 5000);
    s = track(s, np('spotify', 'playing', 'y'), 6000);
    expect(pickActive({ spotify: s, plex: p }, null, 6000)).toBe('spotify');
  });

  it('prefers playing over paused, and honors a pin', () => {
    const s = track(emptyTracked(), np('spotify', 'paused'), 5000);
    const p = track(emptyTracked(), np('plex', 'playing'), 1000);
    expect(pickActive({ spotify: s, plex: p }, null, 6000)).toBe('plex');
    expect(pickActive({ spotify: s, plex: p }, 'spotify', 6000)).toBe('spotify');
  });

  it('ignores a pin on a source with no session', () => {
    const p = track(emptyTracked(), np('plex', 'playing'), 1000);
    expect(pickActive({ spotify: emptyTracked(), plex: p }, 'spotify', 2000)).toBe('plex');
  });

  it('falls back to idle once a paused session is stale', () => {
    let s = track(emptyTracked(), np('spotify', 'playing'), 1000);
    s = track(s, np('spotify', 'paused'), 2000);
    expect(pickActive({ spotify: s }, null, 3000)).toBe('spotify');
    expect(pickActive({ spotify: s }, null, 1000 + PAUSED_GRACE_MS + 1)).toBeNull();
  });
});
