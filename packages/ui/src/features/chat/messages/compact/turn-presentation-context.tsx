/**
 * The compact transcript's turn model, published to every slice, slot and
 * disclosure below `CompactTranscript`.
 *
 * Not a plain context value: the model is rebuilt on every streamed chunk, and
 * a fresh value would re-render every consumer — one per message, one per
 * unit — although the cache keeps each untouched turn and message identical.
 * The provider instead hands out one stable store, and each consumer selects
 * the slice it reads (its message's presentation, its turn, its open flag), so
 * a chunk re-renders only the consumers whose slice moved.
 */
import { createContext, useContext, useLayoutEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { TurnPresentation } from '../../view-model/compact/turn-types';

export interface TurnPresentationContext {
  model: TurnPresentation;
  open(key: string): boolean;
  toggle(key: string): void;
  register(key: string, before: (automatic?: boolean) => void): () => void;
}

class TurnPresentationStore {
  private listeners = new Set<() => void>();
  constructor(public value: TurnPresentationContext) {}
  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  readonly notify = () => this.listeners.forEach((listener) => listener());
  // Stable delegates for handlers and effects; they always reach the latest value.
  readonly toggle = (key: string) => this.value.toggle(key);
  readonly register = (key: string, before: (automatic?: boolean) => void) => this.value.register(key, before);
}

const Context = createContext<TurnPresentationStore | null>(null);

/**
 * The latest value is stored during render, so slices rendering in this same
 * pass (a newly mounted message) already read it; consumers this pass did not
 * reach are notified in a layout effect, before paint. A discarded concurrent
 * render can only store what the committed one stores too.
 */
export function TurnPresentationProvider({ value, children }: { value: TurnPresentationContext; children: ReactNode }) {
  const [store] = useState(() => new TurnPresentationStore(value));
  store.value = value;
  useLayoutEffect(store.notify, [store, value]);
  return <Context.Provider value={store}>{children}</Context.Provider>;
}

function useStore(): TurnPresentationStore {
  const store = useContext(Context);
  if (!store) throw new Error('Compact transcript scope is missing');
  return store;
}

/**
 * One slice of the turn presentation; re-renders only when `select`'s result
 * changes (Object.is). Return a primitive or an object the model already holds.
 */
export function useTurnPresentationSelector<T>(select: (value: TurnPresentationContext) => T): T {
  const store = useStore();
  return useSyncExternalStore(store.subscribe, () => select(store.value));
}

/** Stable `toggle` / `register` — never re-render a consumer on their own. */
export function useTurnPresentationActions(): Pick<TurnPresentationContext, 'toggle' | 'register'> {
  return useStore();
}
