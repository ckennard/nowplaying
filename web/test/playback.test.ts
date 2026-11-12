import { describe, expect, it } from 'vitest';
import { toggleCommand } from '../src/lib/playback';
import type { NowPlaying } from '../src/types';

const np = (state: NowPlaying['state'], play: boolean, pause: boolean): NowPlaying => ({
  source: 'spotify', state, track: { id: 'x', title: 'x', artist: 'a', album: 'b', durationMs: 1000 }, progressMs: 0, sampledAt: 0,
  device: { name: 'd' }, capabilities: { play, pause, next: true, previous: true, seek: true, volume: true },
});

describe('play/pause toggle', () => {
  it('pauses while playing and is gated on the pause capability only', () => {
    expect(toggleCommand(np('playing', false, true))).toEqual({ type: 'pause', enabled: true });
    expect(toggleCommand(np('playing', true, false))).toEqual({ type: 'pause', enabled: false });
  });
  it('plays otherwise and is gated on the play capability only', () => {
    expect(toggleCommand(np('paused', true, false))).toEqual({ type: 'play', enabled: true });
    expect(toggleCommand(np('paused', false, true))).toEqual({ type: 'play', enabled: false });
    expect(toggleCommand(np('stopped', true, true))).toEqual({ type: 'play', enabled: true });
  });
  it('is disabled with no session', () => {
    expect(toggleCommand(null)).toEqual({ type: 'play', enabled: false });
  });
});
