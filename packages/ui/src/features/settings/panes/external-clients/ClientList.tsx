import { useState } from 'react';
import type { ExternalMcpClient, Project } from '@qlan-ro/mainframe-types';
import { Button } from '@/components/ui/button';
import { modeLabel } from './ClientForm';

interface Props {
  clients: ExternalMcpClient[];
  projects: Project[];
  busy: boolean;
  onRevoke: (id: string) => Promise<void>;
}

export function ClientList({ clients, projects, busy, onRevoke }: Props) {
  return (
    <section className="grid min-w-0 gap-3 border-t border-border pt-5">
      <h2 className="text-sm font-semibold">Connected clients</h2>
      {!clients.length && <p className="text-sm text-muted-foreground">No clients have access yet.</p>}
      <ul className="divide-y divide-border">
        {clients.map((client) => (
          <ClientRow key={client.id} client={client} projects={projects} busy={busy} onRevoke={onRevoke} />
        ))}
      </ul>
    </section>
  );
}

function ClientRow({ client, projects, busy, onRevoke }: Omit<Props, 'clients'> & { client: ExternalMcpClient }) {
  const [confirm, setConfirm] = useState(false);
  const projectNames = client.projectIds
    .map((id) => projects.find((p) => p.id === id)?.name ?? 'Removed project')
    .join(', ');
  return (
    <li
      className="flex min-w-0 flex-wrap items-start justify-between gap-3 py-3"
      data-testid={`external-clients-row-${client.id}`}
    >
      <div className="min-w-0 flex-1">
        <p className="break-words text-sm font-medium">{client.name}</p>
        <p className="text-sm text-muted-foreground">
          {client.access === 'read' ? 'Read only' : `Control up to ${modeLabel(client.maxPermissionMode)}`}
        </p>
        <p className="break-words text-sm text-muted-foreground">{projectNames}</p>
        <p className="text-xs text-muted-foreground">
          {client.lastUsedAt ? `Last used ${new Date(client.lastUsedAt).toLocaleString()}` : 'Not used yet'}
        </p>
      </div>
      {confirm ? (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="destructive"
            disabled={busy}
            onClick={() => void onRevoke(client.id)}
            data-testid={`external-clients-confirm-${client.id}`}
          >
            Revoke access
          </Button>
          <Button variant="ghost" disabled={busy} onClick={() => setConfirm(false)}>
            Cancel
          </Button>
        </div>
      ) : (
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => setConfirm(true)}
          data-testid={`external-clients-revoke-${client.id}`}
        >
          Revoke
        </Button>
      )}
    </li>
  );
}
