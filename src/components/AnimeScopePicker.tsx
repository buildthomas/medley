import { ANIME_SCOPES, setAnimeScope, useAnimeScope } from '../lib/importers/anime';

/**
 * "Adding anime: Everything / Songs only / OPs & EDs / Openings". One per-browser setting used
 * by every way of adding anime (tile +, Add all, collections, the paste-a-list card).
 */
export function AnimeScopePicker({ label = 'Adding anime' }: { label?: string }) {
  const scope = useAnimeScope();
  return (
    <div className="scope-picker" role="radiogroup" aria-label={label}>
      <span className="muted small">{label}:</span>
      {ANIME_SCOPES.map((s) => (
        <button
          key={s.id}
          role="radio"
          aria-checked={scope === s.id}
          className={`chip ${scope === s.id ? 'on' : ''}`}
          title={s.hint}
          onClick={() => setAnimeScope(s.id)}
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}
