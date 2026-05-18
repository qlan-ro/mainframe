import { app } from 'electron';
import { createMainLogger } from './logger.js';

const log = createMainLogger('electron:sandbox');

type PermissionHandler = (_wc: Electron.WebContents, permission: string, callback: (granted: boolean) => void) => void;

type OpenExternalFn = (url: string) => void;

/**
 * Sets up per-webview sandbox isolation: per-partition permission handlers,
 * Electron user-agent stripping, and sec-ch-ua hint cleaning so OAuth/SSO
 * providers with Conditional Access policies see a standard Chrome browser.
 */
export function setupWebviewSandbox(
  denyUnneededPermissions: PermissionHandler,
  openExternalSafe: OpenExternalFn,
): void {
  const configuredPartitions = new Set<string>();

  app.on('web-contents-created', (_event, contents) => {
    if (contents.getType() !== 'webview') return;

    // Each project gets its own persist:sandbox-{id} partition.
    // Apply permission restrictions on first encounter.
    const partitionId = contents.session.storagePath ?? '';
    if (!configuredPartitions.has(partitionId)) {
      configuredPartitions.add(partitionId);
      contents.session.setPermissionRequestHandler(denyUnneededPermissions);
      // Strip Electron markers from user-agent and client hints so OAuth/SSO
      // providers with Conditional Access policies (e.g. Microsoft Entra ID)
      // see a standard Chrome browser instead of rejecting the webview.
      contents.session.setUserAgent(contents.session.getUserAgent().replace(/Electron\/\S+ /, ''));
      contents.session.webRequest.onBeforeSendHeaders((details, callback) => {
        const headers = { ...details.requestHeaders };
        for (const key of Object.keys(headers)) {
          if (key.toLowerCase() === 'sec-ch-ua') {
            headers[key] = headers[key]!.replace(/, ?"Electron";v="[^"]*"/g, '');
          }
        }
        callback({ requestHeaders: headers });
      });
    }

    // Allow all navigations inside webviews — the sandbox loads user dev servers
    // that legitimately redirect cross-origin (OAuth flows, SSO, etc.).
    // Only intercept window.open for truly external links (target="_blank").
    contents.setWindowOpenHandler((details) => {
      openExternalSafe(details.url);
      return { action: 'deny' };
    });

    log.info({ partitionId }, 'webview sandbox configured');
  });
}
