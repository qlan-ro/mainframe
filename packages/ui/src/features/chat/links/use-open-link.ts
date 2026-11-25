/**
 * Opens a URL where Settings › General › "Open links in" says (T1d): a URL tab
 * in the workspace, or the system's default browser. An artifact opens in the
 * workspace as the artifact it is.
 */
import { useCallback, useMemo } from 'react';
import { isArtifactUrl } from '@/features/artifacts/artifact-url';
import { useOpenArtifact } from '@/features/artifacts/use-open-artifact';
import { useHost } from '@/lib/host';
import { useUiPrefs, type LinkTarget } from '@/store/ui-prefs';
import { httpLinkHref, openInMainframe } from '../parts/link-menu-actions';

export interface OpenLink {
  open: (href: string) => void;
  openIn: (href: string, target: LinkTarget) => void;
}

export function useOpenExternal(): (href: string) => void {
  const host = useHost();
  return useCallback(
    (href: string) => {
      host.shell.openExternal(href).catch(() => {
        const url = URL.canParse(href) ? new URL(href) : undefined;
        console.warn('[links] openExternal failed', url?.protocol, url?.host);
      });
    },
    [host],
  );
}

export function useOpenLink(): OpenLink {
  const target = useUiPrefs((state) => state.openLinksIn);
  const openExternal = useOpenExternal();
  const { open: openArtifact } = useOpenArtifact();
  return useMemo(() => {
    const openIn = (href: string, where: LinkTarget) => {
      // The workspace browser takes web pages only; a mailto: or an app scheme belongs to the system.
      if (where === 'browser' || !httpLinkHref(href)) openExternal(href);
      else if (isArtifactUrl(href)) void openArtifact(href);
      else openInMainframe(href);
    };
    return { open: (href) => openIn(href, target), openIn };
  }, [target, openExternal, openArtifact]);
}
