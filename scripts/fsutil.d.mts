export function writeFileAtomic(file: string, data: string | Uint8Array): void;
export function readJson<T = unknown>(file: string, fallback?: T | null): T | null;
