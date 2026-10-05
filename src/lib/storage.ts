// Keeping the library safe in the browser. Without "persistent" storage a browser may clear a
// site's IndexedDB when the disk runs low (and Safari clears sites unused for 7 days). Chrome
// grants persistence silently based on how much you use the site (installing it as an app
// helps); Firefox asks once. We ask as soon as there's a library worth keeping.

import { useEffect, useState } from 'react';

export async function requestPersistence(): Promise<boolean | null> {
  if (!navigator.storage?.persist) return null;
  try {
    return (await navigator.storage.persisted()) || (await navigator.storage.persist());
  } catch {
    return null;
  }
}

export interface StorageStatus {
  /** null = the browser doesn't support asking */
  persisted: boolean | null;
  usage: number | null;
  quota: number | null;
}

export function useStorageStatus(): StorageStatus & { request(): Promise<void> } {
  const [status, setStatus] = useState<StorageStatus>({ persisted: null, usage: null, quota: null });
  const refresh = async () => {
    const persisted = navigator.storage?.persisted ? await navigator.storage.persisted().catch(() => null) : null;
    const estimate = navigator.storage?.estimate ? await navigator.storage.estimate().catch(() => null) : null;
    setStatus({ persisted, usage: estimate?.usage ?? null, quota: estimate?.quota ?? null });
  };
  useEffect(() => {
    void refresh();
  }, []);
  return {
    ...status,
    request: async () => {
      await requestPersistence();
      await refresh();
    },
  };
}

export const formatBytes = (n: number | null) =>
  n == null ? '?' : n < 1e6 ? `${Math.round(n / 1e3)} KB` : n < 1e9 ? `${(n / 1e6).toFixed(1)} MB` : `${(n / 1e9).toFixed(1)} GB`;
