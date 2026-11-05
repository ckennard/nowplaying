import { useCallback, useEffect, useRef, useState } from 'react';
import { api, control, setPin } from './lib/api';
import { useActivity, useLiveState, useLocalStorage, useProgress, useWakeLock } from './lib/hooks';
import { css, DEFAULT_PALETTE, extractPalette, type Palette } from './lib/palette';
import { Controls, type Panel } from './overlays/Controls';
import { SidePanel } from './overlays/SidePanel';
import { SourceSwitcher } from './overlays/SourceSwitcher';
import { Settings } from './settings/Settings';
import type { PublicConfig, VizMode } from './types';
import { Idle } from './views/Idle';
import { NowPlayingView } from './views/NowPlayingView';
import { mic } from './viz/mic';
import { Visualizer } from './viz/Visualizer';

const VIZ_ORDER: VizMode[] = ['aurora', 'art', 'spectrum', 'off'];

export function App() {
  const { state, connected, clockOffset } = useLiveState();
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const loadConfig = useCallback(() => api<PublicConfig>('/api/config').then(setConfig).catch(() => {}), []);
  useEffect(() => { loadConfig(); }, [loadConfig]);

  const ui = config?.ui;
  const [vizPref, setViz] = useLocalStorage<VizMode | null>('np.viz', null);
  const [lyricsPref, setLyrics] = useLocalStorage<boolean | null>('np.lyrics', null);
  const viz: VizMode = vizPref ?? ui?.defaultViz ?? 'aurora';
  const lyrics = lyricsPref ?? ui?.lyrics ?? false;

  const [panel, setPanel] = useState<Panel>(null);
  const [settingsOpen, setSettingsOpen] = useState(() => location.hash.startsWith('#settings'));
  const [micOn, setMicOn] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [palette, setPalette] = useState<Palette>(DEFAULT_PALETTE);
  const kick = useRef(0);

  const { active: chromeVisible } = useActivity(ui?.overlayTimeoutSec ?? 6);
  const { active: panelAlive } = useActivity(ui?.panelTimeoutSec ?? 45);
  useEffect(() => { if (!panelAlive) setPanel(null); }, [panelAlive]);
  useWakeLock(ui?.wakeLock ?? true);

  const np = state?.active ?? null;
  const progress = useProgress(np, clockOffset);

  // Palette from album art
  const art = np?.track.artUrl;
  useEffect(() => {
    if (!art) return;
    let cancelled = false;
    extractPalette(art).then((p) => { if (!cancelled) setPalette(p); }).catch(() => {});
    return () => { cancelled = true; };
  }, [art]);

  const showToast = useCallback((m: string) => {
    setToast(m);
    window.setTimeout(() => setToast((t) => (t === m ? null : t)), 4500);
  }, []);

  const send = useCallback(async (cmd: { type: string; [k: string]: unknown }) => {
    if (!np) return;
    if (new URLSearchParams(location.search).has('demo')) return showToast(`Demo mode: ${cmd.type} ignored`);
    setBusy(true);
    try { await control(cmd, np.source); }
    catch (e: any) { showToast(e.message); }
    finally { setBusy(false); }
  }, [np, showToast]);

  const toggleMic = useCallback(async () => {
    if (mic.running) { mic.stop(); setMicOn(false); return; }
    try { await mic.start(); setMicOn(true); }
    catch (e: any) { showToast(e.message || 'Microphone unavailable'); }
  }, [showToast]);

  const cycleViz = useCallback(() => {
    const next = VIZ_ORDER[(VIZ_ORDER.indexOf(viz) + 1) % VIZ_ORDER.length];
    setViz(next);
    if (next === 'spectrum' && !mic.running) toggleMic();
  }, [viz, setViz, toggleMic]);

  const fullscreen = useCallback(() => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
  }, []);

  const openSettings = useCallback(() => { setSettingsOpen(true); history.replaceState(null, '', '#settings'); }, []);
  const closeSettings = useCallback(() => { setSettingsOpen(false); history.replaceState(null, '', location.pathname); loadConfig(); }, [loadConfig]);

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (settingsOpen || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      switch (e.key.toLowerCase()) {
        case ' ': e.preventDefault(); if (np?.capabilities.playPause) send({ type: np.state === 'playing' ? 'pause' : 'play' }); break;
        case 'arrowright': if (np?.capabilities.next) send({ type: 'next' }); break;
        case 'arrowleft': if (np?.capabilities.previous) send({ type: 'previous' }); break;
        case 'q': setPanel((p) => (p === 'queue' ? null : 'queue')); break;
        case 'i': setPanel((p) => (p === 'details' ? null : 'details')); break;
        case 'l': setLyrics(!lyrics); break;
        case 'v': cycleViz(); break;
        case 'm': toggleMic(); break;
        case 'f': fullscreen(); break;
        case 'escape': setPanel(null); break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [np, send, settingsOpen, lyrics, setLyrics, cycleViz, toggleMic, fullscreen]);

  const pin = useCallback((p: 'spotify' | 'plex' | null) => { setPin(p).catch((e) => showToast(e.message)); }, [showToast]);

  const style = {
    '--accent': css(palette.accent),
    '--accent-soft': css(palette.accent, 0.22),
    '--base': css(palette.base),
    '--c1': css(palette.colors[0]),
    '--c2': css(palette.colors[1]),
  } as React.CSSProperties;

  return (
    <div className={`app ${chromeVisible || settingsOpen ? '' : 'hide-cursor'} ${panel ? 'panel-open' : ''}`} style={style}>
      <Visualizer mode={np ? viz : 'aurora'} palette={palette} artUrl={art} micOn={micOn} onKick={(k) => (kick.current = k)} />
      <div className="drift">
        {np ? (
          <NowPlayingView np={np} progressMs={progress} showLyrics={lyrics} kickRef={kick} onSeek={(ms) => send({ type: 'seek', positionMs: ms })} />
        ) : (
          <Idle history={state?.history ?? []} needsSetup={Boolean(config?.needsSetup)} onSettings={openSettings} />
        )}
      </div>
      {state && <SourceSwitcher state={state} visible={chromeVisible} onPin={pin} />}
      <Controls
        np={np} visible={chromeVisible} panel={panel} lyrics={lyrics} viz={viz} micOn={micOn} busy={busy}
        onCommand={send} onPanel={setPanel} onLyrics={() => setLyrics(!lyrics)} onViz={cycleViz} onMic={toggleMic}
        onFullscreen={fullscreen} onSettings={openSettings}
      />
      <SidePanel panel={panel} np={np} queue={state?.queue ?? []} onClose={() => setPanel(null)} />
      {!connected && <div className="conn">Reconnecting…</div>}
      {toast && <div className="toast" role="status">{toast}</div>}
      {settingsOpen && config && <Settings config={config} onClose={closeSettings} onSaved={loadConfig} />}
    </div>
  );
}
