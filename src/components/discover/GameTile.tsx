import { kindLabel, kindOf } from '../../lib/kinds';
import type { CatalogGame } from '../../types';
import { Cover } from './Cover';

export interface TileState {
  inLibrary: boolean;
  busy?: boolean;
  failed?: boolean;
  upcoming?: boolean;
}

export function GameTile({
  game,
  state,
  showKind,
  onOpen,
  onAdd,
  onPlay,
}: {
  game: CatalogGame;
  state: TileState;
  /** Show what kind of title this is (in the mixed "Everything" view). */
  showKind?: boolean;
  onOpen(game: CatalogGame): void;
  onAdd(game: CatalogGame): void;
  onPlay(game: CatalogGame): void;
}) {
  const kind = kindLabel(kindOf(game));
  const sub = [
    showKind ? kind.icon : null,
    game.year,
    state.upcoming ? 'upcoming' : null,
    state.failed ? 'nothing found' : null,
  ].filter(Boolean);
  return (
    <div className={`tile ${state.inLibrary ? 'owned' : ''}`}>
      <button className="tile-art" onClick={() => onOpen(game)} title={game.title}>
        <Cover game={game} />
        {state.inLibrary && <span className="tile-badge">✓</span>}
        {state.upcoming && !state.inLibrary && <span className="tile-ribbon">Soon</span>}
      </button>
      <div className="tile-action">
        {state.busy ? (
          <span className="spinner" />
        ) : state.inLibrary ? (
          <button className="tile-btn play" onClick={() => onPlay(game)} title="Play a track">
            ▶
          </button>
        ) : state.upcoming ? null : (
          <button className="tile-btn" onClick={() => onAdd(game)} title="Find and add the soundtrack">
            +
          </button>
        )}
      </div>
      <button className="tile-meta" onClick={() => onOpen(game)}>
        <span className="tile-title">{game.title}</span>
        <span className="tile-sub">{sub.join(' · ')}</span>
      </button>
    </div>
  );
}
