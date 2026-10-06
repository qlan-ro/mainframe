/**
 * useAutomationsLibrary — subscribe one surface to one scope's library entry,
 * loading it on mount and whenever the scope changes. The modal calls it with
 * its own project (gated on `open`) and the sidebar list with
 * `soleProjectId ?? 'all'`; the store keeps both entries, so neither evicts
 * the other.
 */
import { useEffect } from 'react';
import { scopeKeyOf, type LibraryEntry } from './library-cache';
import { selectLibrary, useAutomationsStore } from './use-automations-store';

export function useAutomationsLibrary(projectId: string | null, enabled = true): LibraryEntry {
  const loadLibrary = useAutomationsStore((s) => s.loadLibrary);
  useEffect(() => {
    if (enabled) void loadLibrary(projectId);
  }, [enabled, projectId, loadLibrary]);
  return useAutomationsStore(selectLibrary(scopeKeyOf(projectId)));
}
