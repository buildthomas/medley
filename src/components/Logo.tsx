// The Medley mark: five equalizer bars whose tops trace an "M". The bars bounce while music
// plays (ListenView sets `data-playing` on <html>; the animation lives in styles.css).
// public/favicon.svg is the same drawing on a dark tile; keep them in sync.

const BARS = [
  { x: 2, h: 24 },
  { x: 8, h: 17 },
  { x: 14, h: 10 },
  { x: 20, h: 17 },
  { x: 26, h: 24 },
];

export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg className="logo-mark" width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <defs>
        <linearGradient id="medley-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" style={{ stopColor: 'var(--brand-1)' }} />
          <stop offset="0.55" style={{ stopColor: 'var(--brand-2)' }} />
          <stop offset="1" style={{ stopColor: 'var(--brand-3)' }} />
        </linearGradient>
      </defs>
      {BARS.map((b, i) => (
        <rect key={b.x} x={b.x} y={29 - b.h} width={4} height={b.h} rx={2} fill="url(#medley-grad)" style={{ animationDelay: `${i * -0.23}s` }} />
      ))}
    </svg>
  );
}
