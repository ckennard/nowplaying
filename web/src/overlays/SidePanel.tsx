import { IconClose } from '../icons';
import { fmtQuality, fmtTime, SOURCE_LABEL } from '../lib/format';
import type { NowPlaying, Track } from '../types';
import type { Panel } from './Controls';

export function SidePanel({ panel, np, queue, onClose }: { panel: Panel; np: NowPlaying | null; queue: Track[]; onClose: () => void }) {
  return (
    <aside className={`panel ${panel ? 'show' : ''}`} onPointerDown={(e) => e.stopPropagation()} aria-hidden={!panel}>
      <header className="panel-head">
        <h2>{panel === 'queue' ? 'Up next' : 'Details'}</h2>
        <button className="btn btn-small" onClick={onClose} aria-label="Close"><IconClose size={20} /></button>
      </header>
      <div className="panel-body">
        {panel === 'queue' && <Queue np={np} queue={queue} />}
        {panel === 'details' && np && <Details np={np} />}
      </div>
    </aside>
  );
}

function Queue({ np, queue }: { np: NowPlaying | null; queue: Track[] }) {
  if (!queue.length) {
    return (
      <p className="muted">
        {np?.source === 'plex'
          ? np.viaCast ? "The queue shows up once the Chromecast reports its play queue. That can take a few seconds after a track starts." : 'This Plex player does not share its queue.'
          : 'Nothing queued.'}
      </p>
    );
  }
  return (
    <ol className="queue">
      {queue.map((t, i) => (
        <li key={`${t.id}-${i}`}>
          {t.artUrl ? <img src={t.artUrl} alt="" loading="lazy" /> : <div className="q-noart">♪</div>}
          <div className="q-text">
            <div className="q-title">{t.title}</div>
            <div className="q-artist">{t.artist}</div>
          </div>
          <div className="q-dur">{t.durationMs ? fmtTime(t.durationMs) : ''}</div>
        </li>
      ))}
    </ol>
  );
}

function Details({ np }: { np: NowPlaying }) {
  const t = np.track;
  const rows: [string, React.ReactNode][] = [
    ['Title', t.title],
    ['Artist', t.artist],
    ...(t.albumArtist && t.albumArtist !== t.artist ? [['Album artist', t.albumArtist] as [string, string]] : []),
    ['Album', t.album],
    ['Year', t.year],
    ['Track', t.trackNumber ? `${t.trackNumber}${t.discNumber && t.discNumber > 1 ? ` · Disc ${t.discNumber}` : ''}` : undefined],
    ['Length', t.durationMs ? fmtTime(t.durationMs) : undefined],
    ['Genre', t.genres?.length ? t.genres.join(', ') : undefined],
    ['Label', t.label],
    ['Quality', fmtQuality(np.quality) || undefined],
    ['Stream', np.quality?.transcoding == null ? undefined : np.quality.transcoding ? 'Transcoding' : 'Direct play'],
    ['Source', SOURCE_LABEL[np.source]],
    ['Device', [np.device.name, np.device.type && np.device.type !== np.device.name ? np.device.type : ''].filter(Boolean).join(' · ')],
    ['Controls', np.viaCast ? 'Directly on the Chromecast' : undefined],
  ];
  return (
    <dl className="details">
      {rows.filter(([, v]) => v != null && v !== '').map(([k, v]) => (
        <div key={k} className="d-row"><dt>{k}</dt><dd>{v}</dd></div>
      ))}
    </dl>
  );
}
