/**
 * MarkdownPreview — text-selection opt-in.
 *
 * The app shell sets `user-select: none` on <body> (native-desktop feel) and
 * re-enables selection only for a whitelist of content selectors in
 * `styles/globals.css`. The preview opts in via the `mf-editor-selectable`
 * class; if that class is dropped from the wrapper, prose in the preview
 * becomes unselectable (can't copy/paste). The CSS-whitelist half lives in
 * MarkdownPreview.css.test.ts — it needs node:fs, which jsdom-environment
 * suites cannot import ("No such built-in module: node:").
 */
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MarkdownPreview } from '../MarkdownPreview';

describe('MarkdownPreview — selection opt-in', () => {
  it('renders the wrapper with the mf-editor-selectable class', () => {
    const { getByTestId } = render(<MarkdownPreview value="# Hello\n\nSome copyable text." />);
    expect(getByTestId('markdown-preview').classList.contains('mf-editor-selectable')).toBe(true);
  });
});
