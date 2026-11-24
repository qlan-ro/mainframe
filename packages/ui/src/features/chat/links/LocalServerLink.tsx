/**
 * A link to a local server. It looks and opens like any other; on a remote
 * daemon the address names the daemon's machine, so the browser is sent to the
 * daemon's tunnel for that port (a workspace URL tab opens its own). The link
 * text stays as written; the tooltip and the menu say where it really goes. On
 * a local daemon the word "tunnel" appears nowhere.
 */
import type { AnchorHTMLAttributes, ReactElement } from 'react';
import { Unplug } from 'lucide-react';
import {
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
} from '@/components/ui/context-menu';
import { useUiPrefs, type LinkTarget } from '@/store/ui-prefs';
import type { PortTunnelEntry } from '@/store/port-tunnels';
import { useUrlTunnel, type UrlTunnelController } from '../smart-actions/use-url-tunnel';
import { LinkAnchor } from './LinkAnchor';
import { useOpenLink } from './use-open-link';

function stateLabel(entry: PortTunnelEntry | undefined, busy: boolean): string {
  if (busy) return 'Opening tunnel…';
  if (entry?.state === 'ready') return 'Tunnel open';
  return entry?.state === 'error' ? 'Tunnel failed' : 'Opens through a tunnel';
}

function TunnelMenu({ port, tunnel }: { port: number; tunnel: UrlTunnelController }) {
  const { entry, busy, stop } = tunnel;
  // An errored entry is a failure marker, not a live tunnel: nothing is left to stop.
  const canStop = entry?.state === 'starting' || entry?.state === 'ready';
  return (
    <>
      <ContextMenuSeparator />
      <ContextMenuGroup>
        <ContextMenuLabel data-testid={`chat-link-tunnel-state-${port}`}>{stateLabel(entry, busy)}</ContextMenuLabel>
        {canStop && (
          <ContextMenuItem data-testid={`chat-link-tunnel-stop-${port}`} onSelect={stop}>
            <Unplug />
            Stop tunnel
          </ContextMenuItem>
        )}
      </ContextMenuGroup>
      <ContextMenuSeparator />
    </>
  );
}

interface LocalServerLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  href: string;
  port: number;
}

export function LocalServerLink({ href, port, ...props }: LocalServerLinkProps): ReactElement {
  const target = useUiPrefs((state) => state.openLinksIn);
  const { openIn } = useOpenLink();
  const tunnel = useUrlTunnel(href, port);
  const go = (where: LinkTarget) => {
    if (where === 'browser' && tunnel.busy) return;
    if (where === 'browser') tunnel.open();
    else openIn(href, 'workspace');
  };
  return (
    <LinkAnchor
      {...props}
      href={href}
      data-smart-action-port={port}
      aria-busy={tunnel.busy || undefined}
      onOpen={() => go(target)}
      onOpenIn={(key) => go(key === 'open-browser' ? 'browser' : 'workspace')}
      note={tunnel.isLocal ? undefined : 'Opens through a tunnel to the daemon’s machine'}
      menu={tunnel.isLocal ? undefined : <TunnelMenu port={port} tunnel={tunnel} />}
    />
  );
}
