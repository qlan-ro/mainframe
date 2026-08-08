'use client';

/**
 * The #279 chip: a localhost URL as real selectable text, its tunnel state, and
 * the open (+ stop) actions.
 *
 * On a local daemon the chip is a plain opener and the word "tunnel" appears
 * nowhere — same port, different machine, different meaning.
 */
import { AppWindow, ExternalLink, Globe, Unplug } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { emitSurfaceIntent } from '@/store/surface-intents';
import { useUrlTunnel } from './use-url-tunnel';
import type { PortTunnelEntry } from '@/store/port-tunnels';

const CHIP_CLASS =
  'inline-flex items-center gap-1 rounded-md border border-border bg-muted/60 pl-1.5 pr-1 py-0.5 align-baseline';
const ICON_BUTTON_CLASS = 'rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground';
const BADGE_CLASS = 'rounded px-1 text-xs';

interface BadgeSpec {
  label: string;
  className: string;
}

// `busy` leads the store: the entry only exists once the daemon's first event
// lands, and the badge has to answer the click before that round trip.
function badgeFor(entry: PortTunnelEntry | undefined, busy: boolean): BadgeSpec | null {
  if (busy) return { label: 'tunnelling…', className: 'bg-muted text-muted-foreground' };
  switch (entry?.state) {
    case 'ready':
      return { label: 'tunnelled', className: 'bg-success/10 text-success' };
    case 'error':
      return { label: 'tunnel failed', className: 'bg-destructive/10 text-destructive' };
    default:
      return null;
  }
}

interface UrlChipProps {
  href: string;
  port: number;
}

export function UrlChip({ href, port }: UrlChipProps) {
  const { isLocal, entry, busy, open, stop } = useUrlTunnel(href, port);

  const badge = isLocal ? null : badgeFor(entry, busy);
  const openLabel = isLocal ? 'Open' : entry?.state === 'ready' ? 'Reopen tunnel URL' : 'Tunnel and open';
  const OpenIcon = isLocal ? ExternalLink : Globe;
  // An errored entry is a failure marker, not a live tunnel — there is nothing
  // left to stop, and the spec has the control disappear once the tunnel is down.
  const canStop = !isLocal && (entry?.state === 'starting' || entry?.state === 'ready');

  return (
    <span className={CHIP_CLASS} data-smart-action-port={port}>
      <span className="font-mono text-xs text-primary">{href}</span>
      {badge && <span className={`${BADGE_CLASS} ${badge.className}`}>{badge.label}</span>}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            data-testid="smart-action-url-open"
            title={openLabel}
            aria-label={openLabel}
            disabled={busy}
            className={ICON_BUTTON_CLASS}
          >
            <OpenIcon className="size-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {/* The tab owns tunnelling — this path must not start one. */}
          <DropdownMenuItem
            data-testid="smart-action-url-open-in-app"
            onSelect={() => emitSurfaceIntent({ type: 'open-url-tab', url: href })}
          >
            <AppWindow />
            Open in Mainframe
          </DropdownMenuItem>
          <DropdownMenuItem data-testid="smart-action-url-open-browser" onSelect={open}>
            <ExternalLink />
            Open in browser
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {canStop && (
        <button
          type="button"
          data-testid="smart-action-url-stop-tunnel"
          title="Stop tunnel"
          aria-label="Stop tunnel"
          className={ICON_BUTTON_CLASS}
          onClick={stop}
        >
          <Unplug className="size-3.5" />
        </button>
      )}
    </span>
  );
}
