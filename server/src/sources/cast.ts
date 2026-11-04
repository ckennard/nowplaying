/**
 * Minimal Google Cast v2 client (no third-party deps): TLS to :8009, length-prefixed protobuf CastMessage.
 * Used to control a Chromecast that's playing a Plex cast session (Plex's own remote API doesn't reach cast receivers).
 */
import tls from 'node:tls';
import type { ControlCommand } from '../types.js';

const NS = {
  connection: 'urn:x-cast:com.google.cast.tp.connection',
  heartbeat: 'urn:x-cast:com.google.cast.tp.heartbeat',
  receiver: 'urn:x-cast:com.google.cast.receiver',
  media: 'urn:x-cast:com.google.cast.media',
  plex: 'urn:x-cast:plex',
};

export function looksLikeCast(player: any): boolean {
  const s = `${player?.product ?? ''} ${player?.platform ?? ''} ${player?.device ?? ''}`.toLowerCase();
  return /chromecast|cast/.test(s);
}

// ---- protobuf (just the CastMessage fields we need) ----
function varint(n: number): Buffer {
  const out: number[] = [];
  while (n > 0x7f) {
    out.push((n & 0x7f) | 0x80);
    n >>>= 7;
  }
  out.push(n);
  return Buffer.from(out);
}
function field(tag: number, wire: number, payload: Buffer): Buffer {
  return Buffer.concat([varint((tag << 3) | wire), payload]);
}
function strField(tag: number, s: string): Buffer {
  const b = Buffer.from(s, 'utf8');
  return field(tag, 2, Buffer.concat([varint(b.length), b]));
}

export function encodeCastMessage(source: string, dest: string, namespace: string, payload: string): Buffer {
  const body = Buffer.concat([
    field(1, 0, varint(0)), // protocol_version CASTV2_1_0
    strField(2, source),
    strField(3, dest),
    strField(4, namespace),
    field(5, 0, varint(0)), // payload_type STRING
    strField(6, payload),
  ]);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(body.length);
  return Buffer.concat([len, body]);
}

export interface CastMessage { source: string; dest: string; namespace: string; payload: string }

export function decodeCastMessage(buf: Buffer): CastMessage {
  let i = 0;
  const msg: CastMessage = { source: '', dest: '', namespace: '', payload: '' };
  const readVarint = () => {
    let shift = 0, result = 0;
    for (;;) {
      const b = buf[i++];
      result += (b & 0x7f) * 2 ** shift;
      if (!(b & 0x80)) return result;
      shift += 7;
    }
  };
  while (i < buf.length) {
    const key = readVarint();
    const tag = key >>> 3, wire = key & 7;
    if (wire === 0) { readVarint(); continue; }
    if (wire === 2) {
      const len = readVarint();
      const v = buf.subarray(i, i + len);
      i += len;
      const s = v.toString('utf8');
      if (tag === 2) msg.source = s;
      else if (tag === 3) msg.dest = s;
      else if (tag === 4) msg.namespace = s;
      else if (tag === 6) msg.payload = s;
      continue;
    }
    throw new Error('unsupported wire type ' + wire);
  }
  return msg;
}

// ---- connection ----
class CastConnection {
  private sock!: tls.TLSSocket;
  private buf = Buffer.alloc(0);
  private reqId = Math.floor(Math.random() * 1e6);
  private waiters = new Map<number, (p: any) => void>();
  private sender = 'sender-nowplaying';
  private hb?: NodeJS.Timeout;

  constructor(private host: string) {}

  connect(timeoutMs = 5000): Promise<void> {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { this.close(); reject(new Error(`Chromecast ${this.host} did not respond`)); }, timeoutMs);
      this.sock = tls.connect({ host: this.host, port: 8009, rejectUnauthorized: false }, () => {
        clearTimeout(t);
        this.send('receiver-0', NS.connection, { type: 'CONNECT' });
        this.hb = setInterval(() => this.send('receiver-0', NS.heartbeat, { type: 'PING' }), 5000);
        resolve();
      });
      this.sock.on('error', (e) => { clearTimeout(t); reject(e); });
      this.sock.on('data', (d) => this.onData(d));
    });
  }

  private onData(d: Buffer) {
    this.buf = Buffer.concat([this.buf, d]);
    while (this.buf.length >= 4) {
      const len = this.buf.readUInt32BE(0);
      if (this.buf.length < 4 + len) break;
      const frame = this.buf.subarray(4, 4 + len);
      this.buf = this.buf.subarray(4 + len);
      try {
        const m = decodeCastMessage(frame);
        const p = JSON.parse(m.payload);
        if (p.type === 'PING') this.send(m.source, NS.heartbeat, { type: 'PONG' });
        const w = this.waiters.get(p.requestId);
        if (w) { this.waiters.delete(p.requestId); w(p); }
      } catch { /* ignore malformed frames */ }
    }
  }

  send(dest: string, ns: string, payload: object) {
    this.sock.write(encodeCastMessage(this.sender, dest, ns, JSON.stringify(payload)));
  }

  request(dest: string, ns: string, payload: Record<string, unknown>, timeoutMs = 4000): Promise<any> {
    const requestId = ++this.reqId;
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { this.waiters.delete(requestId); reject(new Error(`Chromecast timed out on ${String(payload.type)}`)); }, timeoutMs);
      this.waiters.set(requestId, (p) => { clearTimeout(t); resolve(p); });
      this.send(dest, ns, { ...payload, requestId });
    });
  }

  close() {
    if (this.hb) clearInterval(this.hb);
    try { this.sock?.destroy(); } catch { /* noop */ }
  }
}

