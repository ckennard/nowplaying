import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { mapPlexSession } from '../src/sources/plex';
import { mapSpotifyPlayer } from '../src/sources/spotify';
import { mapTautulliSession } from '../src/sources/tautulli';
import { decodeCastMessage, encodeCastMessage } from '../src/sources/cast';
import { stripMasked } from '../src/config';

const fx = (n: string) => JSON.parse(readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8'));

describe('plex mapping', () => {
  it('maps a cast music session', () => {
    const m = fx('plex-session.json').MediaContainer.Metadata[0];
    const np = mapPlexSession(m, { genres: ['Trip Hop'], label: 'Virgin', year: 1998 }, 1000);
    expect(np.track).toMatchObject({ title: 'Teardrop', artist: 'Massive Attack', album: 'Mezzanine', year: 1998, trackNumber: 3, genres: ['Trip Hop'], label: 'Virgin', durationMs: 330000 });
    expect(np.track.artUrl).toBe('/api/art?src=' + encodeURIComponent('plex:/library/metadata/48200/thumb/1700000000'));
    expect(np.state).toBe('playing');
    expect(np.progressMs).toBe(61234);
    expect(np.quality).toMatchObject({ codec: 'FLAC', sampleRateHz: 44100, bitDepth: 16 });
    expect(np.plexStreamId).toBe(99123);
    expect(np.viaCast).toBe(true);
    expect(np.capabilities.volume).toBe(true);
    expect(JSON.stringify(np.track)).not.toContain('Token');
  });
});

describe('spotify mapping', () => {
  it('maps the player state', () => {
    const np = mapSpotifyPlayer(fx('spotify-player.json'), 5000)!;
    expect(np.track).toMatchObject({ title: 'Windowlicker', artist: 'Aphex Twin', year: 1999, durationMs: 367000 });
    expect(np.track.artUrl).toBe('/api/art?src=' + encodeURIComponent('https://i.scdn.co/image/big'));
    expect(np.device).toMatchObject({ name: 'Kitchen', volumePercent: 42 });
    expect(np.capabilities).toMatchObject({ pause: true, play: false }); // fixture disallows resuming
    const paused = mapSpotifyPlayer({ ...fx('spotify-player.json'), is_playing: false, actions: { disallows: { pausing: true } } })!;
    expect(paused.capabilities).toMatchObject({ play: true, pause: false });
    expect(np.sampledAt).toBe(5000);
  });
  it('returns null when nothing is playing', () => {
    expect(mapSpotifyPlayer(null)).toBeNull();
    expect(mapSpotifyPlayer({ is_playing: false, item: null })).toBeNull();
  });
});

describe('tautulli mapping', () => {
  it('maps get_activity session', () => {
    const np = mapTautulliSession({ media_type: 'track', state: 'paused', rating_key: '1', title: 'T', grandparent_title: 'A', parent_title: 'B', parent_year: '2001', duration: '1000', view_offset: '10', parent_thumb: '/x', player: 'Phone', stream_audio_codec: 'mp3' });
    expect(np).toMatchObject({ state: 'paused', track: { title: 'T', artist: 'A', year: 2001 }, quality: { codec: 'MP3' } });
    expect(np.capabilities).toMatchObject({ play: false, pause: false });
  });
});

describe('cast protobuf', () => {
  it('round-trips a message', () => {
    const payload = JSON.stringify({ type: 'GET_STATUS', requestId: 7, text: 'é'.repeat(200) });
    const frame = encodeCastMessage('sender-0', 'receiver-0', 'urn:x-cast:com.google.cast.receiver', payload);
    expect(frame.readUInt32BE(0)).toBe(frame.length - 4);
    const m = decodeCastMessage(frame.subarray(4));
    expect(m).toEqual({ source: 'sender-0', dest: 'receiver-0', namespace: 'urn:x-cast:com.google.cast.receiver', payload });
  });
});

describe('settings masking', () => {
  it('drops masked secrets from posted patches', () => {
    expect(stripMasked({ plex: { url: 'u', token: '••••••••' }, adminPin: '••••••••' })).toEqual({ plex: { url: 'u' } });
  });
});

import { normalizeServerUrl } from '../src/sources/plex';
describe('server url normalization', () => {
  it('adds http:// and trims slashes', () => {
    expect(normalizeServerUrl(' 192.168.1.69:32400/ ')).toBe('http://192.168.1.69:32400');
    expect(normalizeServerUrl('https://plex.example.com//')).toBe('https://plex.example.com');
    expect(normalizeServerUrl('')).toBe('');
  });
});
