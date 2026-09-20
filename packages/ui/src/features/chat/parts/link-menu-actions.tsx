/**
 * Shared row-set source for every http(s) link's menu (todo #341): the
 * localhost tunnel chip (`UrlChip`, a dropdown) and the plain preview link
 * (`LinkWithPreview`, a context menu) both render the same in-app / browser
 * rows from here, in the same order, so the two menus can't drift apart.
 *
 * "Copy link" is not described here — `CopyMenuItem` owns its own
 * status-driven icon and label, and both renderers already share it directly.
 */
import { useCallback, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { AppWindow, ExternalLink } from 'lucide-react';
import { emitSurfaceIntent } from '@/store/surface-intents';
import { writeToClipboard } from '@/lib/editor/copy-reference';

export type LinkMenuRowKey = 'open-in-app' | 'open-browser';

export interface LinkMenuRowSpec {
  key: LinkMenuRowKey;
  label: string;
  icon: LucideIcon;
}

/** Row order for every http(s) link menu: in-app open, then browser open. */
export const LINK_MENU_ROWS: readonly LinkMenuRowSpec[] = [
  { key: 'open-in-app', label: 'Open in Mainframe', icon: AppWindow },
  { key: 'open-browser', label: 'Open in browser', icon: ExternalLink },
];

/**
 * The in-app row's gate: `href` qualifies only if it already carries an
 * `http:`/`https:` scheme. Deliberately not `normalizePreviewUrl` — that
 * helper injects `http://` into scheme-less input for the workspace address
 * bar, so it would accept a relative link or `mailto:` and the row would
 * render but do nothing useful. `new URL` with no injection throws on a
 * relative href and rejects everything but http(s) on an absolute one.
 */
export function httpLinkHref(href: string | undefined): string | null {
  if (!href) return null;
  try {
    const url = new URL(href);
    return url.protocol === 'http:' || url.protocol === 'https:' ? href : null;
  } catch {
    return null;
  }
}

/** Opens `href` as a workspace URL tab. Never starts a port tunnel. */
export function openInMainframe(href: string): void {
  emitSurfaceIntent({ type: 'open-url-tab', url: href });
}

/**
 * Writes `href` to clipboard and briefly shows "Copied" feedback. Resolves
 * with whether the write actually landed, so menu callers can say "Copy
 * failed" instead of confirming a copy that never happened.
 */
export function useCopyHref(href: string | undefined) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(
    async (e?: React.MouseEvent): Promise<boolean> => {
      e?.preventDefault();
      e?.stopPropagation();
      if (!href) return false;
      const ok = await writeToClipboard(href);
      if (ok) {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }
      return ok;
    },
    [href],
  );
  return { copied, copy };
}
