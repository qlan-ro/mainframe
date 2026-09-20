/* PROTOTYPE — throwaway design-walk scaffolding (2026-09-20, todos #340 #341 #355 #357).
 * Never ships: every entry point is gated on import.meta.env.DEV and a
 * ?prototype=<group>&variant=<A|B|C> URL param. */
import { useSyncExternalStore } from 'react';

export type PrototypeGroup = 'links' | 'dialog' | 'notes';

export const VARIANTS: Record<PrototypeGroup, { key: string; name: string }[]> = {
  links: [
    { key: 'A', name: 'Inline link + file glyph' },
    { key: 'B', name: 'Path chip' },
    { key: 'C', name: 'Mono path, hover actions' },
  ],
  dialog: [
    { key: 'A', name: 'Corner grip' },
    { key: 'B', name: 'Edge zones, hover dot' },
    { key: 'C', name: 'Grip + live size badge' },
  ],
  notes: [
    { key: 'A', name: 'Left gutter +' },
    { key: 'B', name: 'Right margin icon' },
    { key: 'C', name: 'Select block → toolbar' },
  ],
};

function params(): URLSearchParams {
  return new URLSearchParams(window.location.search);
}

export function prototypeGroup(): PrototypeGroup | null {
  if (!import.meta.env.DEV) return null;
  const g = params().get('prototype');
  return g && g in VARIANTS ? (g as PrototypeGroup) : null;
}

const listeners = new Set<() => void>();

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  window.addEventListener('popstate', fn);
  return () => {
    listeners.delete(fn);
    window.removeEventListener('popstate', fn);
  };
}

function readVariant(): string {
  return params().get('variant') ?? 'A';
}

export function setVariant(v: string): void {
  const url = new URL(window.location.href);
  url.searchParams.set('variant', v);
  window.history.replaceState(null, '', url);
  listeners.forEach((fn) => fn());
}

export function useVariant(): string {
  return useSyncExternalStore(subscribe, readVariant, () => 'A');
}

/** The active variant key for `group`, or null when that group is not being prototyped. */
export function usePrototype(group: PrototypeGroup): string | null {
  const v = useVariant();
  return prototypeGroup() === group ? v : null;
}
