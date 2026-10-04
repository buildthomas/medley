import { useState } from 'react';
import { connectionCode, resetRemoteKey, setRemoteEnabled, useRemoteSettings } from '../lib/remote';

/** Add link → Desktop companion: turn the link on and get the connection code. */
export function CompanionCard() {
  const { enabled, key, companions } = useRemoteSettings();
  const [copied, setCopied] = useState(false);
  const code = key ? connectionCode(key) : '';

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* select the field instead */
    }
  }

  return (
    <section className="card">
      <h2>Desktop companion</h2>
      <p className="muted">
        A small always-on-top window for your desktop that shows what's playing, with play/pause, skip, back and like. It
        works while this tab is in the background, and with Medley hosted elsewhere.
      </p>
      <label className="check">
        <input type="checkbox" checked={enabled} onChange={(e) => setRemoteEnabled(e.target.checked)} /> Let the companion
        show and control playback
      </label>
      {enabled && (
        <>
          <div className="toolbar">
            <input className="grow mono" readOnly value={code} onFocus={(e) => e.target.select()} aria-label="Connection code" />
            <button onClick={copy}>{copied ? 'Copied' : 'Copy code'}</button>
            <button
              className="link"
              title="Make a new code; companions using the old one are disconnected"
              onClick={() => confirm('Make a new code? Companions using the current one will need the new code.') && resetRemoteKey()}
            >
              new code
            </button>
          </div>
          <p className="small muted">
            {companions > 0
              ? `● ${companions} companion${companions === 1 ? '' : 's'} connected.`
              : 'Start it from the Medley folder, then paste the code (first time only):'}
          </p>
          {companions === 0 && (
            <pre className="code-block">npm run companion:install{'\n'}npm run companion</pre>
          )}
          <p className="small muted">The code works like a password for playback control; don't share it.</p>
        </>
      )}
    </section>
  );
}
