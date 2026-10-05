// Game platforms as they appear in soundtrack playlist titles ("Harry Potter and the Chamber of
// Secrets (PC) - OST", "[GBA] … Soundtrack"). Many multi-platform games of the 2000s were
// different games per platform with different music, so a title can hold several **versions**,
// each its own source labelled by platform (see importer.ts importVersions / addVersion).

export interface Platform {
  label: string;
  /** How playlist titles write it. */
  re: RegExp;
  /** Wikidata platform names (catalog tags.platform) that count as this platform. */
  names: string[];
}

export const PLATFORMS: Platform[] = [
  { label: 'PC', re: /\b(pc|windows|ms-?dos|dos)\b/i, names: ['PC', 'Microsoft Windows', 'macOS', 'Mac', 'Classic Mac OS', 'Linux', 'MS-DOS'] },
  { label: 'GameCube', re: /\b(gamecube|game ?cube|gcn|ngc|gc)\b/i, names: ['GameCube'] },
  { label: 'PS2', re: /\b(ps2|playstation ?2)\b/i, names: ['PlayStation 2'] },
  { label: 'PS1', re: /\b(ps1|psx|psone|playstation(?! ?[2-5]| portable| vita))\b/i, names: ['PlayStation'] },
  { label: 'PS3', re: /\b(ps3|playstation ?3)\b/i, names: ['PlayStation 3'] },
  { label: 'Xbox', re: /\bxbox\b(?! ?(360|one|series))/i, names: ['Xbox'] },
  { label: 'Xbox 360', re: /\bxbox ?360\b/i, names: ['Xbox 360'] },
  { label: 'Wii', re: /\bwii\b(?! ?u)/i, names: ['Wii'] },
  { label: 'GBA', re: /\b(gba|game ?boy advance)\b/i, names: ['Game Boy Advance'] },
  { label: 'GBC', re: /\b(gbc|game ?boy colou?r)\b/i, names: ['Game Boy Color'] },
  { label: 'Game Boy', re: /\bgame ?boy\b(?! ?(advance|colou?r))/i, names: ['Game Boy'] },
  { label: 'DS', re: /\b(nds|nintendo ds|ds)\b/i, names: ['Nintendo DS'] },
  { label: '3DS', re: /\b3ds\b/i, names: ['Nintendo 3DS'] },
  { label: 'PSP', re: /\b(psp|playstation portable)\b/i, names: ['PlayStation Portable'] },
  { label: 'N64', re: /\b(n64|nintendo 64)\b/i, names: ['Nintendo 64'] },
  { label: 'SNES', re: /\b(snes|super nintendo|super famicom|sfc)\b/i, names: ['Super Nintendo Entertainment System'] },
  { label: 'NES', re: /\b(nes|famicom)\b/i, names: ['Nintendo Entertainment System'] },
  { label: 'Genesis', re: /\b(genesis|mega ?drive)\b/i, names: ['Sega Genesis', 'Mega Drive'] },
];

/** Platforms named in a playlist title, e.g. ["PC"] or ["PS2", "GameCube", "Xbox"]. */
export const platformsIn = (text: string) => PLATFORMS.filter((p) => p.re.test(text)).map((p) => p.label);

/** The game's platforms (catalog tags) as labels from the list above. */
export const gamePlatforms = (tagPlatforms: string[] = []) =>
  PLATFORMS.filter((p) => p.names.some((n) => tagPlatforms.includes(n))).map((p) => p.label);
