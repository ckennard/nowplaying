export function fmtTime(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}

export function fmtQuality(q?: { codec?: string; bitrateKbps?: number; sampleRateHz?: number; bitDepth?: number; channels?: number }): string {
  if (!q) return '';
  const parts: string[] = [];
  if (q.codec) parts.push(q.codec);
  if (q.bitDepth && q.sampleRateHz) parts.push(`${q.bitDepth}-bit / ${(q.sampleRateHz / 1000).toFixed(q.sampleRateHz % 1000 ? 1 : 0)} kHz`);
  else if (q.sampleRateHz) parts.push(`${(q.sampleRateHz / 1000).toFixed(1)} kHz`);
  if (q.bitrateKbps) parts.push(`${q.bitrateKbps} kbps`);
  if (q.channels && q.channels !== 2) parts.push(q.channels === 1 ? 'Mono' : `${q.channels} ch`);
  return parts.join(' · ');
}

export function timeAgo(ts: number, now = Date.now()): string {
  const s = Math.round((now - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

export const SOURCE_LABEL = { spotify: 'Spotify', plex: 'Plex' } as const;

export interface LrcLine { t: number; text: string }
export function parseLrc(lrc: string): LrcLine[] {
  const out: LrcLine[] = [];
  for (const line of lrc.split(/\r?\n/)) {
    const tags = [...line.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
    if (!tags.length) continue;
    const text = line.replace(/\[[^\]]*\]/g, '').trim();
    for (const m of tags) out.push({ t: (Number(m[1]) * 60 + Number(m[2])) * 1000, text });
  }
  return out.sort((a, b) => a.t - b.t);
}
