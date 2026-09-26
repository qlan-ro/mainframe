/**
 * The sidebar's own view of fork lineage, shared by every row via context
 * instead of prop drilling (todo #343's plan: "the all-items map, the
 * filtered set, group membership flows through a small React context from
 * SessionSidebar"). `SessionSidebar` already computes both arrays; this just
 * publishes them for `use-fork-lineage-row` to classify a fallback fork's
 * parent against.
 */
import { createContext, useContext, type ReactNode } from 'react';
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
