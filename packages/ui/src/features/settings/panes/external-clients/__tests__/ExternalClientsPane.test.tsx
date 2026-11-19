import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ExternalClientsPane } from '../ExternalClientsPane';
import { createExternalMcpClient, getExternalMcpClients, revokeExternalMcpClient } from '@/lib/api/external-mcp';
import { getProjects } from '@/lib/api/projects';

vi.mock('@/lib/daemon/use-daemon-is-local', () => ({ useDaemonIsLocal: () => true }));
vi.mock('@/lib/api/external-mcp');
vi.mock('@/lib/api/projects');

const client = {
  id: 'client-one',
  name: 'Voice',
  projectIds: ['project-one'],
  access: 'read' as const,
  maxPermissionMode: 'default' as const,
  createdAt: '2026-11-19T12:00:00Z',
  lastUsedAt: null,
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getProjects).mockResolvedValue([
    { id: 'project-one', name: 'Demo', path: '/tmp/demo', createdAt: '', lastOpenedAt: '' },
  ]);
  vi.mocked(getExternalMcpClients).mockResolvedValue({ clients: [], endpoint: 'http://127.0.0.1:32084/mcp/external' });
  vi.mocked(createExternalMcpClient).mockResolvedValue({ client, token: 'test-only-key' });
  vi.mocked(revokeExternalMcpClient).mockResolvedValue(undefined);
});

it('requires a name and project, defaults to read-only, then dismisses the one-time key', async () => {
  render(<ExternalClientsPane port={32084} />);
  const add = await screen.findByRole('button', { name: 'Add client' });
  expect(add).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Client name'), { target: { value: 'Voice' } });
  expect(add).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Demo' }));
  fireEvent.click(add);
  expect(await screen.findByLabelText('Client key')).toHaveAttribute('type', 'password');
  expect(createExternalMcpClient).toHaveBeenCalledWith(32084, {
    name: 'Voice',
    projectIds: ['project-one'],
    access: 'read',
    maxPermissionMode: 'default',
  });
  fireEvent.click(screen.getByRole('button', { name: 'Done' }));
  expect(screen.queryByLabelText('Client key')).not.toBeInTheDocument();
  expect(screen.getByTestId('external-clients-row-client-one')).toHaveTextContent('Read only');
});

it('revokes the selected client only after confirming', async () => {
  vi.mocked(getExternalMcpClients).mockResolvedValue({
    clients: [client],
    endpoint: 'http://127.0.0.1:32084/mcp/external',
  });
  render(<ExternalClientsPane port={32084} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Revoke' }));
  expect(revokeExternalMcpClient).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Revoke access' }));
  await waitFor(() => expect(screen.queryByTestId('external-clients-row-client-one')).not.toBeInTheDocument());
  expect(revokeExternalMcpClient).toHaveBeenCalledWith(32084, 'client-one');
});

it('offers retry after a load failure', async () => {
  vi.mocked(getExternalMcpClients).mockRejectedValueOnce(new Error('unavailable'));
  render(<ExternalClientsPane port={32084} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not load clients');
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByRole('button', { name: 'Add client' })).toBeDisabled();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
