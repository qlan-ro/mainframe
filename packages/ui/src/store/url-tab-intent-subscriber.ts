/**
 * store/url-tab-intent-subscriber.ts
 *
 * The sanctioned cross-store bridge for the `open-url-tab` surface intent
 * (#281). Mounted once in SurfaceHost alongside subscribeToTerminalIntents.
 * Both entry points — the workspace tab strip and the chat URL chip — funnel through
 * here; neither calls `addRunTab` itself, because features never import layout/.
 *
 * Unlike the terminal bridge this is fully synchronous: a URL tab owns nothing
 * until the tab exists, so a rejected add has nothing to dispose.
 */
import { normalizePreviewUrl } from '@/features/preview/normalize-url';
import { urlTabId, urlTabTitle } from '@/features/url-tab/url-tab-id';
import { onSurfaceIntent } from './surface-intents';
import { useActiveBasesStore } from './active-bases-store';
import { useLayoutStore } from './layout';

export function subscribeToUrlTabIntents(): () => void {
  return onSurfaceIntent((intent) => {
    if (intent.type !== 'open-url-tab') return;
    openUrlTab(intent.url, intent.paneId);
  });
}

function openUrlTab(raw: string, paneId: string | undefined): void {
  // Second guard: both entry points normalize before emitting, so a null here
  // means a caller skipped that step rather than a user typo.
  const url = normalizePreviewUrl(raw);
  if (!url) {
    console.warn('[url-tab-intent] ignoring an unusable URL', raw);
    return;
  }

  const { scopeKey } = useActiveBasesStore.getState();
  // addRunTab dedups a `url` tab by normalized url + scope and places Run in
  // the layout, so opening the same URL twice focuses the first tab.
  const added = useLayoutStore
    .getState()
    .addRunTab(
      { id: urlTabId(url), kind: 'url', title: urlTabTitle(url), url, scopeKey: scopeKey ?? undefined },
      paneId,
    );
  if (!added) console.warn('[url-tab-intent] target pane closed before the URL tab was added', url);
}
