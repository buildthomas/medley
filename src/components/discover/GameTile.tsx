import type { CatalogGame } from '../../types';
import { Cover } from './Cover';

export interface TileState {
  inLibrary: boolean;
  busy?: boolean;
  failed?: boolean;
}

export function GameTile({
  game,
  state,
  onOpen,
  onAdd,
  onPlay,
}: {
  game: CatalogGame;
  state: TileState;
  onOpen(game: CatalogGame): void;
  onAdd(game: CatalogGame): void;
  onPlay(game: CatalogGame): void;
}) {
  return (
    <div className={`tile ${state.inLibrary ? 'owned' : ''}`}>
      <button className="tile-art" onClick={() => onOpen(game)} title={game.title}>
        <Cover game={game} />
        {state.inLibrary && <span className="tile-badge">✓</span>}
      </button>
      <div className="tile-action">
        {state.busy ? (
          <span className="spinner" />
        ) : state.inLibrary ? (
          <button className="tile-btn play" onClick={() => onPlay(game)} title="Play a track from this game">
            ▶
          </button>
        ) : (
          <button className="tile-btn" onClick={() => onAdd(game)} title="Find and add the soundtrack">
            +
          </button>
        )}
      </div>
      <button className="tile-meta" onClick={() => onOpen(game)}>
        <span className="tile-title">{game.title}</span>
        <span className="tile-sub">
          {[game.year, state.failed ? 'no soundtrack found' : null].filter(Boolean).join(' · ')}
        </span>
      </button>
    </div>
  );
}
