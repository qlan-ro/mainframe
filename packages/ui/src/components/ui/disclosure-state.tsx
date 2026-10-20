import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react';

const Context = createContext<{ values: Map<string, unknown>; key: string } | null>(null);

export function DisclosureStateProvider({ children }: { children: ReactNode }) {
  const [value] = useState(() => ({ values: new Map<string, unknown>(), key: '' }));
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function DisclosureScope({ id, children }: { id: string; children: ReactNode }) {
  const parent = useContext(Context);
  const value = useMemo(() => parent && { values: parent.values, key: `${parent.key}/${id}` }, [parent, id]);
  return value ? <Context.Provider value={value}>{children}</Context.Provider> : children;
}

export function useRetainedDisclosure(
  props: { open?: boolean; defaultOpen?: boolean; onOpenChange?: (open: boolean) => void },
  id: string,
) {
  const { open: controlled, onOpenChange, defaultOpen } = props;
  const scope = useContext(Context);
  const key = `${scope?.key}/${id}`;
  const cached = scope?.values.get(key);
  const saved = useRef(typeof cached === 'boolean' ? cached : undefined);
  const [open, setOpen] = useState(typeof cached === 'boolean' ? cached : (defaultOpen ?? false));
  const restored = useRef(false);
  useLayoutEffect(() => {
    if (!scope || controlled === undefined) return;
    if (!restored.current) {
      restored.current = true;
      if (saved.current !== undefined && controlled !== saved.current) {
        onOpenChange?.(saved.current);
        return;
      }
    }
    scope.values.set(key, controlled);
  }, [controlled, onOpenChange, scope, key]);
  if (!scope) return undefined;
  return {
    open: controlled ?? open,
    onOpenChange: (next: boolean) => {
      scope.values.set(key, next);
      setOpen(next);
      onOpenChange?.(next);
    },
  };
}

export function useRetainedValue<T>(id: string, initial: T): [T, Dispatch<SetStateAction<T>>] {
  const scope = useContext(Context);
  const key = `${scope?.key}/${id}`;
  const [value, setValue] = useState<T>(() => (scope?.values.has(key) ? (scope.values.get(key) as T) : initial));
  const current = useRef(value);
  const update: Dispatch<SetStateAction<T>> = useCallback(
    (next) => {
      const resolved = typeof next === 'function' ? (next as (previous: T) => T)(current.current) : next;
      current.current = resolved;
      scope?.values.set(key, resolved);
      setValue(resolved);
    },
    [scope, key],
  );
  return [value, update];
}
