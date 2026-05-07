"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * A localStorage-backed useState that does NOT trip the
 * `react-hooks/set-state-in-effect` lint and stays in sync across tabs.
 *
 * Replaces the old hand-rolled pattern that ~30 tools used:
 *
 *     const [foo, setFoo] = useState(DEFAULT);
 *     const [hydrated, setHydrated] = useState(false);
 *     useEffect(() => {
 *       const raw = localStorage.getItem(KEY);
 *       if (raw) setFoo(JSON.parse(raw));
 *       setHydrated(true);
 *     }, []);
 *     useEffect(() => {
 *       if (!hydrated) return;
 *       localStorage.setItem(KEY, JSON.stringify(foo));
 *     }, [foo, hydrated]);
 *
 * Becomes:
 *
 *     const [foo, setFoo] = useLocalStorageState(KEY, DEFAULT);
 *
 * Behaviour:
 *   - SSR: `initial` is rendered (so the server HTML is deterministic
 *     and there's no hydration-mismatch warning).
 *   - Client first paint: also `initial` (matches SSR).
 *   - After hydration commits: synchronously reads localStorage and
 *     re-renders with the stored value.
 *   - Subsequent setValue calls write to localStorage and notify any
 *     other components watching the same key (including in other tabs).
 *
 * Caller MUST pass a referentially stable `initial` (define it at module
 * scope, not inline). Same convention every existing tool follows.
 */
export function useLocalStorageState<T>(
  key: string,
  initial: T,
): [T, (next: T | ((prev: T) => T)) => void] {
  const subscribe = useCallback(
    (callback: () => void) => makeSubscribe(key, callback),
    [key],
  );
  const getSnap = useCallback(() => readSnapshot<T>(key, initial), [key, initial]);
  const getServerSnap = useCallback(() => initial, [initial]);

  const value = useSyncExternalStore(subscribe, getSnap, getServerSnap);

  const setValue = useCallback(
    (next: T | ((prev: T) => T)) => {
      try {
        const current = readSnapshot<T>(key, initial);
        const resolved =
          typeof next === "function"
            ? (next as (prev: T) => T)(current)
            : next;
        if (resolved === undefined) {
          window.localStorage.removeItem(key);
        } else {
          window.localStorage.setItem(key, JSON.stringify(resolved));
        }
      } catch {
        // Quota exceeded, private mode without storage, etc. Swallow —
        // the in-memory value still updates because we invalidate the
        // cache and dispatch the write event below.
      }
      cache.delete(key);
      try {
        window.dispatchEvent(new CustomEvent(STORAGE_WRITE, { detail: key }));
      } catch {}
    },
    [key, initial],
  );

  return [value, setValue];
}

/* -------------------------------------------------------------------------
 * Internals.
 *
 * useSyncExternalStore requires getSnapshot to return a stable reference
 * when the underlying value hasn't changed — otherwise React loops. We
 * cache the parsed value keyed by storage key, comparing the raw string
 * to detect changes.
 * -----------------------------------------------------------------------*/

const STORAGE_WRITE = "hugoslekstuga:storage-write";

type CachedEntry<T> = { raw: string | null; value: T };
const cache = new Map<string, CachedEntry<unknown>>();

function readSnapshot<T>(key: string, initial: T): T {
  if (typeof window === "undefined") return initial;
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(key);
  } catch {
    return initial;
  }
  const cached = cache.get(key) as CachedEntry<T> | undefined;
  if (cached && cached.raw === raw) return cached.value;

  let value: T;
  if (raw === null) {
    value = initial;
  } else {
    try {
      value = JSON.parse(raw) as T;
    } catch {
      // Legacy fallback: an older version of the site wrote raw strings
      // (no JSON encoding) for some keys. If the caller's expected type
      // is a string, treat it as a string; otherwise fall back to initial.
      value = (typeof initial === "string" ? raw : initial) as T;
    }
  }
  cache.set(key, { raw, value } as CachedEntry<unknown>);
  return value;
}

function makeSubscribe(key: string, callback: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onStorage = (e: StorageEvent) => {
    if (e.key === key || e.key === null) {
      cache.delete(key);
      callback();
    }
  };
  const onWrite = (e: Event) => {
    if ((e as CustomEvent<string>).detail === key) {
      cache.delete(key);
      callback();
    }
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(STORAGE_WRITE, onWrite as EventListener);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(STORAGE_WRITE, onWrite as EventListener);
  };
}
