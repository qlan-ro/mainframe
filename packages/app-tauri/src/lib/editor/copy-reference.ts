/**
 * copy-reference — pure `path:line` (or `path::SymbolChain`) clipboard-string builder.
 *
 * Port of packages/desktop/src/renderer/components/editor/copy-reference.ts
 * Changes:
 *   - Removed Monaco editor + TS worker coupling (copyReference function)
 *   - buildReference and findSymbolChain are the stable pure exports
 *   - buildReferenceForCm added: CM6-friendly entry point (no Monaco ICodeEditor)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Shape of TS NavigationTree returned by the language service worker. */
export interface NavigationTreeNode {
  text: string;
  kind: string;
  spans: Array<{ start: number; length: number }>;
  childItems?: NavigationTreeNode[];
}

// ---------------------------------------------------------------------------
// findSymbolChain — walk a TS NavigationTree depth-first
// ---------------------------------------------------------------------------

/**
 * Walk a TS NavigationTree depth-first and return the dotted symbol chain
 * for the deepest node whose span contains `offset`.
 * Skips the root module node (kind === 'module').
 */
export function findSymbolChain(root: NavigationTreeNode, offset: number): string | undefined {
  const chain: string[] = [];

  function walk(node: NavigationTreeNode): boolean {
    const inSpan = node.spans.some((s) => offset >= s.start && offset < s.start + s.length);
    if (!inSpan) return false;

    if (node.kind !== 'module') {
      chain.push(node.text);
    }

    if (node.childItems) {
      for (const child of node.childItems) {
        if (walk(child)) return true;
      }
    }

    return chain.length > 0;
  }

  walk(root);
  return chain.length > 0 ? chain.join('.') : undefined;
}

// ---------------------------------------------------------------------------
// buildReference — assemble the reference string
// ---------------------------------------------------------------------------

/**
 * Build a reference string from file path + symbol info.
 *
 * Tier 1 (symbol chain): `path::SymbolChain`
 * Tier 2 (word only):    `path:line (word)`
 * Tier 3 (nothing):      `path:line`
 *
 * @param filePath  Absolute or relative file path; defaults to "untitled".
 * @param line      1-based line number (from the editor position).
 * @param symbolChain  Optional dotted chain from findSymbolChain.
 * @param word         Optional word under the cursor.
 * @param lineOffset   Added to `line` for tiers 2 and 3 only.
 */
export function buildReference(
  filePath: string | undefined,
  line: number,
  symbolChain?: string,
  word?: string,
  lineOffset?: number,
): string {
  const path = filePath ?? 'untitled';
  if (symbolChain) return `${path}::${symbolChain}`;
  const adjustedLine = line + (lineOffset ?? 0);
  if (word) return `${path}:${adjustedLine} (${word})`;
  return `${path}:${adjustedLine}`;
}

// ---------------------------------------------------------------------------
// buildReferenceForCm — CM6-friendly entry point
// ---------------------------------------------------------------------------

/**
 * Build a reference string for a CM6 cursor position.
 *
 * @param filePath  Absolute file path from the CmEditor `path` prop.
 * @param line      0-based line number from CM6 (will be converted to 1-based).
 * @param word      Optional word under the cursor (CM6 word-at-pos).
 */
export function buildReferenceForCm(filePath: string | undefined, line: number, word?: string): string {
  // CM6 uses 0-based lines; buildReference expects 1-based.
  return buildReference(filePath, line + 1, undefined, word);
}

// ---------------------------------------------------------------------------
// writeToClipboard — thin async wrapper for the clipboard API
// ---------------------------------------------------------------------------

/** Write `text` to the clipboard. Logs a warning on failure — never throws. */
export async function writeToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch (err) {
    console.warn('[copy-reference] clipboard write failed', err);
  }
}
