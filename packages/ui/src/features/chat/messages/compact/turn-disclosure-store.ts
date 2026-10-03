export type TurnChoice = 'open' | 'closed';
const choices = new Map<string, TurnChoice>();
const invalid = new Set<string>();
const listeners = new Set<() => void>();
let revision = 0;
function changed() {
  revision++;
  for (const listener of listeners) listener();
}
export const turnDisclosureStore = {
  get: (key: string) => choices.get(key),
  isInvalid: (key: string) => invalid.has(key),
  snapshot: () => revision,
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  set(key: string, choice: TurnChoice) {
    if (choices.get(key) === choice) return;
    choices.set(key, choice);
    changed();
  },
  invalidate(key: string) {
    if (invalid.has(key)) return;
    invalid.add(key);
    changed();
  },
};
