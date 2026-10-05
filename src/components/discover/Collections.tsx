import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { titlesLabel } from '../../lib/kinds';
import type { WorkKind } from '../../types';
import type { Collections as CollectionsData } from '../../lib/catalog';
import { getSubscriptions, runUpdate, setSubscribed, UPDATE_INTERVAL, useUpdateStatus } from '../../lib/updater';
import type { CatalogGame } from '../../types';

// Film & TV groups mix films and series, so they're counted as "titles".
const DOMAIN_KIND: Record<string, WorkKind | undefined> = { game: 'game', anime: 'anime' };

export function Collections({
  catalog,
  collections,
  libraryIds,
  onAdd,
}: {
  catalog: CatalogGame[];
  collections: CollectionsData | null;
  libraryIds: Set<string>;
  onAdd(label: string, games: CatalogGame[]): void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const subs = useLiveQuery(() => getSubscriptions(), [], [] as string[]);
  const update = useUpdateStatus();
  const byId = useMemo(() => new Map(catalog.map((g) => [g.id, g])), [catalog]);
  const resolve = (ids: string[]) => ids.map((id) => byId.get(id)).filter((g): g is CatalogGame => !!g);
  if (!catalog.length || !collections) return null;

  const nextCheck = update.lastRefreshAt ? update.lastRefreshAt + UPDATE_INTERVAL : null;

  return (
    <section className="collections">
      {collections.groups.map((group) => {
        const all = [...new Set(group.lists.flatMap((l) => l.ids))];
        const have = all.filter((id) => libraryIds.has(id)).length;
        const expanded = open === group.id;
        const subscribed = subs.includes(group.id);
        return (
          <div key={group.id} className="collection">
            <div className="collection-head">
              <button className="link caret-btn" onClick={() => setOpen(expanded ? null : group.id)}>
                {expanded ? '▾' : '▸'}
              </button>
              <div className="collection-info" onClick={() => setOpen(expanded ? null : group.id)}>
                <b>{group.title}</b>
                <span className="muted small">
                  {' '}
                  ·{' '}
                  {DOMAIN_KIND[group.domain ?? 'game']
                    ? titlesLabel(all.map(() => ({ kind: DOMAIN_KIND[group.domain ?? 'game'] })))
                    : `${all.length.toLocaleString()} titles`}{' '}
                  · {have} in library
                </span>
                <div className="muted small">{group.description}</div>
              </div>
              <label className="check small" title="When the weekly update finds new titles in this collection, import them">
                <input
                  type="checkbox"
                  checked={subscribed}
                  onChange={(e) => setSubscribed(group.id, e.target.checked, all)}
                />
                auto-add new
              </label>
              <button
                disabled={have === all.length}
                onClick={() => {
                  setSubscribed(group.id, true, all);
                  onAdd(group.title, resolve(all));
                }}
              >
                {have === all.length ? 'All added' : `Add all ${all.length - have}`}
              </button>
            </div>
            {expanded && (
              <div className="chips collection-lists">
                {group.lists.map((l) => {
                  const missing = l.ids.filter((id) => !libraryIds.has(id));
                  return (
                    <button
                      key={l.id}
                      className={`chip ${missing.length ? '' : 'in'}`}
                      disabled={!missing.length}
                      title={resolve(l.ids)
                        .slice(0, 25)
                        .map((g) => g.title)
                        .join(', ')}
                      onClick={() => onAdd(`${group.title}: ${l.title}`, resolve(missing))}
                    >
                      {missing.length ? '+ ' : '✓ '}
                      {l.title}
                      <span className="chip-count">
                        {l.ids.length - missing.length}/{l.ids.length}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
      <p className="hint">
        Collections from Wikidata and Steam, generated {collections.generatedAt.slice(0, 10)}.{' '}
        {update.state === 'refreshing' ? (
          <>{update.message}</>
        ) : (
          <>
            {nextCheck && <>Next check for new titles {new Date(nextCheck).toLocaleDateString()}. </>}
            {update.message && <>{update.message} </>}
            <button className="link" onClick={() => runUpdate(true)}>
              check now
            </button>
          </>
        )}
      </p>
    </section>
  );
}
