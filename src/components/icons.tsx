// Player icons as SVG: text glyphs (⏮ ▶ ⏭ ♥) sit on a font baseline and render differently per
// OS font, so they never center properly in round buttons.

const Svg = ({ children, size = 16 }: { children: React.ReactNode; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
    {children}
  </svg>
);

export const PrevIcon = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <rect x="5" y="5" width="2.6" height="14" rx="1.1" />
    <path d="M19 6.2v11.6c0 .9-1 1.4-1.7.9L9.4 13a1.2 1.2 0 0 1 0-2l7.9-5.7c.7-.5 1.7 0 1.7.9z" />
  </Svg>
);

export const NextIcon = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <rect x="16.4" y="5" width="2.6" height="14" rx="1.1" />
    <path d="M5 6.2v11.6c0 .9 1 1.4 1.7.9l7.9-5.7a1.2 1.2 0 0 0 0-2L6.7 5.3C6 4.8 5 5.3 5 6.2z" />
  </Svg>
);

export const PlayIcon = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <path d="M7.5 5.3v13.4c0 1 1.1 1.6 1.9 1.1l10.4-6.7a1.3 1.3 0 0 0 0-2.2L9.4 4.2c-.8-.5-1.9.1-1.9 1.1z" />
  </Svg>
);

export const PauseIcon = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <rect x="6" y="5" width="4.2" height="14" rx="1.4" />
    <rect x="13.8" y="5" width="4.2" height="14" rx="1.4" />
  </Svg>
);

export const HeartIcon = ({ size, filled }: { size?: number; filled?: boolean }) => (
  <svg width={size ?? 16} height={size ?? 16} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path
      d="M12 20.3s-7.6-4.6-9.2-9.4C1.7 7.6 3.8 4.5 7.2 4.5c2 0 3.6 1.2 4.8 2.9 1.2-1.7 2.8-2.9 4.8-2.9 3.4 0 5.5 3.1 4.4 6.4-1.6 4.8-9.2 9.4-9.2 9.4z"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="2"
      strokeLinejoin="round"
    />
  </svg>
);
