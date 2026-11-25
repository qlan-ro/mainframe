/**
 * useProjects — a thin selector over the shared `store/projects.ts` store.
 *
 * The single project source for the sessions feature: consumed by SessionSidebar
 * (filter pills + grouping) and the new-session picker / welcome flow (project
 * select). Every call site reads the SAME list, so a reload issued from one
 * mounted consumer (e.g. the first-run "Add project" CTA) is visible to every
 * other one without a remount. Reads the port from DaemonPortContext so it
 * works inside aui's runtime binder.
 */
import { useEffect } from 'react';
import type { Project } from '@qlan-ro/mainframe-types';
import {
  useProjectsStore,
  reloadProjects as reloadProjectsAction,
  removeProjectFromList as removeProjectFromListAction,
} from '@/store/projects';
import { daemonWs } from '@/lib/daemon/ws-client';
import { useDaemonPort } from './runtime/daemon-port-context';

export interface UseProjectsResult {
  projects: Project[];
  loading: boolean;
  /** The daemon has answered once; without it an empty list may be a failed request. */
  listed: boolean;
  reloadProjects: () => Promise<void>;
  removeProjectFromList: (projectId: string) => void;
}

export function useProjects(): UseProjectsResult {
  const port = useDaemonPort();
  const projects = useProjectsStore((s) => s.projects);
  const loading = useProjectsStore((s) => s.loading);
  const listed = useProjectsStore((s) => s.listed);

  useEffect(() => {
    void reloadProjectsAction(port);
  }, [port]);

  useEffect(() => {
    if (listed) return;
    return daemonWs.subscribeConnection(() => {
      if (daemonWs.connected) void reloadProjectsAction(port);
    });
  }, [port, listed]);

  return {
    projects,
    loading,
    listed,
    reloadProjects: () => reloadProjectsAction(port),
    removeProjectFromList: removeProjectFromListAction,
  };
}
