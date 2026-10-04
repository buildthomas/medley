import { useRef, type ReactNode } from 'react';

/** A titled, horizontally scrolling row (games or franchise cards). */
export function Shelf({
  title,
  subtitle,
  actions,
  children,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const row = useRef<HTMLDivElement>(null);
  const scroll = (dir: number) => row.current?.scrollBy({ left: dir * row.current.clientWidth * 0.85, behavior: 'smooth' });
  return (
    <section className="shelf">
      <header className="shelf-head">
        <div>
          <h2>{title}</h2>
          {subtitle && <p className="muted small">{subtitle}</p>}
        </div>
        <div className="shelf-actions">
          {actions}
          <button className="icon-round" onClick={() => scroll(-1)} aria-label="Scroll left">
            ‹
          </button>
          <button className="icon-round" onClick={() => scroll(1)} aria-label="Scroll right">
            ›
          </button>
        </div>
      </header>
      <div className="shelf-row" ref={row}>
        {children}
      </div>
    </section>
  );
}
