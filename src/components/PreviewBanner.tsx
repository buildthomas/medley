import { useState } from 'react';
import { INSTALL_URL, PREVIEW } from '../lib/preview';
import { sendToLocal, takeHandoffResult } from '../lib/previewHandoff';

/**
 * In the GitHub Pages preview: what this is, how to get the real thing, and moving your library
 * to a local Medley. Locally: the one-time note after such a move ("Brought over 12 titles…").
 */
export function PreviewBanner() {
  const [notice, setNotice] = useState(takeHandoffResult);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  if (!PREVIEW) {
    if (!notice) return null;
    return (
      <div className="preview-banner" role="status">
        <span>{notice}</span>
        <span className="spacer" />
        <button className="link" onClick={() => setNotice(null)} aria-label="Dismiss">
          ✕
        </button>
      </div>
    );
  }

  async function move() {
    setBusy(true);
    setResult(null);
    setResult((await sendToLocal()) ?? 'Done: your library, likes and plays are in your local Medley now.');
    setBusy(false);
  }

  return (
    <div className="preview-banner" role="note">
      <span>
        <b>Preview</b> · Medley without its server: browse everything and play the demo library. Adding music needs a
        local install.
      </span>
      <span className="spacer" />
      <a href={INSTALL_URL} target="_blank" rel="noreferrer">
        Get Medley ↗
      </a>
      <button className="link" disabled={busy} onClick={move} title="Opens your local Medley (localhost:32123) and copies this library into it">
        {busy ? 'Moving…' : 'Move to my local Medley'}
      </button>
      {result && <span className="preview-result">{result}</span>}
    </div>
  );
}
