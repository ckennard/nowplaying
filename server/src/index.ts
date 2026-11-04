import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import fastifyStatic from '@fastify/static';
import { loadSettings, redactedSettings, settings, stripMasked, updateSettings } from './config.js';
import { Hub } from './hub.js';
import { plexArtUrl, plexLevels, plexTest } from './sources/plex.js';
import { spotifyAuthorizeUrl, spotifyHandleCallback, spotifyTest } from './sources/spotify.js';
import { tautulliTest, tautulliUrl } from './sources/tautulli.js';
import { castStatus } from './sources/cast.js';
import type { ControlCommand, SourceId } from './types.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(path.resolve(here, '../../package.json'), 'utf8'));
const VERSION: string = process.env.APP_VERSION || pkg.version;
const PORT = Number(process.env.PORT || 8686);

await loadSettings();
const hub = new Hub();
const app = Fastify({ logger: { level: process.env.LOG_LEVEL || 'info' }, trustProxy: true });

// ---------- helpers ----------
function baseUrl(req: FastifyRequest): string {
  const s = settings();
  if (s.publicUrl) return s.publicUrl.replace(/\/+$/, '');
  const host = (req.headers['x-forwarded-host'] as string) || req.headers.host || `localhost:${PORT}`;
  const fwdProto = (req.headers['x-forwarded-proto'] as string)?.split(',')[0];
  const proto = fwdProto || (/\.ts\.net(:\d+)?$/.test(host) ? 'https' : req.protocol);
  return `${proto}://${host}`;
}

function pinOk(req: FastifyRequest): boolean {
  const pin = settings().adminPin;
  if (!pin) return true;
  const given = String(req.headers['x-admin-pin'] ?? (req.query as any)?.pin ?? '');
  const a = crypto.createHash('sha256').update(given).digest();
  const b = crypto.createHash('sha256').update(pin).digest();
  return crypto.timingSafeEqual(a, b);
}

function requirePin(req: FastifyRequest, reply: FastifyReply): boolean {
  if (pinOk(req)) return true;
  reply.code(401).send({ error: 'Admin PIN required' });
  return false;
}

class Lru<V> {
  private m = new Map<string, V>();
  constructor(private max: number) {}
  get(k: string) {
    const v = this.m.get(k);
    if (v !== undefined) { this.m.delete(k); this.m.set(k, v); }
    return v;
  }
  set(k: string, v: V) {
    this.m.set(k, v);
    if (this.m.size > this.max) this.m.delete(this.m.keys().next().value!);
  }
}

// ---------- realtime ----------
app.get('/api/stream', (req, reply) => {
  reply.hijack();
  const res = reply.raw;
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 3000\n\n');
  const unsub = hub.subscribe((s) => res.write(`data: ${JSON.stringify(s)}\n\n`));
  const hb = setInterval(() => res.write(': hb\n\n'), 20_000);
  req.raw.on('close', () => { clearInterval(hb); unsub(); });
});

app.get('/api/state', async () => hub.snapshot());

app.get('/api/health', async () => ({ ok: true, version: VERSION, uptimeSec: Math.round(process.uptime()), sources: hub.statusSummary() }));

// ---------- controls ----------
app.post<{ Body: ControlCommand & { source?: SourceId } }>('/api/control', async (req, reply) => {
  const { source, ...cmd } = req.body ?? ({} as any);
  const valid = ['play', 'pause', 'next', 'previous', 'seek', 'volume'];
  if (!valid.includes((cmd as any).type)) return reply.code(400).send({ error: 'Unknown command' });
  try {
    await hub.control(cmd as ControlCommand, source);
    return { ok: true };
  } catch (e: any) {
    return reply.code(502).send({ error: e.message });
  }
});

app.post<{ Body: { pin: SourceId | null } }>('/api/pin', async (req) => {
  const p = req.body?.pin;
  hub.setPin(p === 'spotify' || p === 'plex' ? p : null);
  return { pin: hub.pin };
});

// ---------- art proxy ----------
const artCache = new Lru<{ type: string; body: Buffer }>(120);
function isAllowedRemote(u: URL) {
  return u.protocol === 'https:' && (/(^|\.)scdn\.co$/.test(u.hostname) || /(^|\.)spotifycdn\.com$/.test(u.hostname));
}
app.get<{ Querystring: { src?: string } }>('/api/art', async (req, reply) => {
  const src = req.query.src ?? '';
  let url: string;
  if (src.startsWith('plex:/')) url = plexArtUrl(src.slice(5));
  else if (src.startsWith('tautulli:/')) url = tautulliUrl('pms_image_proxy', { img: src.slice(9), width: '1000', height: '1000', fallback: 'cover' });
  else {
    let u: URL;
    try { u = new URL(src); } catch { return reply.code(400).send({ error: 'bad src' }); }
    if (!isAllowedRemote(u)) return reply.code(400).send({ error: 'host not allowed' });
    url = u.toString();
  }
  let hit = artCache.get(src);
  if (!hit) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      if (!r.ok) return reply.code(r.status === 404 ? 404 : 502).send();
      hit = { type: r.headers.get('content-type') || 'image/jpeg', body: Buffer.from(await r.arrayBuffer()) };
      artCache.set(src, hit);
    } catch {
      return reply.code(504).send();
    }
  }
  return reply.header('Content-Type', hit.type).header('Cache-Control', 'public, max-age=604800, immutable').send(hit.body);
});

