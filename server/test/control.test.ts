import { describe, expect, it } from 'vitest';
import { checkControl, ControlRejected, parseControl, publicNp } from '../src/hub';
import type { Capabilities, NowPlaying } from '../src/types';

const np = (state: 'playing' | 'paused', caps: Partial<Capabilities> = {}): NowPlaying => ({
  source: 'spotify', state, track: { id: 'x', title: 'x', artist: 'a', album: 'b', durationMs: 1000 }, progressMs: 0, sampledAt: 0,
  device: { name: 'd' }, capabilities: { play: true, pause: true, next: true, previous: true, seek: true, volume: true, ...caps },
});

describe('control validation', () => {
  it('accepts well-formed commands and drops extra fields', () => {
    expect(parseControl({ type: 'pause', source: 'spotify' })).toEqual({ type: 'pause' });
    expect(parseControl({ type: 'seek', positionMs: 1500 })).toEqual({ type: 'seek', positionMs: 1500 });
    expect(parseControl({ type: 'volume', percent: 40 })).toEqual({ type: 'volume', percent: 40 });
  });
  it('rejects unknown commands and non-numeric arguments', () => {
    for (const body of [undefined, null, {}, { type: 'stop' }, { type: 'seek' }, { type: 'seek', positionMs: '10' }, { type: 'volume', percent: NaN }]) {
      expect(parseControl(body)).toBeNull();
    }
  });
});

describe('capability enforcement', () => {
  it('rejects a command with no session', () => {
    expect(() => checkControl({ type: 'play' }, null)).toThrow(ControlRejected);
  });
  it('rejects exactly the commands the session disallows', () => {
    const playing = np('playing', { play: false, seek: false });
    expect(() => checkControl({ type: 'play' }, playing)).toThrow(ControlRejected);
    expect(() => checkControl({ type: 'seek', positionMs: 0 }, playing)).toThrow(ControlRejected);
    expect(checkControl({ type: 'pause' }, playing)).toBe(playing);
    expect(checkControl({ type: 'volume', percent: 10 }, playing)).toBe(playing);
  });
});

describe('broadcast shape', () => {
  it('strips internal fields and keeps the legacy combined play/pause flag in step with the state', () => {
    const playing = publicNp({ ...np('playing', { play: false }), _player: { address: '10.0.0.2' } } as NowPlaying)!;
    expect(playing).not.toHaveProperty('_player');
    expect(playing.capabilities).toMatchObject({ play: false, pause: true, playPause: true });
    expect(publicNp(np('paused', { play: false }))!.capabilities).toMatchObject({ playPause: false });
    expect(publicNp(null)).toBeNull();
  });
});
