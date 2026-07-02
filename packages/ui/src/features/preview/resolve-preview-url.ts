/**
 * resolvePreviewUrl — pure locality resolution for the preview webview URL.
 *
 * Local daemon: always `http://localhost:${port}` (or null with no port) —
 * byte-for-byte unchanged from pre-tunnel behavior.
 *
 * Remote daemon: reads the tunnel URL/error keyed by `(scopeKey, config)`,
 * scanning all scopes for the config name when `scopeKey` is absent — the
 * same fallback PreviewInstance already uses for `status`.
 */
export interface ResolvedPreviewUrl {
  resolvedUrl: string | null;
  tunnelError: string | null;
}

function readScoped(
  table: Record<string, Record<string, string>>,
  scopeKey: string | undefined,
  config: string,
): string | null {
  if (scopeKey) {
    return table[scopeKey]?.[config] ?? null;
  }
  for (const scoped of Object.values(table)) {
    if (config in scoped) return scoped[config] ?? null;
  }
  return null;
}

export function resolvePreviewUrl(
  isLocal: boolean,
  port: number | null,
  config: string | undefined,
  scopeKey: string | undefined,
  tunnelUrls: Record<string, Record<string, string>>,
  tunnelErrors: Record<string, Record<string, string>>,
): ResolvedPreviewUrl {
  if (isLocal) {
    return { resolvedUrl: port != null ? `http://localhost:${port}` : null, tunnelError: null };
  }
  if (!config) {
    return { resolvedUrl: null, tunnelError: null };
  }
  return {
    resolvedUrl: readScoped(tunnelUrls, scopeKey, config),
    tunnelError: readScoped(tunnelErrors, scopeKey, config),
  };
}
