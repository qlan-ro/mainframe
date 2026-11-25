// @vitest-environment jsdom

/** A list the daemon never answered is asked for again when its socket connects. */
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';

const { ws, getProjects } = vi.hoisted(() => ({
  getProjects: vi.fn(),
  ws: {
    connected: false,
    listeners: new Set<() => void>(),
    subscribeConnection(listener: () => void) {
      ws.listeners.add(listener);
      return () => ws.listeners.delete(listener);
    },
  },
}));
vi.mock('@/lib/daemon/ws-client', () => ({ daemonWs: ws }));
vi.mock('@/lib/api/projects', () => ({ getProjects }));

import { resetProjectsStore } from '@/store/projects';
import { DaemonPortProvider } from '../runtime/daemon-port-context';
import { useProjects } from '../use-projects';

const wrapper = ({ children }: { children: ReactNode }) => <DaemonPortProvider port={1}>{children}</DaemonPortProvider>;

function setConnected(connected: boolean) {
  act(() => {
    ws.connected = connected;
    for (const listener of [...ws.listeners]) listener();
  });
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  ws.connected = false;
  ws.listeners.clear();
  getProjects.mockReset();
  resetProjectsStore();
});

it('asks again on connect after a failed first request, and no more once answered', async () => {
  getProjects.mockRejectedValueOnce(new Error('daemon down'));
  const { result } = renderHook(() => useProjects(), { wrapper });
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.listed).toBe(false);

  getProjects.mockResolvedValue([{ id: 'p1', name: 'atlas-web' }]);
  setConnected(false);
  expect(getProjects).toHaveBeenCalledTimes(1);
  setConnected(true);
  await waitFor(() => expect(result.current.projects).toHaveLength(1));

  setConnected(false);
  setConnected(true);
  expect(getProjects).toHaveBeenCalledTimes(2);
});
