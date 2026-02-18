/**
 * Vitest global setup for jsdom environment.
 *
 * Ensures a working localStorage implementation is available for stores
 * that use zustand's persist middleware or access localStorage directly.
 */

const store = new Map<string, string>();

const localStorageShim: Storage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => {
    store.set(key, value);
  },
  removeItem: (key: string) => {
    store.delete(key);
  },
  clear: () => {
    store.clear();
  },
  get length() {
    return store.size;
  },
  key: (index: number) => [...store.keys()][index] ?? null,
};

Object.defineProperty(globalThis, 'localStorage', {
  value: localStorageShim,
  writable: true,
  configurable: true,
});
