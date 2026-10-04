import { useState, type ReactNode } from 'react';
import type { ChipState } from '../types';

export function formatTime(s: number | null | undefined): string {
  if (s == null || !isFinite(s)) return '–:––';
  s = Math.max(0, Math.round(s));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

/** Tri-state chip: neutral → only these → never these → neutral. */
export function TriChips({
  options,
  state,
  onChange,
  counts,
}: {
  options: { id: string; label: string }[];
  state: ChipState;
  onChange(next: ChipState): void;
  counts?: Map<string, number>;
}) {
  function cycle(id: string) {
    const next = { ...state };
    if (!next[id]) next[id] = 'in';
    else if (next[id] === 'in') next[id] = 'out';
    else delete next[id];
    onChange(next);
  }
  return (
    <div className="chips">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          className={`chip ${state[o.id] ?? ''}`}
          onClick={() => cycle(o.id)}
          title={
            state[o.id] === 'in'
              ? 'Only these (click to exclude)'
              : state[o.id] === 'out'
                ? 'Excluded (click to reset)'
                : 'Click to play only these'
          }
        >
          {state[o.id] === 'in' ? '✓ ' : state[o.id] === 'out' ? '✕ ' : ''}
          {o.label}
          {counts && <span className="chip-count">{counts.get(o.id) ?? 0}</span>}
        </button>
      ))}
    </div>
  );
}

const SECTIONS_KEY = 'vgm-shuffle:open-sections';

function readOpenSections(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(SECTIONS_KEY) ?? '{}');
  } catch {
    return {};
  }
}

/**
 * Panel section. With an `id` it's collapsible (collapsed by default, remembered per browser);
 * `active` shows how many filters inside are set, so a collapsed section still tells you.
 */
export function Section({
  title,
  children,
  aside,
  id,
  active = 0,
}: {
  title: string;
  children: ReactNode;
  aside?: ReactNode;
  id?: string;
  active?: number;
}) {
  const [open, setOpen] = useState(() => (id ? (readOpenSections()[id] ?? false) : true));
  function toggle() {
    const next = !open;
    setOpen(next);
    if (!id) return;
    try {
      localStorage.setItem(SECTIONS_KEY, JSON.stringify({ ...readOpenSections(), [id]: next }));
    } catch {
      /* ignore */
    }
  }
  return (
    <section className={`panel-section ${id ? 'collapsible' : ''} ${open ? 'open' : ''}`}>
      <header>
        {id ? (
          <button className="section-toggle" onClick={toggle} aria-expanded={open}>
            <span className="caret">{open ? '▾' : '▸'}</span>
            <h3>{title}</h3>
            {active > 0 && <span className="active-count">{active}</span>}
          </button>
        ) : (
          <h3>{title}</h3>
        )}
        {open && aside}
      </header>
      {open && children}
    </section>
  );
}

export function Slider({
  label,
  left,
  right,
  value,
  onChange,
}: {
  label: string;
  left: string;
  right: string;
  value: number;
  onChange(v: number): void;
}) {
  return (
    <label className="slider">
      <span className="slider-label">{label}</span>
      <input type="range" min={0} max={1} step={0.05} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <span className="slider-ends">
        <span>{left}</span>
        <span>{right}</span>
      </span>
    </label>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}
