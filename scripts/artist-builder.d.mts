export const ARTIST_GENRES: [string, RegExp][];
export function buildArtists(opts?: { log?: (msg: string) => void }): Promise<{ items: unknown[]; groups: unknown[] }>;
