import { useState } from 'react';
import { signIn } from '../lib/auth';
import { Logo } from './Logo';

const DOMAINS = [
  { icon: '🎮', title: 'Games', text: 'Soundtracks from thousands of games, from NES classics to this year’s releases.' },
  { icon: '🌸', title: 'Anime', text: 'Every opening, ending and insert song, by name and artist, plus the score.' },
  { icon: '🎬', title: 'Film & TV', text: 'Disney and Pixar sing-alongs, musicals, scores and series themes.' },
  { icon: '🎤', title: 'Artists', text: 'The songs of the artists you love, next to everything else.' },
];

const FEATURES = [
  ['Your own shuffle', 'Pick what plays: genres, series, openings only, sing-along songs, era. Variety and familiarity are yours to tune.'],
  ['One click to add', 'Choose a title and Medley finds its soundtrack, or paste any YouTube playlist.'],
  ['Keeps itself fresh', 'New releases, new episodes’ songs and changed playlists arrive by themselves every week.'],
  ['Plays anywhere', 'Through YouTube’s own player, with media keys and a pop-out mini player.'],
];

/**
 * The home page (the logo leads here). Doubles as the sign-in page on a hosted, invite-only
 * Medley: then it's the only thing shown until you're in (main.tsx).
 */
export function Home({ signInRequired, onSignedIn, onNavigate }: { signInRequired?: boolean; onSignedIn?(): void; onNavigate?(tab: 'discover' | 'listen'): void }) {
  return (
    <div className={`home ${signInRequired ? 'home-gate' : ''}`}>
      {signInRequired && (
        <header className="topbar">
          <span className="brand">
            <Logo /> <span className="wordmark">medley</span>
          </span>
        </header>
      )}
      <section className="home-hero">
        <div className="home-pitch">
          <p className="eyebrow">Games · anime · film &amp; TV · artists</p>
          <h1>
            Every story has <span className="dim">a sound.</span>
          </h1>
          <p className="home-lede">
            Medley is your own radio for the music of the things you love: game soundtracks, anime openings, film and TV
            songs and your favourite artists, shuffled your way.
          </p>
          {signInRequired ? null : (
            <div className="row-actions">
              <button className="primary big" onClick={() => onNavigate?.('discover')}>
                Discover music
              </button>
              <button className="big" onClick={() => onNavigate?.('listen')}>
                Start listening
              </button>
            </div>
          )}
        </div>
        {signInRequired && <SignInCard onSignedIn={onSignedIn} />}
      </section>

      <section className="home-domains" aria-label="What's in Medley">
        {DOMAINS.map((d) => (
          <div key={d.title} className="home-domain">
            <span className="home-domain-icon" aria-hidden>
              {d.icon}
            </span>
            <h2>{d.title}</h2>
            <p className="muted">{d.text}</p>
          </div>
        ))}
      </section>

      <section className="home-features">
        {FEATURES.map(([title, text]) => (
          <div key={title}>
            <h3>{title}</h3>
            <p className="muted">{text}</p>
          </div>
        ))}
      </section>

      <p className="home-foot muted small">
        Music plays through YouTube’s embedded player. Your library, likes and history stay in your browser.
      </p>
    </div>
  );
}

function SignInCard({ onSignedIn }: { onSignedIn?(): void }) {
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
    else onSignedIn?.();
  }

  return (
    <form className="signin-card" onSubmit={submit}>
      <h2>Sign in</h2>
      <p className="muted small">This Medley is invite-only. Enter your invite code.</p>
      <input
        type="password"
        autoComplete="current-password"
        placeholder="Invite code"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        autoFocus={!matchMedia('(pointer: coarse)').matches /* no surprise keyboard on phones */}
        aria-label="Invite code"
      />
      <button className="primary" disabled={busy || !code.trim()}>
        {busy ? 'Checking…' : 'Sign in'}
      </button>
      {error && <div className="notice err">{error}</div>}
    </form>
  );
}
