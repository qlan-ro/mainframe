/**
 * URL transform and remark plugin for the markdown renderer.
 *
 * `urlTransform` extends react-markdown's default sanitiser to allow the same
 * app-protocol URLs that Tauri permits via plugin-opener (slack://, vscode://, etc.).
 *
 * `remarkAppLinks` converts bare app-protocol URLs in plain text into clickable
 * links — remark-gfm only autolinks http(s) URLs.
 */
import { defaultUrlTransform } from 'react-markdown';
import type { Root, Text, Link } from 'mdast';
import type { Plugin } from 'unified';
import { visit } from 'unist-util-visit';

/**
 * App protocols allowed by plugin-opener on Tauri.
 * Keep in sync with the Tauri `allow-open-url` permission set.
 */
const EXTRA_SAFE_PROTOCOLS =
  /^(slack|vscode|vscode-insiders|cursor|jetbrains|idea|zed|figma|linear|notion|discord|tel)$/i;

/** Bare app-protocol URL pattern for text scanning. */
const APP_URL_RE =
  /\b((?:slack|vscode|vscode-insiders|cursor|jetbrains|idea|zed|figma|linear|notion|discord|tel):\/\/[^\s<>)\]]*)/gi;

export function urlTransform(url: string): string {
  const colon = url.indexOf(':');
  if (colon !== -1) {
    const slash = url.indexOf('/');
    const qmark = url.indexOf('?');
    const hash = url.indexOf('#');
    const isProtocol =
      (slash === -1 || colon < slash) && (qmark === -1 || colon < qmark) && (hash === -1 || colon < hash);
    if (isProtocol && EXTRA_SAFE_PROTOCOLS.test(url.slice(0, colon))) {
      return url;
    }
  }
  return defaultUrlTransform(url);
}

export const remarkAppLinks: Plugin<[], Root> = () => {
  return (tree: Root) => {
    visit(tree, 'text', (node: Text, index, parent) => {
      if (!parent || index === undefined) return;
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
