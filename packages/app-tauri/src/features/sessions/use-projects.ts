/**
 * useProjects — loads the daemon's project list once, keyed off the runtime port.
 *
 * The single project source for the sessions feature: consumed by SessionSidebar
 * (filter pills + grouping) and NewThreadConfigPicker (project select). Reads the
 * port from DaemonPortContext so it works inside aui's runtime binder.
 */
import { useEffect, useState } from 'react';
import type { Project } from '@qlan-ro/mainframe-types';
import { getProjects } from '@/lib/api/projects';
import { useDaemonPort } from './runtime/daemon-port-context';

export interface UseProjectsResult {
  projects: Project[];
  loading: boolean;
}

export function useProjects(): UseProjectsResult {
  const port = useDaemonPort();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getProjects(port)
      .then((list) => {
        if (!cancelled) setProjects(list);
      })
      .catch((e: unknown) => {
        console.warn('[useProjects] getProjects failed', e);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [port]);

  return { projects, loading };
}
