/** Shape of TS NavigationTree returned by the language service worker. */
export interface NavigationTreeNode {
  text: string;
  kind: string;
  spans: Array<{ start: number; length: number }>;
  childItems?: NavigationTreeNode[];
}

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

/**
 * Build a reference string from file path + symbol info.
 *
 * Tier 1 (symbol chain): `path::SymbolChain`
 * Tier 2 (word only):    `path:line (word)`
 * Tier 3 (nothing):      `path:line`
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
