import { useState } from 'react';
import type { CatalogGame } from '../../types';

// Deterministic hue per title, for the placeholder when no cover image works.
function hue(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return h;
}

/** Portrait cover art: tries each candidate in order, then a generated placeholder. */
export function Cover({ game, className = '' }: { game: Pick<CatalogGame, 'title' | 'covers' | 'year'>; className?: string }) {
  const [attempt, setAttempt] = useState(0);
  const src = game.covers?.[attempt];
  const h = hue(game.title);

  if (!src) {
    return (
      <div
        className={`cover cover-placeholder ${className}`}
        style={{ background: `linear-gradient(160deg, hsl(${h} 45% 32%), hsl(${(h + 50) % 360} 50% 14%))` }}
      >
        <span>{game.title}</span>
        {game.year && <small>{game.year}</small>}
      </div>
    );
  }
  return (
    <div className={`cover ${className}`}>
      {/* Square art (Roblox icons, some Wikipedia covers) gets a blurred backdrop instead of a hard crop. */}
      <img className="cover-backdrop" src={src} alt="" aria-hidden loading="lazy" />
      <img
        className="cover-img"
        src={src}
        alt={game.title}
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setAttempt((a) => a + 1)}
        onLoad={(e) => {
          const img = e.currentTarget;
          // Steam returns a tiny placeholder for apps without portrait art.
          if (img.naturalWidth < 60) setAttempt((a) => a + 1);
          else img.parentElement?.classList.toggle('fit-contain', img.naturalWidth / img.naturalHeight > 0.8);
        }}
      />
    </div>
  );
}
