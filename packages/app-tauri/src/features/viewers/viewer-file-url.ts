/**
 * viewer-file-url.ts
 *
 * Shared helper for building a valid file:// URL from a viewer's `path` prop.
 *
 * Problem: viewer `path` values are often project-relative (e.g. `src/spec.pdf`),
 * not absolute. Constructing `file://src/spec.pdf` interprets "src" as the
 * hostname and silently fails in `openExternal`.
 *
 * Resolution rules:
 *  - Absolute path (starts with '/'): use as-is.
 *  - Relative path + projectPath available: join `projectPath + '/' + path`.
 *  - Relative path + no projectPath: return null (caller must disable the action).
 */

/**
 * Returns an absolute `file://` URL string, or `null` if the path is relative
 * and `projectPath` is unavailable (caller should disable the open-external action).
 */
export function toFileUrl(path: string, projectPath: string | undefined): string | null {
  const absPath = path.startsWith('/') ? path : projectPath ? `${projectPath}/${path}` : null;
  if (absPath === null) return null;
  return `file://${absPath}`;
}
