import { useEffect, useRef } from 'react';
import { css, type Palette } from '../lib/palette';
import type { VizMode } from '../types';
import { Aurora } from './aurora';
import { mic } from './mic';

interface Props {
  mode: VizMode;
  palette: Palette;
  artUrl?: string;
  micOn: boolean;
  /** Receives the bass kick (0..1) each frame, so the album art can pulse. */
  onKick?: (k: number) => void;
}

export function Visualizer({ mode, palette, artUrl, micOn, onKick }: Props) {
  const glRef = useRef<HTMLCanvasElement>(null);
  const c2dRef = useRef<HTMLCanvasElement>(null);
  const pal = useRef(palette);
  pal.current = palette;
  const kickCb = useRef(onKick);
  kickCb.current = onKick;

  useEffect(() => {
    let aurora: Aurora | null = null;
    if (mode === 'aurora' && glRef.current) {
      try { aurora = new Aurora(glRef.current); } catch (e) { console.warn('Aurora unavailable', e); }
    }
    const c2d = c2dRef.current;
    const ctx = mode === 'spectrum' ? c2d?.getContext('2d') : null;
    let raf = 0;
    let last = 0;
    const t0 = performance.now();
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      // Cap ~40fps when the mic is off to keep the fan quiet; full rate when reacting to audio.
      if (!micOn && now - last < 25) return;
      last = now;
      const { energy, kick } = micOn ? mic.sample() : { energy: 0, kick: 0 };
      kickCb.current?.(kick);
      if (aurora) aurora.draw((now - t0) / 1000, pal.current.colors, pal.current.base, energy, kick);
      if (ctx && c2d) drawSpectrum(ctx, c2d, pal.current, mic.freq, energy);
    };
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); aurora?.dispose(); };
  }, [mode, micOn]);

  return (
    <div className="viz" aria-hidden>
      {mode === 'aurora' && <canvas ref={glRef} className="viz-canvas" />}
      {mode === 'art' && artUrl && <div className="viz-art" style={{ backgroundImage: `url("${artUrl}")` }} />}
      {mode === 'spectrum' && (
        <>
          <div className="viz-art dim" style={artUrl ? { backgroundImage: `url("${artUrl}")` } : undefined} />
          <canvas ref={c2dRef} className="viz-canvas" />
        </>
      )}
      <div className="viz-shade" style={{ background: `radial-gradient(120% 90% at 30% 50%, transparent 0%, ${css(palette.base, 0.55)} 70%, ${css(palette.base, 0.85)} 100%)` }} />
    </div>
  );
}

function drawSpectrum(ctx: CanvasRenderingContext2D, c: HTMLCanvasElement, p: Palette, freq: Uint8Array, energy: number) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.floor(c.clientWidth * dpr), h = Math.floor(c.clientHeight * dpr);
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  ctx.clearRect(0, 0, w, h);
  if (!freq.length) return;
  const bars = 72;
  const gap = w * 0.004;
  const bw = (w - gap * (bars - 1)) / bars;
  const grad = ctx.createLinearGradient(0, h, 0, h * 0.35);
  grad.addColorStop(0, css(p.colors[0], 0.9));
  grad.addColorStop(0.6, css(p.colors[1], 0.75));
  grad.addColorStop(1, css(p.colors[2], 0.2));
  ctx.fillStyle = grad;
  ctx.shadowColor = css(p.accent, 0.6);
  ctx.shadowBlur = 18 * dpr * (0.4 + energy);
  // Log-spaced bins from ~30Hz up to ~16kHz.
  const n = freq.length;
  const minBin = 2, maxBin = Math.floor(n * 0.75);
  for (let i = 0; i < bars; i++) {
    const a = Math.floor(minBin * Math.pow(maxBin / minBin, i / bars));
    const b = Math.max(a + 1, Math.floor(minBin * Math.pow(maxBin / minBin, (i + 1) / bars)));
    let v = 0;
    for (let k = a; k < b; k++) v = Math.max(v, freq[k]);
    const bh = Math.pow(v / 255, 1.6) * h * 0.55 + 2 * dpr;
    const x = i * (bw + gap);
    const r = Math.min(bw / 2, 6 * dpr);
    ctx.beginPath();
    ctx.roundRect(x, h - bh, bw, bh + r, r);
    ctx.fill();
  }
}
