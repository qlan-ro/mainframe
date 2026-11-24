/**
 * The `a` override: a file in the workspace editor, a footnote in its own
 * reply, a local server through the daemon's tunnel when it is remote, and a
 * web page for everything else.
 *
 * The file-reference branch runs unconditionally (no smart-actions gate):
 * `parseFileHref` is the same classifier the markdown sanitiser already used
 * to let the href through, and `FileRefLink` only uses provider-less hooks,
 * so this dispatcher stays safe in the surfaces that render markdown outside
 * `SmartActionsProvider`.
 *
 * The local-server branch is split across two components on purpose:
 * `useDaemonPort()` throws outside its provider, and the non-chat surfaces
 * that share `markdownComponents` render links without one. Only a link that
 * already passed the smart-actions gate and the localhost check mounts the
 * hook-bearing half.
 */
import type { AnchorHTMLAttributes, ReactElement } from 'react';
import { classifyLocalhostUrl, isTunnelEligiblePort } from '@qlan-ro/mainframe-types';
import { parseFileHref } from '@/lib/files/file-href';
import { useDaemonPort } from '@/features/sessions/runtime/daemon-port-context';
import { useTunnelDaemonPort } from '@/store/port-tunnels';
import { FileRefLink } from '../parts/FileRefLink';
import { FootnoteLink } from '../links/FootnoteLink';
import { LocalServerLink } from '../links/LocalServerLink';
import { WebLink } from '../links/WebLink';
import { useSmartActionsEnabled } from './smart-actions-context';

interface LocalhostLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  href: string;
  port: number;
}

function LocalhostLink({ href, port, ...props }: LocalhostLinkProps): ReactElement {
  // The daemon's own port comes from the daemon itself: a remote daemon is
  // reached through a portless tunnel URL, so the local fallback would offer a
  // tunnel the route then rejects.
  const seededDaemonPort = useTunnelDaemonPort();
  const localDaemonPort = useDaemonPort();
  if (!isTunnelEligiblePort(port, seededDaemonPort ?? localDaemonPort)) return <WebLink href={href} {...props} />;
  return <LocalServerLink href={href} port={port} {...props} />;
}

export function SmartLink({ href, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>): ReactElement {
  const enabled = useSmartActionsEnabled();
  if (!href) return <WebLink {...props} />;
  if (href.startsWith('#')) return <FootnoteLink href={href} {...props} />;

  const fileTarget = parseFileHref(href);
  if (fileTarget) return <FileRefLink href={href} fileTarget={fileTarget} {...props} />;

  const localhost = enabled ? classifyLocalhostUrl(href) : null;
  return localhost ? (
    <LocalhostLink href={href} port={localhost.port} {...props} />
  ) : (
    <WebLink href={href} {...props} />
  );
}
