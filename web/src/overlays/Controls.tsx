import { useEffect, useState } from 'react';
import { IconFull, IconGear, IconInfo, IconLyrics, IconMic, IconNext, IconPause, IconPlay, IconPrev, IconQueue, IconVolume, IconWave } from '../icons';
import type { NowPlaying, VizMode } from '../types';

export type Panel = 'queue' | 'details' | null;

interface Props {
  np: NowPlaying | null;
  visible: boolean;
  panel: Panel;
  lyrics: boolean;
  viz: VizMode;
  micOn: boolean;
  busy: boolean;
  onCommand: (cmd: { type: string; [k: string]: unknown }) => void;
  onPanel: (p: Panel) => void;
  onLyrics: () => void;
  onViz: () => void;
  onMic: () => void;
  onFullscreen: () => void;
  onSettings: () => void;
}

const VIZ_LABEL: Record<VizMode, string> = { aurora: 'Aurora', art: 'Album glow', spectrum: 'Spectrum', off: 'Off' };

export function Controls(p: Props) {
  const np = p.np;
  const caps = np?.capabilities;
  const [vol, setVol] = useState<number | null>(np?.device.volumePercent ?? null);
  const [dragging, setDragging] = useState(false);
  useEffect(() => { if (!dragging) setVol(np?.device.volumePercent ?? null); }, [np?.device.volumePercent, dragging]);

  return (
    <div className={`controls ${p.visible ? 'show' : ''}`} onPointerDown={(e) => e.stopPropagation()}>
      <div className="controls-group">
        <button className="btn" disabled={!caps?.previous || p.busy} onClick={() => p.onCommand({ type: 'previous' })} aria-label="Previous"><IconPrev /></button>
        <button className="btn btn-primary" disabled={!caps?.playPause || p.busy} onClick={() => p.onCommand({ type: np?.state === 'playing' ? 'pause' : 'play' })} aria-label={np?.state === 'playing' ? 'Pause' : 'Play'}>
          {np?.state === 'playing' ? <IconPause size={30} /> : <IconPlay size={30} />}
        </button>
        <button className="btn" disabled={!caps?.next || p.busy} onClick={() => p.onCommand({ type: 'next' })} aria-label="Next"><IconNext /></button>
      </div>
      {caps?.volume && vol != null && (
        <label className="controls-group volume" aria-label="Volume">
          <IconVolume size={20} />
          <input
            type="range" min={0} max={100} value={vol}
            onChange={(e) => { setDragging(true); setVol(Number(e.target.value)); }}
            onPointerUp={(e) => { setDragging(false); p.onCommand({ type: 'volume', percent: Number((e.target as HTMLInputElement).value) }); }}
            onKeyUp={(e) => p.onCommand({ type: 'volume', percent: Number((e.target as HTMLInputElement).value) })}
          />
          <span className="vol-num">{vol}</span>
        </label>
      )}
      <div className="controls-group">
        <button className={`btn ${p.panel === 'queue' ? 'on' : ''}`} onClick={() => p.onPanel(p.panel === 'queue' ? null : 'queue')} aria-label="Up next (Q)" title="Up next (Q)"><IconQueue /></button>
        <button className={`btn ${p.panel === 'details' ? 'on' : ''}`} onClick={() => p.onPanel(p.panel === 'details' ? null : 'details')} aria-label="Details (I)" title="Details (I)"><IconInfo /></button>
        <button className={`btn ${p.lyrics ? 'on' : ''}`} onClick={p.onLyrics} aria-label="Lyrics (L)" title="Lyrics (L)"><IconLyrics /></button>
        <button className="btn btn-label" onClick={p.onViz} title="Visualizer (V)"><IconWave /><span>{VIZ_LABEL[p.viz]}</span></button>
        <button className={`btn ${p.micOn ? 'on' : ''}`} onClick={p.onMic} aria-label="React to microphone (M)" title="React to microphone (M)"><IconMic /></button>
        <button className="btn" onClick={p.onFullscreen} aria-label="Fullscreen (F)" title="Fullscreen (F)"><IconFull /></button>
        <button className="btn" onClick={p.onSettings} aria-label="Settings" title="Settings"><IconGear /></button>
      </div>
    </div>
  );
}
