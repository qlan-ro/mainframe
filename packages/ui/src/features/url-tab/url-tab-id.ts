/**
 * urlTabId / urlTabTitle — pure identity helpers for a `url` workspace tab (#281).
 *
 * The id doubles as the child webview's label, so it must stay inside Tauri's
 * label charset — the URL itself must never leak into it.
 */

const DEFAULT_PORTS: Record<string, string> = { 'http:': '80', 'https:': '443' };

/** A fresh id for a `url` tab — unique per call so two tabs on the same URL never collide. */
export function urlTabId(url: string): string {
  const uuid = crypto.randomUUID().slice(0, 8);
  try {
    const host = new URL(url).host.replace(/[^A-Za-z0-9_-]/g, '_');
    return `url-${host}-${uuid}`;
  } catch {
    /* expected: defensive only — callers normalize the URL before creating a tab */
    return `url-${uuid}`;
  }
}

/** The tab-strip label: the host, plus `:port` when the port isn't the scheme default. */
export function urlTabTitle(url: string): string {
  try {
    const parsed = new URL(url);
    const isDefaultPort = parsed.port === '' || parsed.port === DEFAULT_PORTS[parsed.protocol];
    return isDefaultPort ? parsed.hostname : `${parsed.hostname}:${parsed.port}`;
  } catch {
    /* expected: defensive only — callers normalize the URL before creating a tab */
    return url;
  }
}
