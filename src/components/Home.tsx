import { useMemo, useState } from 'react';
import { signIn } from '../lib/auth';
import { franchiseOf, useCatalog } from '../lib/catalog';
import { Logo } from './Logo';

/** Posters and box art only (no logos or wide banners), so the strip reads as one shelf. */
const POSTER = /library_600x900|anilistcdn|upload\.wikimedia\.org\/.+\.jpe?g$/i;
const REEL = 14;

/**
 * The home page (the logo leads here): one line on what Medley is, the way in, and a slow strip
 * of covers. It doubles as the sign-in page on a hosted, invite-only Medley, where it's the only
 * thing shown until you're in (main.tsx); the catalog isn't loaded there, so no strip.
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
        <p className="eyebrow">Games · Anime · Film &amp; TV</p>
        <h1>
          Every story has <span className="dim">a sound.</span>
        </h1>
        <p className="home-lede">Your own radio for soundtracks, openings and scores, shuffled your way.</p>
        {signInRequired ? (
          <SignInCard onSignedIn={onSignedIn} />
        ) : (
          <div className="home-actions">
            <button className="primary big" onClick={() => onNavigate?.('listen')}>
              Start listening
            </button>
            <button className="big" onClick={() => onNavigate?.('discover')}>
              Discover music
            </button>
          </div>
        )}
      </section>
      {!signInRequired && <CoverReel />}
      <p className="home-foot muted small">Plays through YouTube · your library stays in your browser</p>
    </div>
  );
}

/** The best-known titles of each domain, interleaved, drifting slowly sideways. */
function CoverReel() {
  const cat = useCatalog();
  const covers = useMemo(() => {
    if (!cat) return [];
    // One title per series, so it isn't three GTAs in a row.
    const pick = (kind: string) => {
      const seen = new Set<string>();
      return cat.games
        .filter((g) => (g.kind ?? 'game') === kind && g.covers?.some((c) => POSTER.test(c)))
        .sort((a, b) => (b.pop ?? 0) - (a.pop ?? 0))
        .filter((g) => {
          const key = franchiseOf(g) ?? g.id;
          return !seen.has(key) && !!seen.add(key);
        })
        .slice(0, REEL)
        .map((g) => ({ id: g.id, title: g.title, src: g.covers!.find((c) => POSTER.test(c))! }));
    };
    const lists = [pick('game'), pick('anime'), pick('film')];
    const out: { id: string; title: string; src: string }[] = [];
    for (let i = 0; i < REEL; i++) for (const l of lists) if (l[i]) out.push(l[i]);
    return out;
  }, [cat]);
  if (!covers.length) return <div className="home-reel" aria-hidden />;
  return (
    <div className="home-reel" aria-hidden>
      <div className="home-reel-track">
        {[...covers, ...covers].map((c, i) => (
          <img key={i} src={c.src} alt="" loading="lazy" referrerPolicy="no-referrer" title={c.title} />
        ))}
      </div>
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
