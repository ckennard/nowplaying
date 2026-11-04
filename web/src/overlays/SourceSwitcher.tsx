import { IconPinned } from '../icons';
import { SOURCE_LABEL } from '../lib/format';
import type { BroadcastState, SourceId } from '../types';

export function SourceSwitcher({ state, visible, onPin }: { state: BroadcastState; visible: boolean; onPin: (p: SourceId | null) => void }) {
  const ids: SourceId[] = ['spotify', 'plex'];
  return (
    <div className={`switcher ${visible ? 'show' : ''}`} onPointerDown={(e) => e.stopPropagation()}>
      {ids.map((id) => {
        const st = state.status[id];
        const s = state.sessions[id];
        const dot = !st?.configured ? 'off' : !st.ok ? 'err' : s?.state === 'playing' ? 'play' : s ? 'pause' : 'idle';
        const pinned = state.pin === id;
        const title = !st?.configured ? 'Not set up' : st.error ? st.error : s ? `${s.state} · ${s.track.title}` : 'Idle';
        return (
          <button key={id} className={`src ${pinned ? 'pinned' : ''} ${state.active?.source === id ? 'active' : ''}`} title={`${title}. Tap to ${pinned ? 'unpin' : 'pin'}.`} onClick={() => onPin(pinned ? null : id)} disabled={!st?.configured}>
            <span className={`dot dot-${dot}`} />
            {SOURCE_LABEL[id]}
            {pinned && <IconPinned size={14} />}
          </button>
        );
      })}
    </div>
  );
}
