const CACHE_PREFIX = "rationexa-refresh-v1:";
const CACHE_MAX_AGE_MS = 30 * 60_000;

type RefreshSnapshot<T> = {
  savedAt: number;
  value: T;
};

function cacheKey(resource: string): string {
  return `${CACHE_PREFIX}${resource}`;
}

export function readRefreshSnapshot<T>(resource: string): RefreshSnapshot<T> | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(cacheKey(resource));
    if (!raw) return null;
    const snapshot = JSON.parse(raw) as Partial<RefreshSnapshot<T>>;
    if (typeof snapshot.savedAt !== "number" || snapshot.value === undefined) return null;
    if (Date.now() - snapshot.savedAt > CACHE_MAX_AGE_MS) {
      window.sessionStorage.removeItem(cacheKey(resource));
      return null;
    }
    return snapshot as RefreshSnapshot<T>;
  } catch {
    return null;
  }
}

export function writeRefreshSnapshot<T>(resource: string, value: T): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(cacheKey(resource), JSON.stringify({ savedAt: Date.now(), value }));
  } catch {
    // Storage can be unavailable or full. Network loading remains the fallback.
  }
}

export function clearRefreshSnapshots(): void {
  if (typeof window === "undefined") return;
  try {
    for (let index = window.sessionStorage.length - 1; index >= 0; index -= 1) {
      const key = window.sessionStorage.key(index);
      if (key?.startsWith(CACHE_PREFIX)) window.sessionStorage.removeItem(key);
    }
  } catch {
    // Authentication still proceeds if browser storage is unavailable.
  }
}
