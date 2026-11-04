import { useClock } from '../lib/hooks';
import { SOURCE_LABEL, timeAgo } from '../lib/format';
import type { HistoryItem } from '../types';

export function Idle({ history, needsSetup, onSettings }: { history: HistoryItem[]; needsSetup: boolean; onSettings: () => void }) {
  const now = useClock(1000);
  const time = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const date = now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
  return (
    <main className="idle">
      <div className="idle-clock">
        <div className="idle-time">{time}</div>
        <div className="idle-date">{date}</div>
        {needsSetup ? (
          <button className="btn btn-cta" onClick={onSettings}>Connect Spotify or Plex to get started</button>
        ) : (
          <div className="idle-hint">Nothing playing</div>
        )}
      </div>
      {history.length > 0 && (
        <section className="idle-history">
          <h2>Recently played</h2>
          <ul>
            {history.slice(0, 8).map((h, i) => (
              <li key={i}>
                {h.artUrl ? <img src={h.artUrl} alt="" loading="lazy" /> : <div className="q-noart">♪</div>}
                <div className="h-text">
                  <div className="h-title">{h.title}</div>
                  <div className="h-artist">{h.artist}</div>
                  <div className="h-meta">{SOURCE_LABEL[h.source]} · {timeAgo(h.playedAt, now.getTime())}</div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
