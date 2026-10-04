import { useLiveQuery } from 'dexie-react-hooks';
import { db, setMeta } from '../db';
import type { Arrivals } from '../lib/bulk';
import { useCatalog } from '../lib/catalog';
import { requestDiscover } from '../lib/intents';
import type { Session } from '../useSession';
import { Cover } from './discover/Cover';

/**
 * "What's new" after a weekly update (or a background import): new titles with their covers,
 * plus new tracks found in titles you already had. Stays until dismissed.
 */
export function NewArrivals({ session, onBrowse }: { session: Session; onBrowse(): void }) {
  const arrivals = useLiveQuery(async () => (await db.meta.get('arrivals'))?.value as Arrivals | null | undefined, [], null);
  const cat = useCatalog();
  if (!arrivals || (!arrivals.ids.length && !arrivals.newTrackIds?.length)) return null;

  const titles = arrivals.ids.map((id) => cat?.byId.get(id) ?? session.gameMap.get(id)).filter(Boolean);
  const newTrackIds = (arrivals.newTrackIds ?? []).filter((id) => session.trackMap.has(id));
  const fromNewTitles = session.tracks.filter((t) => arrivals.ids.includes(t.gameId) && !t.banned && !t.unavailable).map((t) => t.id);
  const toPlay = [...new Set([...fromNewTitles, ...newTrackIds])];
  const when = new Date(arrivals.at).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });

  const parts = [
    titles.length && `${titles.length} new title${titles.length === 1 ? '' : 's'}`,
    newTrackIds.length && `${newTrackIds.length} new track${newTrackIds.length === 1 ? '' : 's'} in ${arrivals.trackGameIds?.length ?? 0} titles you have`,
  ].filter(Boolean);

  return (
    <section className="arrivals" aria-label="New in your library">
      <div className="arrivals-covers" aria-hidden>
        {titles.slice(0, 7).map((g, i) => (
          <div key={g!.id} className="arrivals-cover" style={{ zIndex: 10 - i }}>
            <Cover game={g!} />
          </div>
        ))}
      </div>
      <div className="arrivals-text">
        <p className="eyebrow">New since {when}</p>
        <h2>{parts.join(' · ') || 'Your library was updated'}</h2>
        {titles.length > 0 && (
          <p className="muted small truncate">
            {titles
              .slice(0, 6)
              .map((g) => g!.title)
              .join(', ')}
            {titles.length > 6 && ` and ${titles.length - 6} more`}
          </p>
        )}
      </div>
      <div className="arrivals-actions">
        {toPlay.length > 0 && (
          <button className="primary" onClick={() => session.playProgram("What's new", toPlay, { shuffle: true })}>
            ▶ Play what's new
          </button>
        )}
        {titles.length > 0 && (
          <button
            onClick={() => {
              requestDiscover("What's new", arrivals.ids);
              onBrowse();
            }}
          >
            Browse them
          </button>
        )}
        <button className="link" onClick={() => setMeta('arrivals', null)}>
          dismiss
        </button>
      </div>
    </section>
  );
}
