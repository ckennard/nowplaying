import { useEffect, useState } from 'react';
import { IconClose } from '../icons';
import { api } from '../lib/api';
import type { PublicConfig } from '../types';

type S = any;

export function Settings({ config, onClose, onSaved }: { config: PublicConfig; onClose: () => void; onSaved: () => void }) {
  const [s, setS] = useState<S | null>(null);
  const [needPin, setNeedPin] = useState(false);
  const [pin, setPinInput] = useState('');
  const [msg, setMsg] = useState<Record<string, { ok: boolean; message: string }>>({});
  const [saving, setSaving] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);

  const load = () =>
    api('/api/settings')
      .then((j) => { setS(j); setNeedPin(false); })
      .catch((e) => { if (e.status === 401) setNeedPin(true); });

  useEffect(() => {
    load();
    const h = location.hash;
    if (h.includes('spotify=connected')) setBanner('Spotify connected.');
    const err = /spotify_error=([^&]+)/.exec(h);
    if (err) setBanner('Spotify: ' + decodeURIComponent(err[1]));
  }, []);

  const set = (path: string, v: unknown) =>
    setS((prev: S) => {
      const next = structuredClone(prev);
      const keys = path.split('.');
      let o = next;
      for (const k of keys.slice(0, -1)) o = o[k];
      o[keys[keys.length - 1]] = v;
      return next;
    });

  const save = async (quiet = false): Promise<boolean> => {
    setSaving(true);
    try {
      const { envLocked, ...rest } = s;
      const body = { ...rest, spotify: { clientId: s.spotify.clientId, clientSecret: s.spotify.clientSecret } };
      if (rest.adminPin && rest.adminPin !== '••••••••') try { sessionStorage.setItem('np.pin', rest.adminPin); } catch { /* ignore */ }
      setS(await api('/api/settings', { method: 'PUT', body: JSON.stringify(body) }));
      if (!quiet) setBanner('Saved.');
      onSaved();
      return true;
    } catch (e: any) {
      setBanner('Save failed: ' + e.message);
      return false;
    } finally {
      setSaving(false);
    }
  };

  // Tests run against saved settings on the server, so save what's in the form first.
  const test = async (svc: string) => {
    setMsg((m) => ({ ...m, [svc]: { ok: true, message: 'Saving and testing…' } }));
    if (!(await save(true))) {
      setMsg((m) => ({ ...m, [svc]: { ok: false, message: 'Could not save settings' } }));
      return;
    }
    try {
      const r = await api(`/api/test/${svc}`, { method: 'POST', body: '{}' });
      setMsg((m) => ({ ...m, [svc]: r }));
    } catch (e: any) {
      setMsg((m) => ({ ...m, [svc]: { ok: false, message: e.message } }));
    }
  };

  const connectSpotify = async () => {
    await save();
    let p = '';
    try { p = sessionStorage.getItem('np.pin') ?? ''; } catch { /* ignore */ }
    location.href = '/api/auth/spotify/login' + (p ? `?pin=${encodeURIComponent(p)}` : '');
  };

  const disconnectSpotify = async () => {
    await api('/api/auth/spotify/disconnect', { method: 'POST', body: '{}' });
    load();
  };

  if (needPin) {
    return (
      <Shell onClose={onClose}>
        <form className="pin-form" onSubmit={(e) => { e.preventDefault(); try { sessionStorage.setItem('np.pin', pin); } catch { /* ignore */ } load(); }}>
          <p>Enter the admin PIN to change settings.</p>
          <input type="password" inputMode="numeric" autoFocus value={pin} onChange={(e) => setPinInput(e.target.value)} />
          <button className="btn btn-cta" type="submit">Unlock</button>
        </form>
      </Shell>
    );
  }
  if (!s) return <Shell onClose={onClose}><p className="muted">Loading…</p></Shell>;

  const locked = (k: string) => s.envLocked?.[k];
  const Field = ({ label, path, type = 'text', env, placeholder, hint }: { label: string; path: string; type?: string; env?: string; placeholder?: string; hint?: React.ReactNode }) => {
    const v = path.split('.').reduce((o: any, k) => o?.[k], s);
    return (
      <label className="field">
        <span>{label}{env && locked(env) && <em className="env"> set by {env}</em>}</span>
        {type === 'checkbox' ? (
          <input type="checkbox" checked={Boolean(v)} onChange={(e) => set(path, e.target.checked)} />
        ) : (
          <input type={type} value={v ?? ''} placeholder={placeholder} disabled={Boolean(env && locked(env))}
            onChange={(e) => set(path, type === 'number' ? Number(e.target.value) : e.target.value)}
            onFocus={(e) => { if (e.target.value === '••••••••') set(path, ''); }} />
        )}
        {hint && <small>{hint}</small>}
      </label>
    );
  };
  const Test = ({ svc }: { svc: string }) => (
    <div className="test-row">
      <button className="btn btn-small" onClick={() => test(svc)}>Test</button>
      {msg[svc] && <span className={msg[svc].ok ? 'ok' : 'err'}>{msg[svc].message}</span>}
    </div>
  );

  return (
    <Shell onClose={onClose}>
      {banner && <div className="banner">{banner}</div>}
      <div className="settings-grid">
        <section>
          <h3>Spotify</h3>
          <p className="muted small">
            In the <a href="https://developer.spotify.com/dashboard" target="_blank" rel="noreferrer">Spotify developer dashboard</a>, add this exact Redirect URI to your app:
          </p>
          <code className="copy" onClick={() => navigator.clipboard?.writeText(config.spotifyRedirectUri)} title="Click to copy">{config.spotifyRedirectUri}</code>
          {!config.secureContext && <p className="err small">Spotify only accepts https:// redirect URIs (other than 127.0.0.1). Open this page through its Tailscale https:// address before connecting.</p>}
          {Field({ label: 'Client ID', path: 'spotify.clientId', env: 'SPOTIFY_CLIENT_ID' })}
          {Field({ label: 'Client secret', path: 'spotify.clientSecret', type: 'password', env: 'SPOTIFY_CLIENT_SECRET' })}
          <div className="test-row">
            {s.spotify.connected ? (
              <>
                <span className="ok">Connected</span>
                <button className="btn btn-small" onClick={() => test('spotify')}>Test</button>
                <button className="btn btn-small" onClick={disconnectSpotify}>Disconnect</button>
              </>
            ) : (
              <button className="btn btn-cta" disabled={!s.spotify.clientId} onClick={connectSpotify}>Save &amp; connect Spotify</button>
            )}
            {msg.spotify && <span className={msg.spotify.ok ? 'ok' : 'err'}>{msg.spotify.message}</span>}
          </div>
        </section>

        <section>
          <h3>Plex</h3>
          {Field({ label: 'Server URL', path: 'plex.url', env: 'PLEX_URL', placeholder: 'http://192.168.1.69:32400' })}
          {Field({
            label: 'Plex token', path: 'plex.token', type: 'password', env: 'PLEX_TOKEN',
            hint: <>How to find it: <a href="https://support.plex.tv/articles/204059436" target="_blank" rel="noreferrer">support.plex.tv/articles/204059436</a></>,
          })}
          <Test svc="plex" />
          <h3>Tautulli <span className="muted small">(optional, read-only fallback)</span></h3>
          {Field({ label: 'Tautulli URL', path: 'tautulli.url', env: 'TAUTULLI_URL', placeholder: 'http://192.168.1.69:8181' })}
          {Field({ label: 'API key', path: 'tautulli.apiKey', type: 'password', env: 'TAUTULLI_API_KEY' })}
          <Test svc="tautulli" />
        </section>

        <section>
          <h3>Chromecast</h3>
          <p className="muted small">Plex can't remote-control Cast sessions, so controls go straight to the Chromecast. The address is picked up from the Plex session automatically; set it here if that doesn't work. Giving the Chromecast a DHCP reservation helps.</p>
          {Field({ label: 'Control Chromecast directly', path: 'cast.enabled', type: 'checkbox' })}
          {Field({ label: 'Chromecast IP (override)', path: 'cast.hostOverride', env: 'CAST_HOST', placeholder: 'auto' })}
          <Test svc="cast" />
        </section>

        <section>
          <h3>Display</h3>
          {Field({ label: 'Hide controls after (seconds)', path: 'ui.overlayTimeoutSec', type: 'number' })}
          {Field({ label: 'Close panels after (seconds)', path: 'ui.panelTimeoutSec', type: 'number' })}
          <label className="field">
            <span>Default visualizer</span>
            <select value={s.ui.defaultViz} onChange={(e) => set('ui.defaultViz', e.target.value)}>
              <option value="aurora">Aurora</option>
              <option value="art">Album glow</option>
              <option value="spectrum">Spectrum (needs the mic)</option>
              <option value="off">Off</option>
            </select>
          </label>
          {Field({ label: 'Show lyrics by default', path: 'ui.lyrics', type: 'checkbox' })}
          {Field({ label: 'Keep the screen awake', path: 'ui.wakeLock', type: 'checkbox' })}
          <h3>Access</h3>
          {Field({ label: 'Public URL (optional)', path: 'publicUrl', env: 'PUBLIC_URL', placeholder: 'https://nowplaying.your-tailnet.ts.net', hint: 'Only needed if the Spotify redirect URI above is wrong.' })}
          {Field({ label: 'Admin PIN for settings (optional)', path: 'adminPin', type: 'password', env: 'ADMIN_PIN' })}
        </section>
      </div>
      <footer className="settings-foot">
        <span className="muted small">nowplaying v{config.version}</span>
        <button className="btn btn-cta" disabled={saving} onClick={() => save()}>{saving ? 'Saving…' : 'Save'}</button>
      </footer>
    </Shell>
  );
}

function Shell({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="settings-backdrop" onPointerDown={(e) => e.stopPropagation()}>
      <div className="settings" role="dialog" aria-label="Settings">
        <header className="panel-head">
          <h2>Settings</h2>
          <button className="btn btn-small" onClick={onClose} aria-label="Close"><IconClose size={20} /></button>
        </header>
        {children}
      </div>
    </div>
  );
}
