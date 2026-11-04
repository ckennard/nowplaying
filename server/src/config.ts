import { promises as fs } from 'node:fs';
import path from 'node:path';

export interface Settings {
  publicUrl: string;
  adminPin: string;
  plex: { url: string; token: string };
  tautulli: { url: string; apiKey: string };
  spotify: {
    clientId: string;
    clientSecret: string;
    refreshToken: string;
    accessToken: string;
    expiresAt: number;
  };
  cast: { hostOverride: string; enabled: boolean };
  ui: {
    overlayTimeoutSec: number;
    panelTimeoutSec: number;
    defaultViz: 'aurora' | 'art' | 'spectrum' | 'off';
    lyrics: boolean;
    wakeLock: boolean;
  };
}

const defaults: Settings = {
  publicUrl: '',
  adminPin: '',
  plex: { url: '', token: '' },
  tautulli: { url: '', apiKey: '' },
  spotify: { clientId: '', clientSecret: '', refreshToken: '', accessToken: '', expiresAt: 0 },
  cast: { hostOverride: '', enabled: true },
  ui: { overlayTimeoutSec: 6, panelTimeoutSec: 45, defaultViz: 'aurora', lyrics: false, wakeLock: true },
};

export const CONFIG_DIR = process.env.CONFIG_DIR || '/config';
const FILE = path.join(CONFIG_DIR, 'settings.json');

let current: Settings = structuredClone(defaults);

function deepMerge<T>(base: T, patch: unknown): T {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return base;
  const out: any = Array.isArray(base) ? [...(base as any)] : { ...(base as any) };
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    if (!(k in out)) continue; // ignore unknown keys
    const b = out[k];
    if (b && typeof b === 'object' && !Array.isArray(b)) out[k] = deepMerge(b, v);
    else if (typeof v === typeof b) out[k] = v;
  }
  return out;
}

/** Environment variables take precedence over the settings file (useful for template-driven installs). */
function applyEnv(s: Settings): Settings {
  const e = process.env;
  const o = structuredClone(s);
  if (e.PUBLIC_URL) o.publicUrl = e.PUBLIC_URL;
  if (e.PLEX_URL) o.plex.url = e.PLEX_URL;
  if (e.PLEX_TOKEN) o.plex.token = e.PLEX_TOKEN;
  if (e.TAUTULLI_URL) o.tautulli.url = e.TAUTULLI_URL;
  if (e.TAUTULLI_API_KEY) o.tautulli.apiKey = e.TAUTULLI_API_KEY;
  if (e.SPOTIFY_CLIENT_ID) o.spotify.clientId = e.SPOTIFY_CLIENT_ID;
  if (e.SPOTIFY_CLIENT_SECRET) o.spotify.clientSecret = e.SPOTIFY_CLIENT_SECRET;
  if (e.CAST_HOST) o.cast.hostOverride = e.CAST_HOST;
  if (e.ADMIN_PIN) o.adminPin = e.ADMIN_PIN;
  return o;
}

export async function loadSettings(): Promise<Settings> {
  try {
    const raw = JSON.parse(await fs.readFile(FILE, 'utf8'));
    current = deepMerge(structuredClone(defaults), raw);
  } catch (err: any) {
    if (err?.code !== 'ENOENT') console.error('[config] failed to read settings, using defaults:', err.message);
    current = structuredClone(defaults);
  }
  return settings();
}

export function settings(): Settings {
  return applyEnv(current);
}

let writeChain: Promise<void> = Promise.resolve();
export function updateSettings(patch: unknown): Promise<Settings> {
  current = deepMerge(current, patch);
  const snapshot = JSON.stringify(current, null, 2);
  writeChain = writeChain.then(async () => {
    await fs.mkdir(CONFIG_DIR, { recursive: true });
    const tmp = FILE + '.tmp';
    await fs.writeFile(tmp, snapshot, { mode: 0o600 });
    await fs.rename(tmp, FILE);
  }).catch((err) => console.error('[config] failed to save settings:', err.message));
  return writeChain.then(() => settings());
}

const SECRET = '••••••••';
/** Settings safe to hand to the browser: secrets are replaced by a mask if set. */
export function redactedSettings() {
  const s = settings();
  const mask = (v: string) => (v ? SECRET : '');
  return {
    ...s,
    adminPin: mask(s.adminPin),
    plex: { url: s.plex.url, token: mask(s.plex.token) },
    tautulli: { url: s.tautulli.url, apiKey: mask(s.tautulli.apiKey) },
    spotify: {
      clientId: s.spotify.clientId,
      clientSecret: mask(s.spotify.clientSecret),
      connected: Boolean(s.spotify.refreshToken),
    },
    envLocked: Object.fromEntries(
      ['PUBLIC_URL', 'PLEX_URL', 'PLEX_TOKEN', 'TAUTULLI_URL', 'TAUTULLI_API_KEY', 'SPOTIFY_CLIENT_ID', 'SPOTIFY_CLIENT_SECRET', 'CAST_HOST', 'ADMIN_PIN']
        .map((k) => [k, Boolean(process.env[k])]),
    ),
  };
}

/** Removes masked placeholders from a patch posted by the settings form so they don't overwrite real secrets. */
export function stripMasked(patch: any): any {
  if (!patch || typeof patch !== 'object') return patch;
  const out: any = Array.isArray(patch) ? [] : {};
  for (const [k, v] of Object.entries(patch)) {
    if (v === SECRET) continue;
    out[k] = v && typeof v === 'object' ? stripMasked(v) : v;
  }
  return out;
}
