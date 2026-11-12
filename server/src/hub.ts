import { promises as fs } from 'node:fs';
import path from 'node:path';
import { emptyTracked, pickActive, track, type Tracked } from './arbiter.js';
import { CONFIG_DIR, settings } from './config.js';
import { PlexSource } from './sources/plex.js';
import { mapSpotifyItem, SpotifySource, spotifyRecent } from './sources/spotify.js';
import { TautulliSource } from './sources/tautulli.js';
import type { BroadcastState, ControlCommand, HistoryItem, NowPlaying, Source, SourceId, SourceStatus, Track } from './types.js';

const HISTORY_FILE = path.join(CONFIG_DIR, 'history.json');
const HISTORY_MAX = 40;
/** A source that keeps failing stops showing its last known session after this long. */
const STALE_AFTER_MS = 60_000;

/** A command that can't apply to the current session (as opposed to an upstream failure). */
export class ControlRejected extends Error {}

/** Validates an untrusted request body into a command; null when it isn't one. */
export function parseControl(body: any): ControlCommand | null {
  switch (body?.type) {
    case 'play': case 'pause': case 'next': case 'previous':
      return { type: body.type };
    case 'seek':
      return Number.isFinite(body.positionMs) ? { type: 'seek', positionMs: body.positionMs } : null;
    case 'volume':
      return Number.isFinite(body.percent) ? { type: 'volume', percent: body.percent } : null;
    default:
      return null;
  }
}

/** The single place capabilities are enforced, so every client (and stale tab) gets the same answer. */
export function checkControl(cmd: ControlCommand, np: NowPlaying | null): NowPlaying {
  if (!np) throw new ControlRejected('Nothing is playing');
  if (!np.capabilities[cmd.type]) throw new ControlRejected(`This player does not allow "${cmd.type}" right now`);
  return np;
}

/** Picks Plex (token) over Tautulli (read-only) depending on what's configured right now. */
class PlexOrTautulli implements Source {
  id = 'plex' as const;
  plex = new PlexSource();
  tautulli = new TautulliSource();
  private get impl(): Source { return this.plex.isConfigured() ? this.plex : this.tautulli; }
  isConfigured() { return this.plex.isConfigured() || this.tautulli.isConfigured(); }
  poll() { return this.impl.poll(); }
  nextDelayMs(c: NowPlaying | null) { return this.impl.nextDelayMs(c); }
  queue(c: NowPlaying) { return this.impl.queue(c); }
  control(cmd: ControlCommand, c: NowPlaying | null) { return this.impl.control(cmd, c); }
}

/** Remove internal `_`-prefixed fields before sending to the browser. */
export function publicNp(np: NowPlaying | null): NowPlaying | null {
  if (!np) return null;
  const out = Object.fromEntries(Object.entries(np).filter(([k]) => !k.startsWith('_'))) as unknown as NowPlaying;
  // Deprecated combined flag, kept so tabs loaded before the play/pause split keep working until they reload.
  const playPause = np.state === 'playing' ? np.capabilities.pause : np.capabilities.play;
  return { ...out, capabilities: { ...np.capabilities, playPause } as NowPlaying['capabilities'] };
}

export class Hub {
  sources: Record<SourceId, Source> = { spotify: new SpotifySource(), plex: new PlexOrTautulli() };
  private tracked: Record<SourceId, Tracked> = { spotify: emptyTracked(), plex: emptyTracked() };
  private status: Record<SourceId, SourceStatus> = {
    spotify: { configured: false, ok: false },
    plex: { configured: false, ok: false },
  };
  private timers: Partial<Record<SourceId, NodeJS.Timeout>> = {};
  /** Latest poll number per source; a poll that finishes after a newer one started is discarded. */
  private pollSeq: Record<SourceId, number> = { spotify: 0, plex: 0 };
  private failingSince: Partial<Record<SourceId, number>> = {};
  private listeners = new Set<(s: BroadcastState) => void>();
  private history: HistoryItem[] = [];
  private queue: Track[] = [];
  private queueKey = '';
  private queueAt = 0;
  pin: SourceId | null = null;
  private lastJson = '';

  async start() {
    try {
      const saved = JSON.parse(await fs.readFile(HISTORY_FILE, 'utf8'));
      if (Array.isArray(saved)) this.history = saved;
    } catch { /* first run */ }
    for (const id of Object.keys(this.sources) as SourceId[]) this.schedule(id, 0);
    if (!this.history.length) this.seedHistory().catch(() => {});
  }

  private async seedHistory() {
    if (!this.sources.spotify.isConfigured()) return;
    const items = await spotifyRecent(12);
    this.history = items.map((i: any) => {
      const t = mapSpotifyItem(i.track);
      return { source: 'spotify' as const, title: t.title, artist: t.artist, album: t.album, artUrl: t.artUrl, playedAt: Date.parse(i.played_at) };
    });
    this.emit();
  }

