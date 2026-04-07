import { defaultUrlTransform } from 'react-markdown';
import type { Root, Text, Link } from 'mdast';
import type { Plugin } from 'unified';
import { visit } from 'unist-util-visit';

/**
 * Protocols that the Electron main process allows via shell.openExternal.
 * Keep in sync with ALLOWED_SCHEMES in packages/desktop/src/main/index.ts.
 */
const EXTRA_SAFE_PROTOCOLS =
  /^(slack|vscode|vscode-insiders|cursor|jetbrains|idea|zed|figma|linear|notion|discord|tel)$/i;

/** Matches bare app-protocol URLs in text (e.g. slack://channel?team=...) */
const APP_URL_RE =
  /\b((?:slack|vscode|vscode-insiders|cursor|jetbrains|idea|zed|figma|linear|notion|discord|tel):\/\/[^\s<>)\]]*)/gi;

/**
 * Extends react-markdown's default URL sanitiser to allow the same app-protocol
 * URLs that the Electron main process already permits.
 */
export function urlTransform(url: string): string {
  const colon = url.indexOf(':');
  if (colon !== -1) {
    const slash = url.indexOf('/');
    const questionMark = url.indexOf('?');
    const numberSign = url.indexOf('#');
    const isProtocol =
      (slash === -1 || colon < slash) &&
      (questionMark === -1 || colon < questionMark) &&
      (numberSign === -1 || colon < numberSign);

    if (isProtocol && EXTRA_SAFE_PROTOCOLS.test(url.slice(0, colon))) {
      return url;
    }
  }
  return defaultUrlTransform(url);
}

/**
 * Remark plugin that turns bare app-protocol URLs (slack://, vscode://, etc.)
 * into clickable links. remark-gfm only autolinks http(s) URLs.
 */
export const remarkAppLinks: Plugin<[], Root> = () => {
  return (tree: Root) => {
    visit(tree, 'text', (node: Text, index, parent) => {
      if (!parent || index === undefined) return;
      // Don't process text already inside a link
      if (parent.type === 'link') return;

      const matches = [...node.value.matchAll(APP_URL_RE)];
      if (matches.length === 0) return;

      const children: (Text | Link)[] = [];
      let lastEnd = 0;

      for (const match of matches) {
        const start = match.index!;
        const url = match[0]!;

        if (start > lastEnd) {
          children.push({ type: 'text', value: node.value.slice(lastEnd, start) });
        }
        children.push({
          type: 'link',
          url,
          children: [{ type: 'text', value: url }],
        });
        lastEnd = start + url.length;
      }

      if (lastEnd < node.value.length) {
        children.push({ type: 'text', value: node.value.slice(lastEnd) });
      }

      parent.children.splice(index, 1, ...children);
    });
  };
};
