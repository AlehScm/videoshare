"use client";

import { useSyncExternalStore } from "react";

const STORAGE_KEY = "videoshare:nome";
export const MAX_NAME_LENGTH = 24;

const listeners = new Set<() => void>();
// Nome fixo por aba: o localStorage só sugere o nome inicial, então outra aba
// trocando de nome não derruba esta da sala.
let tabName: string | null = null;

export function cleanName(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").slice(0, MAX_NAME_LENGTH);
}

function loadName(): string {
  if (tabName === null) {
    try {
      tabName = cleanName(localStorage.getItem(STORAGE_KEY) ?? "");
    } catch {
      tabName = "";
    }
  }
  return tabName;
}

export function saveName(name: string): void {
  tabName = cleanName(name);
  try {
    if (tabName) localStorage.setItem(STORAGE_KEY, tabName);
  } catch {}
  listeners.forEach((notify) => notify());
}

function subscribe(notify: () => void): () => void {
  listeners.add(notify);
  return () => {
    listeners.delete(notify);
  };
}

/** `null` enquanto não hidratou (servidor); `""` quando não há nome salvo. */
export function useSavedName(): string | null {
  return useSyncExternalStore(subscribe, loadName, () => null);
}
