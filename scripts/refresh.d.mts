import type { CatalogGame } from '../src/types.ts';

export interface RefreshStatus {
  state: 'idle' | 'running' | 'error';
  generatedAt: string | null;
  startedAt?: number;
  finishedAt?: number;
  error?: string;
  log: string[];
  requested: boolean;
}

export const REFRESH_AFTER: number;
export function catalogsBuiltAt(dataDir: string): string | null;
export function catalogsAreStale(dataDir: string): boolean;
export function refreshStatus(dataDir: string): RefreshStatus;
export function requestRefresh(dataDir: string): void;
export function runRefresh(opts: { dataDir: string; configDir: string; log?: (msg: string) => void }): Promise<boolean>;
export function readMyGames(configDir: string): CatalogGame[];
