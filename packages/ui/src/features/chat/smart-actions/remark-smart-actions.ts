/**
 * remarkSmartActions — splices a marker node around every slash instruction
 * found in markdown prose, so the `span` component override can decide at
 * render time whether to chip it (#278).
 *
 * One responsibility: `text` nodes. `inlineCode` and `code` are deliberately
 * untouched — both already hand their raw string to a component seam (`Code`'s
 * children, `CodeHeader`/`SyntaxHighlighter`'s `code` prop), where
 * `parseInstructionLine` answers the same question. Annotating them would also
 * be pointless: `unstable_memoizeMarkdownComponents` strips `node` from every
 * entry, so no seam can read mdast properties.
 *
 * The marker carries its text in `children`, NOT in `value`. `mdast-util-to-hast`'s
 * `defaultUnknownHandler` renders `state.all(node)` for any node carrying
 * `hProperties`, so a node with `value` and no children emits an *empty* span
 * and the token disappears from the transcript.
 *
 * Gating is render-time by construction: the plugin is a module-level constant
 * (assistant-ui requires a stable `remarkPlugins` reference) and therefore
 * cannot consult the per-chat skills catalog.
 */
import type { Data, Parent, Root, Text } from 'mdast';
import type { Plugin } from 'unified';
import { SKIP, visitParents } from 'unist-util-visit-parents';
import { findSlashInstructions } from '@qlan-ro/mainframe-types';

/**
 * The DOM prop the `span` override reads. It is the literal attribute name:
 * `property-information` builds `data-*` infos with no space, so
 * `hast-util-to-jsx-runtime` passes the attribute through uncamelized.
 */
export const INSTRUCTION_ATTR = 'data-smart-action-instruction';

interface SmartActionData extends Data {
  hName: string;
  hProperties: Record<string, string>;
}

export interface SmartActionText extends Parent {
  type: 'smartActionText';
  data?: SmartActionData;
  children: Text[];
}

declare module 'mdast' {
  interface PhrasingContentMap {
    smartActionText: SmartActionText;
  }
  interface RootContentMap {
    smartActionText: SmartActionText;
  }
}

function markerNode(token: string): SmartActionText {
  return {
    type: 'smartActionText',
    data: { hName: 'span', hProperties: { [INSTRUCTION_ATTR]: token } },
    children: [{ type: 'text', value: token }],
  };
}

export const remarkSmartActions: Plugin<[], Root> = () => {
  return (tree: Root) => {
    visitParents(tree, 'text', (node: Text, ancestors) => {
      // Widened from the visitor's per-type ancestor union so `children` is one
      // array type rather than a union of them.
      const parent = ancestors[ancestors.length - 1] as Parent | undefined;
      if (!parent) return;
      // A token inside a link is part of the URL or its label, never an instruction.
      if (ancestors.some((ancestor) => ancestor.type === 'link')) return;

      const matches = findSlashInstructions(node.value);
      if (matches.length === 0) return;

      const replacement: (Text | SmartActionText)[] = [];
      let lastEnd = 0;
      for (const match of matches) {
        if (match.start > lastEnd) {
          replacement.push({ type: 'text', value: node.value.slice(lastEnd, match.start) });
        }
        replacement.push(markerNode(match.token));
        lastEnd = match.end;
      }
      if (lastEnd < node.value.length) {
        replacement.push({ type: 'text', value: node.value.slice(lastEnd) });
      }

      const index = parent.children.indexOf(node);
      parent.children.splice(index, 1, ...replacement);
      // Resume past the spliced-in nodes; re-visiting them would rescan the same text.
      const resumeAfterSplice: [typeof SKIP, number] = [SKIP, index + replacement.length];
      return resumeAfterSplice;
    });
  };
};
