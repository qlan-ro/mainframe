import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

/**
 * True when `realTarget` is `realBase` itself or lies strictly beneath it.
 * The separator guard is security-critical: a bare `startsWith(realBase)` would
 * admit a sibling like `/proj-evil` for base `/proj`. A filesystem root already
 * ends in the separator, so we must not append a second one (`'//'`).
 */
export function isWithinBase(realBase: string, realTarget: string): boolean {
  if (realTarget === realBase) return true;
  const prefix = realBase.endsWith(path.sep) ? realBase : realBase + path.sep;
  return realTarget.startsWith(prefix);
}

/**
 * Resolves `requestedPath` relative to `basePath` and confirms it is contained
 * within `basePath` (realpath + containment check).  Returns the resolved
 * absolute path or `null` if the path escapes the base or does not exist.
 *
 * **Wire flavour:** effective-base-relative.  `basePath` is the value returned
 * by `getEffectivePath` — either the chat's live worktree directory or the
 * project root.  Callers MUST obtain `basePath` from `getEffectivePath` before
 * calling this function; never pass a raw user-supplied string as `basePath`.
 *
 * Consumer responsibilities:
 * - Call `getEffectivePath` first to resolve the base.
 * - Pass only paths that are relative to (or absolute within) that base.
 * - Treat a `null` return as "forbidden" (403) — never fall back to an
 *   unvalidated path.
 */
export function resolveAndValidatePath(basePath: string, requestedPath: string): string | null {
  try {
    const realBase = realpathSync(basePath);
    const fullPath = realpathSync(path.resolve(basePath, requestedPath));
    return isWithinBase(realBase, fullPath) ? fullPath : null;
  } catch {
    /* expected: path does not exist or resolves outside the allowed base */
    return null;
  }
}

/**
 * Allow reading files under ~/.claude/ (plans, skills, etc.)
 * when the path resolves outside the project directory.
 */
export function resolveClaudeConfigPath(basePath: string, requestedPath: string): string | null {
  try {
    const claudeDir = realpathSync(path.join(homedir(), '.claude'));
    const fullPath = realpathSync(path.resolve(basePath, requestedPath));
    return isWithinBase(claudeDir, fullPath) ? fullPath : null;
  } catch {
    /* expected: path does not exist or resolves outside the allowed base */
    return null;
  }
}

/**
 * Resolve a requested path for reading: validated inside the project base, or —
 * as a fallback — under `~/.claude/` (plans, skills, etc.).  Returns the
 * validated absolute path or `null`.
 *
 * **Wire flavour:** effective-base-relative (same as `resolveAndValidatePath`).
 * `GET /files` uses this helper to support an absolute-under-base path as a
 * compatibility affordance.  `/filesystem/browse` and `/files/external` are the
 * only endpoints that intentionally accept paths outside the project base.
 *
 * Centralises the dual-resolution so every read route applies identical
 * path-traversal checks.
 */
export function resolveReadablePath(basePath: string, requestedPath: string): string | null {
  return resolveAndValidatePath(basePath, requestedPath) ?? resolveClaudeConfigPath(basePath, requestedPath);
}