  /** Re-poll a source soon (after a control command, or after settings change). */
  poke(id: SourceId, delayMs = 400) {
    this.schedule(id, delayMs);
  }

  private schedule(id: SourceId, delayMs: number) {
    clearTimeout(this.timers[id]);
    this.timers[id] = setTimeout(() => this.tick(id), delayMs);
  }

  private async tick(id: SourceId) {
    const src = this.sources[id];
    const seq = ++this.pollSeq[id];
    let np: NowPlaying | null = null;
    const configured = src.isConfigured();
    if (configured) {
      try {
        np = await src.poll();
        if (seq !== this.pollSeq[id]) return; // a newer poll (e.g. after a command) owns the state now
        delete this.failingSince[id];
        this.status[id] = { configured, ok: true, lastPoll: Date.now() };
      } catch (e: any) {
        if (seq !== this.pollSeq[id]) return;
        // Keep showing the last known state through transient errors, but not forever.
        const since = (this.failingSince[id] ??= Date.now());
        np = Date.now() - since < STALE_AFTER_MS ? this.tracked[id].np : null;
        this.status[id] = { configured, ok: false, error: e.message, lastPoll: Date.now() };
      }
    } else {
      delete this.failingSince[id];
      this.status[id] = { configured: false, ok: false };
    }
    this.update(id, np);
    this.schedule(id, configured ? src.nextDelayMs(np) : 15000);
  }

  private update(id: SourceId, np: NowPlaying | null) {
    const now = Date.now();
    const prev = this.tracked[id];
    this.tracked[id] = track(prev, np, now);
    // A new track, or one that was only ever seen paused; addHistory drops repeats of the latest entry.
    if (np?.state === 'playing' && (prev.np?.state !== 'playing' || prev.np.track.id !== np.track.id)) this.addHistory(np, now);
    this.refreshQueue().catch(() => {});
    this.emit();
  }

  private addHistory(np: NowPlaying, now: number) {
    const t = np.track;
    const last = this.history[0];
    if (last && last.title === t.title && last.artist === t.artist) return;
    this.history.unshift({ source: np.source, title: t.title, artist: t.artist, album: t.album, artUrl: t.artUrl, playedAt: now });
    this.history = this.history.slice(0, HISTORY_MAX);
    fs.mkdir(CONFIG_DIR, { recursive: true })
      .then(() => fs.writeFile(HISTORY_FILE, JSON.stringify(this.history)))
      .catch(() => {});
  }

  activeId(): SourceId | null {
    return pickActive(this.tracked, this.pin, Date.now());
  }

  private async refreshQueue() {
    const id = this.activeId();
    const np = id ? this.tracked[id].np : null;
    if (!id || !np) { this.queue = []; this.queueKey = ''; return; }
    const key = `${id}:${np.track.id}`;
    if (key === this.queueKey && Date.now() - this.queueAt < 30_000) return;
    this.queueKey = key;
    this.queueAt = Date.now();
    let queue: Track[] = [];
    try {
      queue = await this.sources[id].queue(np);
    } catch { /* no queue */ }
    if (this.queueKey !== key) return; // the track changed while this was in flight
    this.queue = queue;
    this.emit();
  }

  async control(cmd: ControlCommand, source?: SourceId) {
    const id = source ?? this.activeId();
    if (!id) throw new ControlRejected('Nothing is playing');
    await this.sources[id].control(cmd, checkControl(cmd, this.tracked[id].np));
    if (cmd.type === 'next' || cmd.type === 'previous') this.queueAt = 0;
    this.poke(id, 350);
    setTimeout(() => this.poke(id, 0), 1500);
  }

  setPin(pin: SourceId | null) {
    this.pin = pin;
    this.queueAt = 0;
    this.refreshQueue().catch(() => {});
    this.emit(true);
  }

  snapshot(): BroadcastState {
    const id = this.activeId();
    return {
      active: id ? publicNp(this.tracked[id].np) : null,
      sessions: { spotify: publicNp(this.tracked.spotify.np), plex: publicNp(this.tracked.plex.np) },
      pin: this.pin,
      status: this.status,
      history: this.history.slice(0, 16),
      queue: this.queue,
      serverTime: Date.now(),
    };
  }

  private emit(force = false) {
    const s = this.snapshot();
    const json = JSON.stringify({ ...s, serverTime: 0 });
    if (!force && json === this.lastJson) return;
    this.lastJson = json;
    for (const l of this.listeners) l(s);
  }

  subscribe(fn: (s: BroadcastState) => void): () => void {
    this.listeners.add(fn);
    fn(this.snapshot());
    return () => this.listeners.delete(fn);
  }

  statusSummary() {
    return { ...this.status, castEnabled: settings().cast.enabled };
  }
}
