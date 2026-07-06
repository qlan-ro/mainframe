/**
 * MarkdownPreview — text-selection opt-in.
 *
 * The app shell sets `user-select: none` on <body> (native-desktop feel) and
 * re-enables selection only for a whitelist of content selectors in
 * `styles/globals.css`. The preview opts in via the `mf-editor-selectable`
 * class; if that class is dropped from the wrapper OR removed from the CSS
 * whitelist, prose in the preview becomes unselectable (can't copy/paste).
 * Both halves are asserted here so a regression in either surfaces.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MarkdownPreview } from '../MarkdownPreview';

describe('MarkdownPreview — selection opt-in', () => {
  it('renders the wrapper with the mf-editor-selectable class', () => {
    const { getByTestId } = render(<MarkdownPreview value="# Hello\n\nSome copyable text." />);
    expect(getByTestId('markdown-preview').classList.contains('mf-editor-selectable')).toBe(true);
  });

  it('lists .mf-editor-selectable in the globals.css selection whitelist', () => {
    // vitest runs with cwd at the package root (packages/ui).
    const css = readFileSync(resolve(process.cwd(), 'src/styles/globals.css'), 'utf8');
    // The rule must both mention the class and set user-select: text.
    const optInRule = css.match(/\.mf-editor-selectable[^{]*\{[^}]*user-select:\s*text/);
    const groupedWhitelist = /\.mf-editor-selectable[\s\S]{0,200}?user-select:\s*text/.test(css);
    expect(optInRule != null || groupedWhitelist).toBe(true);
  });
});