// ---------- extras: lyrics + waveform ----------
const lyricsCache = new Lru<any>(300);
app.get<{ Querystring: { artist?: string; title?: string; album?: string; durationMs?: string } }>('/api/lyrics', async (req, reply) => {
  const { artist = '', title = '', album = '', durationMs = '' } = req.query;
  if (!artist || !title) return reply.code(400).send({ error: 'artist and title required' });
  const key = [artist, title, album, Math.round(Number(durationMs) / 2000)].join('|').toLowerCase();
  const cached = lyricsCache.get(key);
  if (cached) return cached;
  const q = new URLSearchParams({ artist_name: artist, track_name: title });
  if (album) q.set('album_name', album);
  if (Number(durationMs) > 0) q.set('duration', String(Math.round(Number(durationMs) / 1000)));
  const headers = { 'User-Agent': `nowplaying/${VERSION} (https://github.com/ckennard/nowplaying)` };
  try {
    let r = await fetch(`https://lrclib.net/api/get?${q}`, { headers, signal: AbortSignal.timeout(8000) });
    let j: any = r.ok ? await r.json() : null;
    if (!j) {
      // fall back to a search without album/duration constraints
      r = await fetch(`https://lrclib.net/api/search?${new URLSearchParams({ artist_name: artist, track_name: title })}`, { headers, signal: AbortSignal.timeout(8000) });
      const list: any[] = r.ok ? await r.json() : [];
      j = list.find((x) => x.syncedLyrics) ?? list[0] ?? null;
    }
    const out = { synced: j?.syncedLyrics ?? null, plain: j?.plainLyrics ?? null, instrumental: Boolean(j?.instrumental) };
    lyricsCache.set(key, out);
    return out;
  } catch {
    return { synced: null, plain: null, instrumental: false };
  }
});

const levelsCache = new Lru<number[] | null>(100);
app.get<{ Querystring: { streamId?: string } }>('/api/plex/levels', async (req) => {
  const id = Number(req.query.streamId);
  if (!Number.isFinite(id)) return { levels: null };
  const k = String(id);
  let levels = levelsCache.get(k);
  if (levels === undefined) {
    levels = await plexLevels(id, 240);
    levelsCache.set(k, levels);
  }
  return { levels };
});

// ---------- settings ----------
app.get('/api/config', async (req) => {
  const s = settings();
  return {
    version: VERSION,
    ui: s.ui,
    pinRequired: Boolean(s.adminPin),
    spotifyRedirectUri: `${baseUrl(req)}/api/auth/spotify/callback`,
    secureContext: baseUrl(req).startsWith('https://'),
    needsSetup: !hub.sources.spotify.isConfigured() && !hub.sources.plex.isConfigured(),
  };
});

app.get('/api/settings', async (req, reply) => {
  if (!requirePin(req, reply)) return;
  return redactedSettings();
});

app.put('/api/settings', async (req, reply) => {
  if (!requirePin(req, reply)) return;
  const patch = stripMasked(req.body ?? {});
  delete patch.spotify?.accessToken;
  delete patch.spotify?.refreshToken;
  delete patch.spotify?.expiresAt;
  await updateSettings(patch);
  hub.poke('spotify', 0);
  hub.poke('plex', 0);
  return redactedSettings();
});

app.post<{ Params: { service: string } }>('/api/test/:service', async (req, reply) => {
  if (!requirePin(req, reply)) return;
  try {
    switch (req.params.service) {
      case 'plex': return { ok: true, message: await plexTest() };
      case 'tautulli': return { ok: true, message: await tautulliTest() };
      case 'spotify': return { ok: true, message: await spotifyTest() };
      case 'cast': {
        const host = settings().cast.hostOverride || (req.body as any)?.host;
        if (!host) throw new Error('No Chromecast IP set');
        const r = await castStatus(host);
        return { ok: true, message: `Chromecast reachable${r.volumePercent != null ? `, volume ${r.volumePercent}%` : ''}` };
      }
      default: return reply.code(404).send({ ok: false, message: 'Unknown service' });
    }
  } catch (e: any) {
    return { ok: false, message: e.message };
  }
});

app.post('/api/auth/spotify/disconnect', async (req, reply) => {
  if (!requirePin(req, reply)) return;
  await updateSettings({ spotify: { refreshToken: '', accessToken: '', expiresAt: 0 } });
  hub.poke('spotify', 0);
  return { ok: true };
});

app.get('/api/auth/spotify/login', async (req, reply) => {
  if (!requirePin(req, reply)) return;
  try {
    return reply.redirect(spotifyAuthorizeUrl(`${baseUrl(req)}/api/auth/spotify/callback`));
  } catch (e: any) {
    return reply.redirect('/#settings?spotify_error=' + encodeURIComponent(e.message));
  }
});

app.get<{ Querystring: { code?: string; state?: string; error?: string } }>('/api/auth/spotify/callback', async (req, reply) => {
  const { code, state, error } = req.query;
  if (error || !code || !state) return reply.redirect('/#settings?spotify_error=' + encodeURIComponent(error || 'missing code'));
  try {
    await spotifyHandleCallback(code, state);
    hub.poke('spotify', 0);
    return reply.redirect('/#settings?spotify=connected');
  } catch (e: any) {
    return reply.redirect('/#settings?spotify_error=' + encodeURIComponent(e.message));
  }
});

// ---------- static UI ----------
await app.register(fastifyStatic, {
  root: path.resolve(here, '../web'),
  wildcard: false,
  setHeaders(res, p) {
    if (p.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache');
    else if (p.includes('/assets/')) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  },
});
app.get('/*', (req, reply) => {
  if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'Not found' });
  return reply.sendFile('index.html');
});

await hub.start();
await app.listen({ host: '0.0.0.0', port: PORT });
app.log.info(`nowplaying ${VERSION} listening on :${PORT}`);

for (const sig of ['SIGTERM', 'SIGINT'] as const) process.on(sig, () => app.close().then(() => process.exit(0)));
