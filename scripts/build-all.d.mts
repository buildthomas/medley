export const DATA_FILES: string[];
export function buildAll(opts?: {
  log?: (msg: string) => void;
  cacheFile?: string;
  only?: string[];
  previousGames?: { id: string; pop?: number }[];
}): Promise<Record<string, unknown>>;
export function keepMissingGroups(
  files: Record<string, unknown>,
  prev: { groups: { domain?: string }[] } | null,
): Record<string, unknown>;
