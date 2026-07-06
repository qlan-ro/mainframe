/**
 * useRepoSuggestions — loads the repo-derived starting points for the Welcome
 * state. Empty/error tolerant by design: on null projectId, mid-load, or any
 * failure it returns `[]` so the "From the repo" section simply does not render.
 */
import { useEffect, useState } from 'react';
import type { Suggestion } from '@qlan-ro/mainframe-types';
import { getSuggestions } from '@/lib/api/suggestions';
import { useDaemonPort } from '../runtime/daemon-port-context';

export function useRepoSuggestions(projectId: string | null): { suggestions: Suggestion[] } {
  const port = useDaemonPort();
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);

  useEffect(() => {
    if (projectId == null) {
      setSuggestions([]);
      return;
    }
    let cancelled = false;
    getSuggestions(port, projectId)
      .then((list) => {
        if (!cancelled) setSuggestions(list);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setSuggestions([]);
          console.warn('[use-repo-suggestions] getSuggestions failed', err);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [port, projectId]);

  return { suggestions };
}
