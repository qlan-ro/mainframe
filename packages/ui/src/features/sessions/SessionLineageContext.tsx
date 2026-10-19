/**
 * The sidebar's own view of fork lineage, shared by every row via context
 * instead of prop drilling (todo #343's plan: "the all-items map, the
 * filtered set, group membership flows through a small React context from
 * SessionSidebar"). `SessionSidebar` already computes both arrays; this just
 * publishes them for `use-fork-lineage-row` to classify a fallback fork's
 * parent against.
 */
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useStableList } from '@/lib/use-stable-list';
import type { SessionItem } from './view-model/chat-to-thread-custom';

export interface SessionLineageContextValue {
  /** Every regular, non-archived chat the sidebar has loaded, regardless of the active filters. */
  allItems: SessionItem[];
  /** Every id rendered across all of the arranged (post-filter) groups. */
  listedIds: ReadonlySet<string>;
  /** `allItems`' ids, precomputed once so per-row lookups don't rebuild a Set each render. */
  unfilteredIds: ReadonlySet<string>;
}

const EMPTY: SessionLineageContextValue = { allItems: [], listedIds: new Set(), unfilteredIds: new Set() };

const SessionLineageContext = createContext<SessionLineageContextValue>(EMPTY);

export function SessionLineageProvider({
  value,
  children,
}: {
  value: SessionLineageContextValue;
  children: ReactNode;
}) {
  return <SessionLineageContext.Provider value={value}>{children}</SessionLineageContext.Provider>;
}

/** Falls back to an empty lineage set outside the provider (e.g. an isolated row test). */
export function useSessionLineage(): SessionLineageContextValue {
  return useContext(SessionLineageContext);
}

/** What lineage reads off an item: fork nesting, fork counts and "started by" titles. */
function sameLineage(a: SessionItem, b: SessionItem): boolean {
  return (
    a === b ||
    (a.id === b.id &&
      a.remoteId === b.remoteId &&
      a.title === b.title &&
      a.status === b.status &&
      a.custom.parentChatId === b.custom.parentChatId &&
      a.custom.createdByChatId === b.custom.createdByChatId &&
      (a.custom.delegation != null) === (b.custom.delegation != null))
  );
}

/**
 * The provider value, held referentially stable until something lineage reads
 * moves. Every row consumes this context, so a fresh value re-renders the whole
 * list; a background chat's status or activity churn must re-render its own
 * row only. `allItems` can therefore carry an older copy of an item whose
 * non-lineage fields have since moved — rows read those off their own `item`.
 */
export function useSessionLineageValue(
  allItems: SessionItem[],
  listed: readonly { items: readonly SessionItem[] }[],
): SessionLineageContextValue {
  const lineageItems = useStableList(allItems, sameLineage);
  const unfilteredIds = useMemo(() => new Set(lineageItems.map((i) => i.id)), [lineageItems]);
  // Keyed on the sorted ids: a re-sort or an item's own update rebuilds the
  // groups without changing which ids are listed.
  const listedKey = listed
    .flatMap((g) => g.items.map((i) => i.id))
    .sort()
    .join('\n');
  const listedIds = useMemo(() => new Set(listedKey === '' ? [] : listedKey.split('\n')), [listedKey]);
  return useMemo(
    () => ({ allItems: lineageItems, listedIds, unfilteredIds }),
    [lineageItems, listedIds, unfilteredIds],
  );
}
