import { useEffect, useMemo, useRef, useState } from 'react';
import { fmtTime, parseLrc, SOURCE_LABEL, type LrcLine } from '../lib/format';
import { useProgress } from '../lib/hooks';
import type { NowPlaying } from '../types';

interface Props {
  np: NowPlaying;
  /** Client-server clock offset; the position is interpolated in the parts that show it, so only they re-render. */
  clockOffset: React.MutableRefObject<number>;
  showLyrics: boolean;
  kickRef: React.MutableRefObject<number>;
  onSeek?: (ms: number) => void;
}

export function NowPlayingView({ np, clockOffset, showLyrics, kickRef, onSeek }: Props) {
  const t = np.track;
  const artRef = useRef<HTMLDivElement>(null);
  // Track which URL finished loading (cached images can load before effects run).
  const [loadedSrc, setLoadedSrc] = useState<string | undefined>();

  // Pulse the art with the mic's bass kick (no-op when the mic is off).
  useEffect(() => {
    let raf = 0, s = 1, shown = '';
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const target = 1 + kickRef.current * 0.035;
      s += (target - s) * 0.25;
      const next = `scale(${s.toFixed(4)})`;
      if (next === shown || !artRef.current) return; // at rest: no style writes
      artRef.current.style.transform = shown = next;
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [kickRef]);

  const subtitle = [t.album, t.year].filter(Boolean).join(' · ');

  return (
    <main className={`np ${showLyrics ? 'with-lyrics' : ''}`}>
      <div className="np-art-wrap">
        <div className="np-art" ref={artRef}>
          {t.artUrl ? (
            <img
              key={t.artUrl}
              src={t.artUrl}
              alt=""
              className={loadedSrc === t.artUrl ? 'loaded' : ''}
              ref={(el) => { if (el?.complete && el.naturalWidth) setLoadedSrc(el.getAttribute('src') ?? undefined); }}
              onLoad={(e) => setLoadedSrc(e.currentTarget.getAttribute('src') ?? undefined)}
            />
          ) : (
            <div className="np-art-empty">♪</div>
          )}
          {np.state === 'paused' && <div className="np-paused-badge">Paused</div>}
        </div>
      </div>
      <section className="np-info">
        <div className="np-source">
          <span className={`chip chip-${np.source}`}>{SOURCE_LABEL[np.source]}</span>
          <span className="np-device">on {np.device.name}</span>
        </div>
        <h1 className="np-title" key={t.id}>
          {t.title}
          {t.explicit && <span className="explicit" title="Explicit">E</span>}
        </h1>
        <div className="np-artist">{t.artist}</div>
        {subtitle && <div className="np-album">{subtitle}</div>}
        {showLyrics && <Lyrics np={np} clockOffset={clockOffset} />}
        <Progress np={np} clockOffset={clockOffset} onSeek={np.capabilities.seek ? onSeek : undefined} />
      </section>
    </main>
  );
}

function Progress({ np, clockOffset, onSeek }: { np: NowPlaying; clockOffset: Props['clockOffset']; onSeek?: (ms: number) => void }) {
  const progressMs = useProgress(np, clockOffset);
  const dur = np.track.durationMs;
  const frac = dur ? Math.min(1, progressMs / dur) : 0;
  const [levels, setLevels] = useState<number[] | null>(null);
  useEffect(() => {
    setLevels(null);
    if (np.source !== 'plex' || !np.plexStreamId) return;
    let cancelled = false;
    fetch(`/api/plex/levels?streamId=${np.plexStreamId}`)
      .then((r) => r.json())
      .then((j) => { if (!cancelled) setLevels(j.levels); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [np.source, np.plexStreamId]);

  const bars = useMemo(() => {
    if (!levels?.length) return null;
    const N = 120;
    const out: number[] = [];
    for (let i = 0; i < N; i++) {
      const a = Math.floor((i / N) * levels.length);
      const b = Math.max(a + 1, Math.floor(((i + 1) / N) * levels.length));
      let m = -100;
      for (let k = a; k < b; k++) m = Math.max(m, levels[k]);
      out.push(m);
    }
    // Loudness values are dB (about -60..0). Normalize to the track's own range.
    const lo = Math.max(-60, Math.min(...out));
    const hi = Math.max(...out);
    return out.map((v) => Math.max(0.08, (v - lo) / (hi - lo || 1)));
  }, [levels]);

  const seek = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!onSeek || !dur) return;
    const r = e.currentTarget.getBoundingClientRect();
    onSeek(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * dur);
  };

  return (
    <div className="np-progress">
      <div
        className={`np-bar ${onSeek ? 'seekable' : ''} ${bars ? 'wave' : ''}`}
        onPointerDown={seek}
        role="slider"
        aria-valuemin={0}
        aria-valuemax={dur}
        aria-valuenow={progressMs}
        aria-label="Playback position"
      >
        {bars ? (
          <div className="np-wave">
            {bars.map((h, i) => (
              <span key={i} style={{ height: `${h * 100}%` }} className={i / bars.length < frac ? 'done' : ''} />
            ))}
          </div>
        ) : (
          <div className="np-track"><div className="np-fill" style={{ transform: `scaleX(${frac})` }} /></div>
        )}
      </div>
      <div className="np-times"><span>{fmtTime(progressMs)}</span><span>{dur ? fmtTime(dur) : ''}</span></div>
    </div>
  );
}

function Lyrics({ np, clockOffset }: { np: NowPlaying; clockOffset: Props['clockOffset'] }) {
  const progressMs = useProgress(np, clockOffset);
  const [lines, setLines] = useState<LrcLine[] | null>(null);
  const [plain, setPlain] = useState<string | null>(null);
  const [status, setStatus] = useState<'loading' | 'none' | 'ok' | 'instrumental'>('loading');
  const box = useRef<HTMLDivElement>(null);
  const t = np.track;

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    setLines(null);
    setPlain(null);
    // Spotify joins multiple artists with commas; the first/album artist matches LRCLIB better.
    const artist = t.artist.includes(',') ? (t.albumArtist || t.artist.split(',')[0]) : t.artist;
    const q = new URLSearchParams({ artist, title: t.title, album: t.album, durationMs: String(t.durationMs) });
    fetch(`/api/lyrics?${q}`)
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        if (j.instrumental) return setStatus('instrumental');
        if (j.synced) { setLines(parseLrc(j.synced)); setStatus('ok'); }
        else if (j.plain) { setPlain(j.plain); setStatus('ok'); }
        else setStatus('none');
      })
      .catch(() => { if (!cancelled) setStatus('none'); });
    return () => { cancelled = true; };
  }, [t.id, t.title, t.artist, t.album, t.albumArtist, t.durationMs]);

  const idx = lines
    ? Math.max(0, lines.findIndex((l, i) => progressMs >= l.t && (i === lines.length - 1 || progressMs < lines[i + 1].t)))
    : -1;
  useEffect(() => {
    const el = box.current?.querySelector<HTMLElement>(`[data-i="${idx}"]`);
    if (el && box.current) box.current.scrollTo({ top: el.offsetTop - box.current.clientHeight * 0.38, behavior: 'smooth' });
  }, [idx]);

  if (status === 'loading') return <div className="lyrics muted">Looking for lyrics…</div>;
  if (status === 'instrumental') return <div className="lyrics muted">Instrumental</div>;
  if (status === 'none') return <div className="lyrics muted">No lyrics found</div>;
  return (
    <div className="lyrics" ref={box}>
      {lines
        ? lines.map((l, i) => <p key={i} data-i={i} className={i === idx ? 'cur' : i < idx ? 'past' : ''}>{l.text || '♪'}</p>)
        : plain!.split('\n').map((l, i) => <p key={i}>{l || ' '}</p>)}
    </div>
  );
}
