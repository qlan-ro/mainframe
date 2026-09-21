'use client';

/**
 * The `a` override: a file reference for a link whose target is a file path,
 * a tunnel chip for eligible localhost URLs, and the unchanged
 * `LinkWithPreview` for everything else.
 *
 * The file-reference branch runs unconditionally (no smart-actions gate) —
 * `parseFileHref` is the same classifier the markdown sanitiser already used
 * to let the href through, and `FileRefLink` only uses provider-less hooks,
 * so this dispatcher stays safe in the four surfaces that render markdown
 * outside `SmartActionsProvider`.
 *
 * Localhost eligibility is split across two components on purpose —
 * `useDaemonPort()` throws outside its provider, and the non-chat surfaces
 * that share `markdownComponents` render links without one. Only a link that
 * already passed the smart-actions gate and the localhost check mounts the
 * hook-bearing half.
 */
import type { AnchorHTMLAttributes, ReactElement } from 'react';
import { classifyLocalhostUrl, isTunnelEligiblePort } from '@qlan-ro/mainframe-types';
import { LinkWithPreview } from '../parts/link-with-preview';
import { FileRefLink } from '../parts/FileRefLink';
import { parseFileHref } from '@/lib/files/file-href';
import { useDaemonPort } from '@/features/sessions/runtime/daemon-port-context';
import { useTunnelDaemonPort } from '@/store/port-tunnels';
import { useSmartActionsEnabled } from './smart-actions-context';
import { UrlChip } from './UrlChip';

interface LocalhostLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  href: string;
  port: number;
}

function LocalhostLink({ href, port, ...props }: LocalhostLinkProps): ReactElement {
  // The daemon's own port comes from the daemon itself: a remote daemon is
  // reached through a portless tunnel URL, so the local fallback would chip a
  // link the route then rejects.
  const seededDaemonPort = useTunnelDaemonPort();
  const localDaemonPort = useDaemonPort();

  if (!isTunnelEligiblePort(port, seededDaemonPort ?? localDaemonPort)) {
    return <LinkWithPreview href={href} {...props} />;
  }
  return <UrlChip href={href} port={port} />;
}

export function SmartLink({ href, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>): ReactElement {
  // Called unconditionally before any branch returns — hooks must run in the
  // same order every render even though only the localhost branch below
  // needs the result.
  const enabled = useSmartActionsEnabled();

  const fileTarget = href ? parseFileHref(href) : null;
  if (fileTarget) return <FileRefLink href={href!} fileTarget={fileTarget} {...props} />;

  const localhost = enabled && href ? classifyLocalhostUrl(href) : null;

  if (!localhost || !href) return <LinkWithPreview href={href} {...props} />;
  return <LocalhostLink href={href} port={localhost.port} {...props} />;
}
