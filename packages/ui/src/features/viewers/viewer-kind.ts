/**
 * viewer-kind.ts — which viewer a file path opens in.
 *
 * Kept apart from viewer-router.tsx so callers that only need the kind (the
 * intent subscriber, which runs at boot) do not import the viewer components
 * and, through them, the CodeMirror bundle.
 */

// ── Viewer kind discriminant ─────────────────────────────────────────────────

export type ViewerKind = 'image' | 'svg' | 'csv' | 'pdf' | 'code';

/** Extensions that map to a binary image viewer. */
const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp']);

/** Extensions that map to a dedicated text/binary viewer. */
const VIEWER_EXT_MAP: Record<string, ViewerKind> = {
  svg: 'svg',
  csv: 'csv',
  pdf: 'pdf',
};

/**
 * Pick the viewer kind for a given file path.
 * Extension matching is case-insensitive.
 * Everything that does not match a viewer falls through to `"code"`.
 *
 * @pure — no side-effects, safe to call in tests and render functions.
 */
export function pickViewerKind(filePath: string): ViewerKind {
  const basename = filePath.split('/').pop() ?? filePath;
  const ext = basename.includes('.') ? basename.split('.').pop()?.toLowerCase() : undefined;
  if (!ext) return 'code';
  if (IMAGE_EXTS.has(ext)) return 'image';
  return VIEWER_EXT_MAP[ext] ?? 'code';
}
