/**
 * The turn model, published to every slice, row and header below
 * `TurnTranscript`.
 *
 * Not a plain context value: the model is rebuilt on every streamed chunk, and
 * a fresh value would re-render every consumer although the cache keeps each
 * untouched turn and slice identical. The provider hands out one stable store,
 * and each consumer selects the piece it reads, so a chunk re-renders only the
 * consumers whose piece moved.
 */
import { createContext, useContext, useLayoutEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { TurnModel } from '../../view-model/turn/types';
import type { LiveChildren } from './live-children';

export interface TurnContextValue {
  model: TurnModel;
  children: LiveChildren;
  open(key: string): boolean;
  toggle(key: string): void;
  /** Opens a turn that is folded; leaves an open one alone. */
  reveal(key: string): void;
  register(key: string, before: (automatic?: boolean) => void): () => void;
}

class TurnStore {
  private listeners = new Set<() => void>();
  constructor(public value: TurnContextValue) {}
  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  readonly notify = () => this.listeners.forEach((listener) => listener());
  // Stable delegates for handlers and effects; they always reach the latest value.
  readonly model = () => this.value.model;
  readonly toggle = (key: string) => this.value.toggle(key);
  readonly reveal = (key: string) => this.value.reveal(key);
  readonly register = (key: string, before: (automatic?: boolean) => void) => this.value.register(key, before);
}

const Context = createContext<TurnStore | null>(null);

/**
 * The latest value is stored during render, so slices rendering in this same
 * pass (a newly mounted message) already read it; consumers this pass did not
 * reach are notified in a layout effect, before paint. A discarded concurrent
 * render can only store what the committed one stores too.
 */
export function TurnProvider({ value, children }: { value: TurnContextValue; children: ReactNode }) {
  const [store] = useState(() => new TurnStore(value));
  store.value = value;
  useLayoutEffect(store.notify, [store, value]);
  return <Context.Provider value={store}>{children}</Context.Provider>;
}

const noSubscription = () => () => undefined;

/**
 * One piece of the turn state; re-renders only when `select`'s result changes
 * (Object.is), so return a primitive or an object the model already holds.
 * `fallback` outside a turn transcript (a sub-agent's own steps).
 */
export function useTurnSelector<T>(select: (value: TurnContextValue) => T, fallback: T): T {
  const store = useContext(Context);
  return useSyncExternalStore(store?.subscribe ?? noSubscription, () => (store ? select(store.value) : fallback));
}

/** Stable handlers, and the model as it is when they run: never re-render a consumer on their own. */
export function useTurnActions(): Pick<TurnContextValue, 'toggle' | 'reveal' | 'register'> & { model(): TurnModel } {
  const store = useContext(Context);
  if (!store) throw new Error('Turn transcript scope is missing');
  return store;
}
