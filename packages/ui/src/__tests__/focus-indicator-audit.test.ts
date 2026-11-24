// @vitest-environment node
/**
 * Focus indicator audit (C3 and the accessibility floor in design/redesign/DECISIONS.md).
 *
 * The fallback focus line for bare elements sits in `@layer base`, so any `outline-none`
 * utility cancels it, and an element with a `data-slot` has no fallback at all. Every
 * `outline-none` / `outline-hidden` therefore has to bring its own indicator in the same
 * string literal, or be listed below with the thing that shows focus instead.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/** The focus line behind a state variant, or the highlight of a menu or palette row. */
const INDICATOR = /[\w\]]:focus-line\b|focus:bg-(?:accent|muted)\b|data-selected:bg-muted\b/;
const REMOVES_OUTLINE = /\boutline-(?:none|hidden)\b/;

/** The line a frame draws while the field inside it is focused. */
const FRAME_LINE = /(?:focus-within|focus-visible\]):focus-line/;

interface Exemption {
  count: number;
  shownBy: string;
  /** The file that draws the line, when it is not the one that drops the outline. */
  frame?: string;
}

const PANEL = 'an overlay panel: focused by script when it opens, never a tab stop';
const REGION = 'not focusable: a disclosure body';

const EXEMPT: Record<string, Exemption> = {
  'components/ui/alert-dialog.tsx': { count: 1, shownBy: PANEL },
  'components/ui/dialog.tsx': { count: 1, shownBy: PANEL },
  'components/ui/popover.tsx': { count: 1, shownBy: PANEL },
  'components/ui/hover-card.tsx': { count: 1, shownBy: PANEL },
  'components/ui/assistant-ui/reasoning.tsx': { count: 1, shownBy: REGION },
  'components/ui/assistant-ui/tool-group.tsx': { count: 1, shownBy: REGION },
  'components/ui/assistant-ui/tool-fallback.tsx': { count: 1, shownBy: REGION },
  'components/ui/attachment.tsx': { count: 1, shownBy: 'Attachment’s `focus-within` line' },
  'components/ui/command.tsx': {
    count: 2,
    shownBy: 'the palette: focus never leaves its input, and the selected row is highlighted',
  },
  'components/ui/input-group.tsx': { count: 2, shownBy: 'InputGroup’s line while its control is focused' },
  'features/chat/composer/Composer.tsx': { count: 1, shownBy: 'the composer card’s `focus-within` line' },
  'features/chat/composer/segments/ComposerSegments.tsx': {
    count: 1,
    shownBy: 'the composer card’s `focus-within` line',
    frame: 'features/chat/composer/Composer.tsx',
  },
  'features/chat/composer/edit/ComposerEditMode.tsx': { count: 1, shownBy: 'the edit card’s line' },
  'features/editor/inline-comments/InlineCommentWidget.tsx': {
    count: 1,
    shownBy: 'the comment card’s `focus-within` line',
  },
  'features/automations/editor/AddStepMenu.tsx': { count: 1, shownBy: 'the search row’s line' },
  'features/automations/editor/ConditionRow.tsx': { count: 1, shownBy: 'the value field’s line' },
  'features/automations/fields/TriggerTextField.tsx': {
    count: 1,
    shownBy: 'the field’s line, or the Agent card’s when `bare`',
  },
  'features/automations/steps/ActionCatalog.tsx': { count: 1, shownBy: 'the search field’s line' },
  'features/files/directory-picker/PathCrumbInput.tsx': { count: 1, shownBy: 'the path bar’s line' },
  'features/session-panel/TasksSection.tsx': { count: 1, shownBy: 'the row’s line' },
  'features/tasks/DependencyPicker.tsx': { count: 1, shownBy: 'the search row’s line' },
  'features/tasks/LabelAutocomplete.tsx': { count: 1, shownBy: 'the field’s `focus-within` line' },
  'features/tasks/sidebar/LabelAutocomplete.tsx': { count: 1, shownBy: 'the field’s `focus-within` line' },
  'features/viewers/CsvViewer.tsx': { count: 1, shownBy: 'the filter chip’s line' },
  'layout/WorkspaceUrlEntry.tsx': { count: 1, shownBy: 'the address field’s line' },
};

function sources(dir: string): { rel: string; text: string }[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return entry === '__tests__' ? [] : sources(path);
    if (!/\.tsx?$/.test(entry)) return [];
    const text = readFileSync(path, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    return [{ rel: relative(SRC_ROOT, path), text }];
  });
}

/** Class lists as written: one string literal each. Counts the ones that drop the outline and bring nothing. */
function unmarkedIn(text: string): number {
  const literals = text.match(/"[^"\n]*"|'[^'\n]*'|`[^`]*`/g) ?? [];
  return literals.filter((list) => REMOVES_OUTLINE.test(list) && !INDICATOR.test(list)).length;
}

describe('focus indicator audit', () => {
  it('leaves every element that drops its outline with something that shows focus', () => {
    const counts = Object.fromEntries(
      sources(SRC_ROOT)
        .map(({ rel, text }) => [rel, unmarkedIn(text)] as const)
        .filter(([, count]) => count > 0),
    );
    const allowed = Object.fromEntries(Object.entries(EXEMPT).map(([rel, { count }]) => [rel, count]));
    expect(counts).toEqual(allowed);
  });

  it('keeps the line on every frame an exemption relies on', () => {
    const missing = Object.entries(EXEMPT)
      .filter(([, { shownBy }]) => / line\b/.test(shownBy))
      .map(([rel, { frame }]) => frame ?? rel)
      .filter((rel) => !FRAME_LINE.test(readFileSync(join(SRC_ROOT, rel), 'utf8')));
    expect(missing).toEqual([]);
  });

  it('keeps `data-noring`, which drops the fallback line, to elements with a framed or fixed focus', () => {
    const files = sources(SRC_ROOT)
      .filter(({ rel, text }) => rel.endsWith('.tsx') && /\sdata-noring\b/.test(text))
      .map(({ rel }) => rel)
      .sort();
    expect(files).toEqual([
      'components/ui/command.tsx',
      'features/chat/composer/Composer.tsx',
      'features/chat/composer/edit/ComposerEditMode.tsx',
      // Inside an InputGroup, which draws the line.
      'features/git/BranchListView.tsx',
      'features/session-panel/TasksSection.tsx',
      'features/tasks/DependencyPicker.tsx',
    ]);
  });

  it('insets the line of a thumbnail its tile would clip', () => {
    for (const rel of ['features/tasks/TaskAttachments.tsx', 'features/tasks/sidebar/TaskAttachments.tsx']) {
      const text = readFileSync(join(SRC_ROOT, rel), 'utf8');
      expect(text, rel).toMatch(/cursor-zoom-in focus-visible:focus-line-inset"/);
    }
  });

  it('keeps the fallback line for bare elements in the base layer', () => {
    const css = readFileSync(join(SRC_ROOT, 'styles/domain-tokens.css'), 'utf8');
    expect(css).toMatch(/input:not\(\[data-noring\], \[data-slot\]\):focus-visible/);
    expect(css).toMatch(/outline: 2px solid var\(--focus\)/);
  });
});