export interface CastResult { volumePercent?: number; playQueueId?: number }

function playQueueIdFrom(mediaStatus: any): number | undefined {
  const cd = mediaStatus?.media?.customData ?? mediaStatus?.customData ?? {};
  const key: string = cd.containerKey ?? cd.playQueueKey ?? '';
  const m = /playQueues\/(\d+)/.exec(key);
  return m ? Number(m[1]) : (Number(cd.playQueueID) || undefined);
}

async function withSession<T>(host: string, fn: (c: CastConnection, transportId: string, mediaSessionId: number | undefined, status: any, media: any) => Promise<T>): Promise<T> {
  const c = new CastConnection(host);
  await c.connect();
  try {
    const rs = await c.request('receiver-0', NS.receiver, { type: 'GET_STATUS' });
    const status = rs.status ?? {};
    const app = (status.applications ?? []).find((a: any) => (a.namespaces ?? []).some((n: any) => n.name === NS.media));
    if (!app) throw new Error('No media app is running on the Chromecast');
    c.send(app.transportId, NS.connection, { type: 'CONNECT' });
    const ms = await c.request(app.transportId, NS.media, { type: 'GET_STATUS' });
    const media = ms.status?.[0];
    (app as any)._hasPlexNs = (app.namespaces ?? []).some((n: any) => n.name === NS.plex);
    return await fn(c, app.transportId, media?.mediaSessionId, { ...status, app }, media);
  } finally {
    c.close();
  }
}

export async function castControl(host: string, cmd: ControlCommand): Promise<CastResult> {
  return withSession(host, async (c, tid, msid, status, media) => {
    const playQueueId = playQueueIdFrom(media);
    const needSession = () => { if (msid == null) throw new Error('Chromecast has no active media session'); return msid; };
    switch (cmd.type) {
      case 'play':
        await c.request(tid, NS.media, { type: 'PLAY', mediaSessionId: needSession() });
        break;
      case 'pause':
        await c.request(tid, NS.media, { type: 'PAUSE', mediaSessionId: needSession() });
        break;
      case 'seek':
        await c.request(tid, NS.media, { type: 'SEEK', mediaSessionId: needSession(), currentTime: cmd.positionMs / 1000 });
        break;
      case 'next':
      case 'previous': {
        if (status.app._hasPlexNs) {
          // The Plex receiver does not reply to these; fire and give it a moment.
          c.send(tid, NS.plex, { type: cmd.type === 'next' ? 'NEXT' : 'PREVIOUS' });
          await new Promise((r) => setTimeout(r, 400));
        } else {
          await c.request(tid, NS.media, { type: 'QUEUE_UPDATE', mediaSessionId: needSession(), jump: cmd.type === 'next' ? 1 : -1 });
        }
        break;
      }
      case 'volume': {
        const r = await c.request('receiver-0', NS.receiver, { type: 'SET_VOLUME', volume: { level: Math.max(0, Math.min(1, cmd.percent / 100)) } });
        return { volumePercent: Math.round((r.status?.volume?.level ?? cmd.percent / 100) * 100), playQueueId };
      }
    }
    return { volumePercent: status.volume?.level != null ? Math.round(status.volume.level * 100) : undefined, playQueueId };
  });
}

/** Read volume and play-queue id without changing anything. */
export async function castStatus(host: string): Promise<CastResult> {
  return withSession(host, async (_c, _tid, _msid, status, media) => ({
    volumePercent: status.volume?.level != null ? Math.round(status.volume.level * 100) : undefined,
    playQueueId: playQueueIdFrom(media),
  }));
}
