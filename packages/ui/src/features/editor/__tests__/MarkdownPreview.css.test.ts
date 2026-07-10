// @vitest-environment node
/**
 * MarkdownPreview — CSS half of the text-selection opt-in (the wrapper-class
 * half renders in MarkdownPreview.test.tsx). The app shell sets
 * `user-select: none` on <body>; if `.mf-editor-selectable` drops out of the
 * globals.css re-enable whitelist, every opted-in surface (markdown preview,
 * CodeMirror source + diff, SVG source) silently loses text selection.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('globals.css selection whitelist', () => {
  it('re-enables user-select: text for .mf-editor-selectable', () => {
    const css = readFileSync(resolve(__dirname, '../../../styles/globals.css'), 'utf8');
    // The rule must both mention the class and set user-select: text.
    const optInRule = css.match(/\.mf-editor-selectable[^{]*\{[^}]*user-select:\s*text/);
    const groupedWhitelist = /\.mf-editor-selectable[\s\S]{0,200}?user-select:\s*text/.test(css);
    expect(optInRule != null || groupedWhitelist).toBe(true);
  });
});
