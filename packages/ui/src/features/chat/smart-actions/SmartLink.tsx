/**
 * The `a` override: a file in the workspace editor, a footnote in its own
 * reply, a local server through the daemon's tunnel when it is remote, and a
 * web page for everything else.
 *
 * The file-reference branch runs unconditionally:
 * `parseFileHref` is the same classifier the markdown sanitiser already used
 * to let the href through, and `FileRefLink` only uses provider-less hooks,
 * so this dispatcher stays safe in every surface that renders markdown.
 *
 * A local server's address names the daemon's machine wherever it is written
 * (a reply, a prompt, a plan, a fetched page), so that branch needs only a
 * daemon to open it through: `useKnownDaemonPort()` is null on the surfaces
 * that render markdown without one.
 */
import type { AnchorHTMLAttributes, ReactElement } from 'react';
import { classifyLocalhostUrl, isTunnelEligiblePort } from '@qlan-ro/mainframe-types';
import { parseFileHref } from '@/lib/files/file-href';
import { useKnownDaemonPort } from '@/features/sessions/runtime/daemon-port-context';
import { useTunnelDaemonPort } from '@/store/port-tunnels';
import { FileRefLink } from '../parts/FileRefLink';
import { FootnoteLink } from '../links/FootnoteLink';
import { LocalServerLink } from '../links/LocalServerLink';
import { WebLink } from '../links/WebLink';

interface LocalhostLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  href: string;
  port: number;
  daemonPort: number;
}

function LocalhostLink({ href, port, daemonPort, ...props }: LocalhostLinkProps): ReactElement {
  // The daemon's own port comes from the daemon itself: a remote daemon is
  // reached through a portless tunnel URL, so the local fallback would offer a
  // tunnel the route then rejects.
  const seededDaemonPort = useTunnelDaemonPort();
  if (!isTunnelEligiblePort(port, seededDaemonPort ?? daemonPort)) return <WebLink href={href} {...props} />;
  return <LocalServerLink href={href} port={port} {...props} />;
}

export function SmartLink({ href, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>): ReactElement {
  const daemonPort = useKnownDaemonPort();
  if (!href) return <WebLink {...props} />;
  if (href.startsWith('#')) return <FootnoteLink href={href} {...props} />;

  const fileTarget = parseFileHref(href);
  if (fileTarget) return <FileRefLink href={href} fileTarget={fileTarget} {...props} />;

  const localhost = daemonPort === null ? null : classifyLocalhostUrl(href);
  return localhost && daemonPort !== null ? (
    <LocalhostLink href={href} port={localhost.port} daemonPort={daemonPort} {...props} />
  ) : (
    <WebLink href={href} {...props} />
  );
}
