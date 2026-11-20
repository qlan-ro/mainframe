import { useEffect, useRef, useState, type Dispatch, type SetStateAction, type RefObject } from 'react';
import type {
  CreateExternalMcpClient,
  CreatedExternalMcpClient,
  ExternalMcpClients,
  Project,
} from '@qlan-ro/mainframe-types';
import { createExternalMcpClient, getExternalMcpClients, revokeExternalMcpClient } from '@/lib/api/external-mcp';
import { getProjects } from '@/lib/api/projects';

interface State {
  data: ExternalMcpClients | null;
  projects: Project[];
  created: CreatedExternalMcpClient | null;
  error: string | null;
  busy: boolean;
}

export function useExternalClients(port: number) {
  const [state, setState] = useState<State>({ data: null, projects: [], created: null, error: null, busy: true });
  const [revision, setRevision] = useState(0);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    let active = true;
    Promise.all([getExternalMcpClients(port), getProjects(port)])
      .then(([data, projects]) => {
        if (active) setState((s) => ({ ...s, data, projects, error: null, busy: false }));
      })
      .catch(() => {
        if (active) setState((s) => ({ ...s, error: 'Could not load clients. Try again.', busy: false }));
      });
    return () => {
      active = false;
    };
  }, [port, revision]);
  const actions = useClientActions(port, setState, alive);
  return {
    ...state,
    ...actions,
    dismissKey: () => setState((s) => ({ ...s, created: null })),
    retry: () => {
      setState((s) => ({ ...s, busy: true }));
      setRevision((r) => r + 1);
    },
  };
}

function useClientActions(port: number, setState: Dispatch<SetStateAction<State>>, alive: RefObject<boolean>) {
  async function run(action: () => Promise<void>, error: string) {
    setState((s) => ({ ...s, busy: true, error: null }));
    try {
      await action();
    } catch {
      if (alive.current) setState((s) => ({ ...s, error }));
    } finally {
      if (alive.current) setState((s) => ({ ...s, busy: false }));
    }
  }
  const create = (input: CreateExternalMcpClient) =>
    run(async () => {
      const created = await createExternalMcpClient(port, input);
      if (alive.current)
        setState((s) => ({
          ...s,
          created,
          data: s.data && { ...s.data, clients: [created.client, ...s.data.clients] },
        }));
    }, 'Could not add the client. Check the client list before retrying.');
  const revoke = (id: string) =>
    run(async () => {
      await revokeExternalMcpClient(port, id);
      if (alive.current)
        setState((s) => ({
          ...s,
          created: s.created?.client.id === id ? null : s.created,
          data: s.data && { ...s.data, clients: s.data.clients.filter((c) => c.id !== id) },
        }));
    }, 'Could not revoke access. Try again.');
  return { create, revoke };
}
