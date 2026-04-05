import type * as monacoType from 'monaco-editor';

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

/**
 * Copy a qualified reference string for the symbol at the cursor to the clipboard.
 * Called by the Monaco `mainframe.copyReference` action in both editors.
 */
export async function copyReference(
  editor: monacoType.editor.ICodeEditor,
  filePath: string | undefined,
  monaco: typeof monacoType,
  lineOffset?: number,
): Promise<void> {
  const position = editor.getPosition();
  const model = editor.getModel();
  if (!position || !model) return;

  const line = position.lineNumber;
  const wordInfo = model.getWordAtPosition(position);
  const word = wordInfo?.word;

  let symbolChain: string | undefined;

  const langId = model.getLanguageId();
  if (langId === 'typescript' || langId === 'javascript') {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tsLang = monaco.languages.typescript as any;
      const getWorker = langId === 'typescript' ? tsLang.getTypeScriptWorker : tsLang.getJavaScriptWorker;
      const worker = await getWorker();
      const client = await worker(model.uri);
      const navTree = await (client as any).getNavigationTree(model.uri.toString());
      if (navTree) {
        const offset = model.getOffsetAt(position);
        symbolChain = findSymbolChain(navTree, offset);
      }
    } catch {
      /* TS worker unavailable — fall back to word */
    }
  }

  const reference = buildReference(filePath, line, symbolChain, word, lineOffset);

  try {
    await navigator.clipboard.writeText(reference);
  } catch {
    /* clipboard API failure — silent for v1 */
  }
}
