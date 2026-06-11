/**
 * LSP-based navigation for the CM6 editor.
 *
 * Replaces the 274-line regex `navigation.ts` from desktop:
 *   - Jump history stack: back() / forward() operate on a capped ring buffer
 *   - findReferences(pos) → providers.getReferences → LspLocation[]
 *   - CM6 keymap bindings for ⌘< (back) and ⌘> (forward)
 *
 * The history is stored in a module-level singleton so it persists across
 * tab switches (the editor view is recreated; the history survives).
 * Call `createJumpHistory()` to get an isolated instance in tests.
 */
import { keymap } from '@codemirror/view';
import type { Extension } from '@codemirror/state';
import type { LspProviders, LspLocation, LspPosition } from '@/lib/lsp';
import { emitSurfaceIntent } from '@/store/surface-intents';

// ---------------------------------------------------------------------------
// JumpEntry
// ---------------------------------------------------------------------------

export interface JumpEntry {
  /** Absolute file path. */
  path: string;
  /** 0-based line number. */
  line: number;
  /** 0-based character offset. */
  character: number;
}

// ---------------------------------------------------------------------------
// JumpHistory — capped stack with back/forward pointer
// ---------------------------------------------------------------------------

const MAX_HISTORY = 100;

export interface JumpHistory {
  /** Push a new entry. Entries after the current pointer are discarded. */
  push(entry: JumpEntry): void;
  /** Move back one step. Returns the target entry, or null if at the start. */
  back(): JumpEntry | null;
  /** Move forward one step. Returns the target entry, or null if at the end. */
  forward(): JumpEntry | null;
  /** Current position in the stack (0-based). -1 when empty. */
  readonly cursor: number;
  /** Total number of entries in the stack. */
  readonly size: number;
}

export function createJumpHistory(): JumpHistory {
  const stack: JumpEntry[] = [];
  let cursor = -1;

  return {
    push(entry: JumpEntry) {
      // Drop any forward entries after the current position.
      stack.splice(cursor + 1);
      stack.push(entry);
      if (stack.length > MAX_HISTORY) {
        stack.shift();
      } else {
        cursor++;
      }
    },
    back() {
      if (cursor <= 0) return null;
      cursor--;
      return stack[cursor] ?? null;
    },
    forward() {
      if (cursor >= stack.length - 1) return null;
      cursor++;
      return stack[cursor] ?? null;
    },
    get cursor() {
      return cursor;
    },
    get size() {
      return stack.length;
    },
  };
}

// Module-level singleton (survives tab switches inside a single page load).
export const jumpHistory: JumpHistory = createJumpHistory();

// ---------------------------------------------------------------------------
// findReferences — LSP references lookup
// ---------------------------------------------------------------------------

export async function findReferences(
  providers: LspProviders,
  projectId: string,
  language: string,
  filePath: string,
  position: LspPosition,
  includeDeclaration = false,
): Promise<LspLocation[]> {
  try {
    return await providers.getReferences(projectId, language, {
      filePath,
      position,
      includeDeclaration,
    });
  } catch (err) {
    console.warn('[navigation] findReferences failed', err);
    return [];
  }
}

// ---------------------------------------------------------------------------
// navigateBack / navigateForward — surface-intent emitters
// ---------------------------------------------------------------------------

function navigateBack(): boolean {
  const entry = jumpHistory.back();
  if (!entry) return false;
  emitSurfaceIntent({ type: 'open-file', path: entry.path, line: entry.line, character: entry.character });
  return true;
}

function navigateForward(): boolean {
  const entry = jumpHistory.forward();
  if (!entry) return false;
  emitSurfaceIntent({ type: 'open-file', path: entry.path, line: entry.line, character: entry.character });
  return true;
}

// ---------------------------------------------------------------------------
// CM6 keymap: ⌘< = back, ⌘> = forward
// ---------------------------------------------------------------------------

/**
 * Returns the CM6 keymap extension that binds ⌘< / ⌘> to jump-history
 * navigation. Add this to the editor's extension list alongside
 * `createLspExtensions(...)`.
 */
export function createNavigationKeymap(): Extension {
  return keymap.of([
    {
      key: 'Mod-<',
      run(): boolean {
        return navigateBack();
      },
    },
    {
      key: 'Mod->',
      run(): boolean {
        return navigateForward();
      },
    },
  ]);
}
