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
  return Object.fromEntries(Object.entries(np).filter(([k]) => !k.startsWith('_'))) as unknown as NowPlaying;
}

export class Hub {
  sources: Record<SourceId, Source> = { spotify: new SpotifySource(), plex: new PlexOrTautulli() };
  private tracked: Record<SourceId, Tracked> = { spotify: emptyTracked(), plex: emptyTracked() };
  private status: Record<SourceId, SourceStatus> = {
    spotify: { configured: false, ok: false },
    plex: { configured: false, ok: false },
  };
  private timers: Partial<Record<SourceId, NodeJS.Timeout>> = {};
  private listeners = new Set<(s: BroadcastState) => void>();
  private history: HistoryItem[] = [];
  private queue: Track[] = [];
  private queueKey = '';
  private queueAt = 0;
  pin: SourceId | null = null;
  private lastJson = '';

  async start() {
    try {
      this.history = JSON.parse(await fs.readFile(HISTORY_FILE, 'utf8'));
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
    let np: NowPlaying | null = null;
    const configured = src.isConfigured();
    if (configured) {
      try {
        np = await src.poll();
        this.status[id] = { configured, ok: true, lastPoll: Date.now() };
      } catch (e: any) {
        np = this.tracked[id].np; // keep showing the last known state through transient errors
        this.status[id] = { configured, ok: false, error: e.message, lastPoll: Date.now() };
      }
    } else {
      this.status[id] = { configured: false, ok: false };
    }
    this.update(id, np);
    this.schedule(id, configured ? src.nextDelayMs(np) : 15000);
  }

  private update(id: SourceId, np: NowPlaying | null) {
    const now = Date.now();
    const prev = this.tracked[id];
    this.tracked[id] = track(prev, np, now);
    if (np?.state === 'playing' && prev.np?.track.id !== np.track.id) this.addHistory(np, now);
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
    try {
      this.queue = await this.sources[id].queue(np);
    } catch {
      this.queue = [];
    }
    this.emit();
  }

  async control(cmd: ControlCommand, source?: SourceId) {
    const id = source ?? this.activeId();
    if (!id) throw new Error('Nothing is playing');
    await this.sources[id].control(cmd, this.tracked[id].np);
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
