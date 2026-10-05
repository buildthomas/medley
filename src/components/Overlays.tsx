// The title and track pages, open on top of whatever tab you're on (lib/nav.ts). Only the top of
// the stack is shown; the back button / ✕ / Escape returns to the one below.

import { useCatalog } from '../lib/catalog';
import { closeTop, openTag, usePages } from '../lib/nav';
import type { CatalogGame } from '../types';
import type { Session } from '../useSession';
import { GameDetail } from './discover/GameDetail';
import { TrackDetail } from './TrackDetail';

export function Overlays({ session }: { session: Session }) {
  const pages = usePages();
  const cat = useCatalog();
  const top = pages.at(-1);
  if (!top) return null;

  if (top.type === 'track') return <TrackDetail key={top.id} id={top.id} session={session} />;

  // A title from the catalog, or one that only exists in the library (your own games).
  const libraryGame = session.gameMap.get(top.id);
  const game: CatalogGame | undefined =
    cat?.byId.get(top.id) ?? (libraryGame ? { ...libraryGame, franchise: libraryGame.franchise ?? undefined, pop: 0 } : undefined);
  if (!game) return null; // catalog still loading
  return <GameDetail key={top.id} game={game} session={session} onClose={closeTop} onFacet={openTag} />;
}
