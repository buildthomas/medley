import type { CatalogGame } from '../types';
import { normalize } from './parse';

// Soundtracks with a strong reputation, used for the one-click starter pack.
export const STARTER = [
  'Chrono Trigger', 'Final Fantasy VI', 'Final Fantasy VII', 'Undertale', 'Celeste', 'Hollow Knight',
  'Ori and the Blind Forest', 'Journey', 'Nier: Automata', 'Persona 5', 'The Legend of Zelda: Ocarina of Time',
  'Super Mario Galaxy', 'Halo 2', 'Doom', 'Hades', 'Bastion', 'Cave Story', 'Shovel Knight', 'Kingdom Hearts',
  'Dark Souls', 'The Elder Scrolls V: Skyrim', 'Minecraft', 'Sonic the Hedgehog 2', 'Mega Man 2', 'Castlevania: Symphony of the Night',
  'Xenoblade Chronicles', 'Octopath Traveler', 'Stardew Valley', 'Outer Wilds', 'Katamari Damacy', 'Okami',
  'Donkey Kong Country 2: Diddy\'s Kong Quest', 'EarthBound', 'Terraria', 'Red Dead Redemption',
];

/** The starter pack resolved against the catalog. Several games share a title (Doom 1993/2016); keep the most notable. */
export function starterGames(catalog: CatalogGame[]): CatalogGame[] {
  const best = new Map<string, CatalogGame>();
  const want = new Set(STARTER.map(normalize));
  for (const g of catalog) {
    const key = normalize(g.title);
    if (want.has(key) && (best.get(key)?.pop ?? -1) < g.pop) best.set(key, g);
  }
  return [...best.values()];
}
