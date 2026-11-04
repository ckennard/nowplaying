import type { BroadcastState, Track } from '../types';

/** Synthetic state for previewing the UI (open /?demo). Nothing talks to Spotify or Plex. */
const art = (a: string, b: string, c: string) =>
  'data:image/svg+xml;utf8,' + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600"><defs><radialGradient id="g" cx=".3" cy=".3" r="1"><stop offset="0" stop-color="${a}"/><stop offset=".55" stop-color="${b}"/><stop offset="1" stop-color="${c}"/></radialGradient></defs><rect width="600" height="600" fill="url(#g)"/><circle cx="420" cy="380" r="120" fill="${a}" opacity=".35"/><circle cx="180" cy="430" r="60" fill="${c}" opacity=".5"/></svg>`,
  );

const tracks: Track[] = [
  { id: 'd1', title: 'Glass Horizon', artist: 'The Lumen Assembly', album: 'Northern Static', year: 2024, trackNumber: 4, durationMs: 245000, genres: ['Dream Pop', 'Shoegaze'], label: 'Driftwood Records', artUrl: art('#ffb36b', '#d9486b', '#2a1446') },
  { id: 'd2', title: 'Saltwater Telegraph', artist: 'Mira Okafor', album: 'Low Tide Signals', year: 2023, durationMs: 198000, artUrl: art('#7ee0ff', '#2f6bd8', '#0b1838') },
  { id: 'd3', title: 'Copperleaf', artist: 'Halvard & the Quiet Engines', album: 'Copperleaf', year: 2022, durationMs: 301000, artUrl: art('#c7f27a', '#3a9b6c', '#10261f') },
];

export function demoState(startedAt: number, now = Date.now()): BroadcastState {
  const elapsed = now - startedAt;
  const t = tracks[0];
  return {
    active: {
      source: 'plex', state: 'playing', track: t, progressMs: elapsed % t.durationMs, sampledAt: now,
      device: { name: 'Chromecast Audio', type: 'Plex Cast', volumePercent: 55 },
      quality: { codec: 'FLAC', bitDepth: 24, sampleRateHz: 48000, bitrateKbps: 2304, channels: 2, transcoding: false },
      capabilities: { playPause: true, next: true, previous: true, seek: true, volume: true }, viaCast: true,
    },
    sessions: {},
    pin: null,
    status: { spotify: { configured: true, ok: true }, plex: { configured: true, ok: true } },
    history: tracks.map((x, i) => ({ source: i % 2 ? 'spotify' : 'plex', title: x.title, artist: x.artist, album: x.album, artUrl: x.artUrl, playedAt: now - i * 420000 })),
    queue: tracks.slice(1),
    serverTime: now,
  };
}
