# nowplaying

A full-screen now-playing display and ambient visualizer for **Spotify** and **Plex**, built for an always-on laptop or tablet screen. It was designed for an original Surface Book: 3000×2000 at 200% scaling, which gives a 1500×1000 CSS-pixel viewport with touch. It runs as a single Docker container on Unraid.

- Large album art with title, artist, album and year. A waveform progress bar comes from Plex's loudness analysis when it's available.
- **Ambient visualizers:** an Aurora shader colored from the album art, or a blurred "album glow". Turn on the mic (`M`) to make either react to the room, or switch to the spectrum analyzer.
- **Auto-hiding overlays:** playback controls, up-next queue, track details, and synced lyrics from LRCLIB.
- **Source arbitration:** whichever of Spotify or Plex started playing most recently is shown, and you can pin one.
- **Plex on Chromecast:** Plex can't remote-control Cast sessions, so controls talk to the Chromecast directly (Cast v2, no extra dependencies).
- An idle screen with a clock and recently played tracks, Wake Lock, and slow pixel drift to protect against burn-in.

## Keyboard / touch

Tap or move the mouse to show the controls; they hide again after a few seconds.

| Key | Action |
| --- | --- |
| Space | Play / pause |
| ← / → | Previous / next |
| Q | Up next |
| I | Details |
| L | Lyrics |
| V | Cycle visualizer |
| M | Microphone on/off |
| F | Fullscreen |
| Esc | Close panel |

Open `/?demo` to preview the UI with a fake track, or `/?demo=idle` for the idle screen.

## Install on Unraid

1. Copy `unraid/nowplaying.xml` to `/boot/config/plugins/dockerMan/templates-user/my-nowplaying.xml`.
2. In **Docker → Add Container**, pick the `nowplaying` template and apply it.
3. The template turns on Unraid's built-in **Tailscale** integration with **Serve**, so the app is published at `https://nowplaying.<your-tailnet>.ts.net`. On first start, open the container log, follow the Tailscale login link, and approve the node. HTTPS must be enabled for your tailnet (Tailscale admin → DNS → HTTPS Certificates).
4. Open the `https://` address, then go to **Settings** (gear icon).

Updates: every push to `main` publishes `ghcr.io/ckennard/nowplaying:latest`, and Unraid's Docker page shows **update ready** like any other container. Settings live in `/config` and survive updates.

## Settings

All credentials are entered in the web UI and stored in `/config/settings.json` with permissions 0600. Environment variables override them if set: `PLEX_URL`, `PLEX_TOKEN`, `TAUTULLI_URL`, `TAUTULLI_API_KEY`, `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, `CAST_HOST`, `PUBLIC_URL`, `ADMIN_PIN`.

- **Spotify:** create an app at <https://developer.spotify.com/dashboard> and add the Redirect URI shown in Settings (`https://nowplaying.<tailnet>.ts.net/api/auth/spotify/callback`). Spotify rejects plain `http://` redirect URIs other than loopback. Playback control and the queue require Premium.
- **Plex:** server URL (for example `http://192.168.1.69:32400`) plus a Plex token. Tautulli is an optional read-only fallback.
- **Chromecast:** detected from the Plex session. If controls don't work, set its IP manually and give it a DHCP reservation.

## Development

```bash
npm install
npm run dev:server   # API on :8686 (set CONFIG_DIR=./config)
npm run dev:web      # Vite on :5173, proxies /api
npm test
npm run typecheck
```

`server/` holds the Fastify + TypeScript backend. It polls the sources, pushes state over SSE (`/api/stream`), and proxies album art so Plex tokens never reach the browser. `web/` holds the React + Vite frontend.
