import { titlesLabel } from '../../lib/kinds';
import type { CatalogGame } from '../../types';
import { Cover } from './Cover';

export interface Franchise {
  name: string;
  games: CatalogGame[]; // most notable first
  owned: number;
}

/** Fanned stack of three covers, like a hand of cards. */
export function FranchiseCard({ franchise, onOpen }: { franchise: Franchise; onOpen(f: Franchise): void }) {
  const top = franchise.games.slice(0, 3);
  return (
    <button className="franchise-card" onClick={() => onOpen(franchise)}>
      <div className="fan">
        {top.map((g, i) => (
          <div key={g.id} className={`fan-card fan-${i} of-${top.length}`}>
            <Cover game={g} />
          </div>
        ))}
      </div>
      <div className="franchise-meta">
        <span className="tile-title">{franchise.name}</span>
        <span className="tile-sub">
          {titlesLabel(franchise.games)}{franchise.owned ? ` · ${franchise.owned} in library` : ''}
        </span>
      </div>
    </button>
  );
}
