import { useEffect, useState } from 'react';
import type { CatalogGame } from '../../types';

// Deterministic hue per title, for the placeholder when no cover image works.
function hue(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return h;
}

// --- transparent logos -------------------------------------------------------------------
// Some "covers" are logos on a transparent background. A black logo disappears on our dark
// tiles, so we sample the image once and pick a contrasting backdrop:
//   'light' → mostly-dark artwork with lots of transparency  → light backdrop
//   'dark'  → mostly-light artwork with lots of transparency → keep it dark, no blur
//   'none'  → opaque artwork (the normal case)
type Backdrop = 'light' | 'dark' | 'none';
const backdropCache = new Map<string, Promise<Backdrop>>();
const CACHE_KEY = 'vgm-shuffle:cover-backdrops';
let stored: Record<string, Backdrop> | null = null;

function storedBackdrops(): Record<string, Backdrop> {
  if (stored) return stored;
  try {
    stored = JSON.parse(localStorage.getItem(CACHE_KEY) ?? '{}');
  } catch {
    stored = {};
  }
  return stored!;
}

function remember(url: string, b: Backdrop) {
  const all = storedBackdrops();
  all[url] = b;
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(all));
  } catch {
    /* ignore */
  }
}

/** Only formats that can be transparent are worth sampling. */
const mayBeTransparent = (url: string) => /\.(png|gif|webp|svg)(\?|$)|rbxcdn\.com/i.test(url);

function analyseBackdrop(url: string): Promise<Backdrop> {
  const known = storedBackdrops()[url];
  if (known) return Promise.resolve(known);
  if (!mayBeTransparent(url)) return Promise.resolve('none');
  let p = backdropCache.get(url);
  if (p) return p;
  p = new Promise<Backdrop>((resolve) => {
    // A separate CORS-enabled request: if the host doesn't allow it we just keep the default look.
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onerror = () => resolve('none');
    img.onload = () => {
      try {
        const w = 48;
        const h = Math.max(1, Math.round((48 * img.naturalHeight) / Math.max(1, img.naturalWidth)));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
        ctx.drawImage(img, 0, 0, w, h);
        const data = ctx.getImageData(0, 0, w, h).data;
        let transparent = 0;
        let opaque = 0;
        let lum = 0;
        for (let i = 0; i < data.length; i += 4) {
          if (data[i + 3] < 40) transparent++;
          else {
            opaque++;
            lum += (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
          }
        }
        const total = transparent + opaque;
        const avg = opaque ? lum / opaque : 1;
        const result: Backdrop =
          transparent / total < 0.15 ? 'none' : avg < 0.45 ? 'light' : 'dark';
        remember(url, result);
        resolve(result);
      } catch {
        resolve('none'); // tainted canvas etc.
      }
    };
    img.src = url;
  });
  backdropCache.set(url, p);
  return p;
}

/** Portrait cover art: tries each candidate in order, then a generated placeholder. */
export function Cover({ game, className = '' }: { game: Pick<CatalogGame, 'title' | 'covers' | 'year'>; className?: string }) {
  const [attempt, setAttempt] = useState(0);
  const src = game.covers?.[attempt];
  const h = hue(game.title);
  const [backdrop, setBackdrop] = useState<Backdrop>(() => (src ? (storedBackdrops()[src] ?? 'none') : 'none'));

  useEffect(() => {
    if (!src) return;
    let alive = true;
    analyseBackdrop(src).then((b) => alive && setBackdrop(b));
    return () => {
      alive = false;
    };
  }, [src]);

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
    <div className={`cover ${className} ${backdrop !== 'none' ? `logo-on-${backdrop} fit-contain` : ''}`}>
      {/* Square art (Roblox icons, some Wikipedia covers) gets a blurred backdrop instead of a hard crop. */}
      {backdrop === 'none' && <img className="cover-backdrop" src={src} alt="" aria-hidden loading="lazy" />}
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
          else img.parentElement?.classList.toggle('fit-contain', backdrop !== 'none' || img.naturalWidth / img.naturalHeight > 0.8);
        }}
      />
    </div>
  );
}
