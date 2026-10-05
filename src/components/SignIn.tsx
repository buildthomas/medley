import { useState } from 'react';
import { signIn } from '../lib/auth';
import { Logo } from './Logo';

/** Shown instead of the app on a hosted Medley when you aren't signed in. */
export function SignIn({ onSignedIn }: { onSignedIn(): void }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const err = await signIn(code.trim());
    setBusy(false);
    if (err) setError(err);
    else onSignedIn();
  }

  return (
    <div className="signin">
      <form className="signin-card" onSubmit={submit}>
        <div className="signin-brand">
          <Logo size={40} /> <span className="wordmark">medley</span>
        </div>
        <p className="muted">This Medley is invite-only. Enter your invite code to continue.</p>
        <input
          type="password"
          autoComplete="current-password"
          placeholder="Invite code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          autoFocus
          aria-label="Invite code"
        />
        <button className="primary" disabled={busy || !code.trim()}>
          {busy ? 'Checking…' : 'Sign in'}
        </button>
        {error && <div className="notice err">{error}</div>}
      </form>
    </div>
  );
}
