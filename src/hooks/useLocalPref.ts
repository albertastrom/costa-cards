"use client";

import { useCallback, useSyncExternalStore } from "react";
import { getBoolPref, setBoolPref } from "@/lib/session";

type PrefKey = "muted" | "shield" | "faceDown";

const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

export function useLocalPref(key: PrefKey): [boolean, (v: boolean) => void] {
  const value = useSyncExternalStore(
    subscribe,
    () => getBoolPref(key),
    () => false,
  );
  const set = useCallback(
    (v: boolean) => {
      setBoolPref(key, v);
      listeners.forEach((l) => l());
    },
    [key],
  );
  return [value, set];
}
