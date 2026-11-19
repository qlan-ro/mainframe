import { Button } from '@/components/ui/button';
import { useDaemonIsLocal } from '@/lib/daemon/use-daemon-is-local';
import { ClientForm } from './ClientForm';
import { ClientKey } from './ClientKey';
import { ClientList } from './ClientList';
import { useExternalClients } from './use-external-clients';

export function ExternalClientsPane({ port }: { port: number }) {
  const local = useDaemonIsLocal();
  if (!local)
    return <p className="text-sm text-muted-foreground">Manage external clients in Mainframe on the host Mac.</p>;
  return <LocalClients key={port} port={port} />;
}

function LocalClients({ port }: { port: number }) {
  const state = useExternalClients(port);
  return (
    <div className="flex min-w-0 flex-col gap-5" data-testid="settings-pane-external-clients">
      <header className="grid gap-2">
        <p className="text-sm text-muted-foreground">
          Connect local tools such as Codex to selected Mainframe projects. Access works only on this Mac.
        </p>
      </header>
      {state.error && (
        <div role="alert" className="grid gap-2 text-sm text-destructive">
          <p>{state.error}</p>
          <Button variant="outline" className="justify-self-start" onClick={state.retry} disabled={state.busy}>
            Retry
          </Button>
        </div>
      )}
      {!state.data && !state.error && (
        <p role="status" className="text-sm text-muted-foreground">
          Loading clients…
        </p>
      )}
      {state.data && (
        <>
          {state.created ? (
            <ClientKey created={state.created} endpoint={state.data.endpoint} onDone={state.dismissKey} />
          ) : (
            <ClientForm projects={state.projects} busy={state.busy} onCreate={state.create} />
          )}
          <ClientList
            clients={state.data.clients}
            projects={state.projects}
            busy={state.busy}
            onRevoke={state.revoke}
          />
        </>
      )}
    </div>
  );
}
