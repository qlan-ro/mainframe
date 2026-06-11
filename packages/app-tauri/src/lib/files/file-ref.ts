/**
 * lib/files/file-ref.ts — canonical path-flavor normalizer.
 *
 * Why: chat tool-cards emit absolute worktree paths, the file tree emits
 * base-relative paths, and LSP go-to-def emits file:// URIs — all into the
 * same `open-file` surface intent. Without normalization the tabs store keys
 * on the raw mixed-flavor string, causing the same file to become two tabs and
 * two editor buffers (dirty-buffer desync — review finding F1).
 *
 * Port of the ROLE from packages/desktop/src/renderer/lib/file-location.ts.
 * NOT a verbatim copy: this module is pure, no React/aui coupling, and uses
 * the FileRef shape that the intent subscriber and the tab model need.
 */

// ── Types ────────────────────────────────────────────────────────────────────

/**
 * Canonical, normalized file reference.
 *
 * `relative` is the canonical key used for tabs + editor buffers:
 *   - base-relative when the path is inside a known base.
 *   - the absolute path itself when `isExternal` is true (round-trips cleanly
 *     through the Tauri/external-file fallback).
 */
export interface FileRef {
  /**
   * The canonical path string — base-relative for known paths, the absolute
   * path for external ones. Always uses forward-slash separators.
   */
  relative: string;
  /**
   * Absolute POSIX path, present whenever the input was absolute or a
   * file:// URI. Undefined for pure already-relative inputs (no base to
   * join against — callers that need to load an already-relative file always
   * have a base from context).
   */
  absolute?: string;
  /** True when the path lives outside every known base. */
  isExternal: boolean;
}

/**
 * The active workspace bases. Both are optional; the subscriber populates
 * whatever it has from the active thread's SessionCustom + project list.
 */
export interface FileBases {
  /** Absolute path to the active chat's worktree (from SessionCustom.worktreePath). */
  worktreePath?: string;
  /** Absolute path to the active project (from Project.path). */
  projectPath?: string;
}

// ── Implementation ────────────────────────────────────────────────────────────

/**
 * Normalize a raw path of any flavor into a canonical FileRef.
 *
 * Accepted inputs:
 *   - absolute POSIX path (`/Users/…/src/a.ts`) — strips the matching base
 *   - `file://` URI (`file:///Users/…/src/a.ts`) — decoded then relativized
 *   - already-relative (`src/a.ts`) — kept as-is (`./ ` prefix stripped)
 *   - external (absolute but outside all bases) — `isExternal: true`
 *
 * Worktree base takes precedence over project base: a worktree path is
 * resolved against the worktree first, even if the project root is a parent
 * of the worktree.
 */
export function toFileRef(rawPath: string, bases: FileBases): FileRef {
  const normalized = normalizeSeparators(rawPath);

  // file:// URI → decode to absolute then recurse.
  if (normalized.startsWith('file://')) {
    const decoded = decodeFileUri(normalized);
    return toFileRef(decoded, bases);
  }

  // Already-relative: strip leading ./ if present, keep as-is.
  if (!normalized.startsWith('/')) {
    const stripped = normalized.startsWith('./') ? normalized.slice(2) : normalized;
    return { relative: stripped, isExternal: false };
  }

  // Absolute path: try bases in precedence order (worktree first).
  const orderedBases: (string | undefined)[] = [bases.worktreePath, bases.projectPath];
  for (const base of orderedBases) {
    if (!base) continue;
    const rel = relativeUnder(base, normalized);
    if (rel !== null) {
      return { relative: rel, absolute: normalized, isExternal: false };
    }
  }

  // External: no base matched.
  return { relative: normalized, absolute: normalized, isExternal: true };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Replace backslashes with forward slashes (Windows paths or mixed paths). */
function normalizeSeparators(p: string): string {
  return p.replace(/\\/g, '/');
}

/**
 * Decode a `file://` URI to an absolute POSIX path.
 * Handles percent-encoded characters. Strips the `file://` prefix and
 * any authority component (empty or `localhost`).
 */
function decodeFileUri(uri: string): string {
  // Strip "file://" prefix; on POSIX the path starts immediately after.
  const withoutScheme = uri.slice('file://'.length);
  // Decoded via URL so percent-encoding is handled.
  try {
    const url = new URL(uri);
    return decodeURIComponent(url.pathname);
  } catch {
    // Fallback: manual strip — remove any authority (up to next slash).
    const slashIdx = withoutScheme.indexOf('/');
    const path = slashIdx >= 0 ? withoutScheme.slice(slashIdx) : withoutScheme;
    return decodeURIComponent(path);
  }
}

/**
 * Return `path` relative to `base` if it is contained, else null.
 * Handles trailing slashes on the base.
 */
function relativeUnder(base: string, path: string): string | null {
  const normBase = base.endsWith('/') ? base.slice(0, -1) : base;
  if (path === normBase) return '';
  const prefix = normBase + '/';
  if (path.startsWith(prefix)) return path.slice(prefix.length);
  return null;
}
