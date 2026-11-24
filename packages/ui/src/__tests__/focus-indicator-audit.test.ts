// @vitest-environment node
/**
 * Focus indicator audit (C3 and the accessibility floor in design/redesign/DECISIONS.md).
 *
 * The fallback focus line for bare elements sits in `@layer base`, so any `outline-none`
 * utility cancels it, and an element with a `data-slot` has no fallback at all. Every
 * `outline-none` / `outline-hidden` therefore has to bring its own indicator in the same
 * string literal, or be listed below with the thing that shows focus instead.
 *
 * Classes are compiled with Tailwind, so a class counts for what it renders: a variant
 * that does not exist, or one that holds on hover, shows nothing on focus.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile } from 'tailwindcss';
import { beforeAll, describe, expect, it } from 'vitest';

const SRC_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/** The utilities that show focus: the line, or the highlight of a menu or palette row. */
const INDICATOR = /:(?:focus-line(?:-inset)?|bg-(?:accent|muted))$/;
/** The states they have to hold in: focus, or the row or slot that stands for it. */
const FOCUS_STATE = /:focus(?:-visible|-within)?\b|\[data-selected\]|\[data-active="true"\]/;
/** A frame's line, drawn while the field inside it is focused. */
const FRAME_STATE = /:focus-within\b|:has\(.*:focus-visible/;
/** Conditions a focused element may not meet. */
const OTHER_STATE = /:not\(|:hover\b|:active\b|:disabled\b|@media/;
const REMOVES_OUTLINE = /outline(?:-style)?: (?:none|0)|outline-width: 0|outline-color: transparent/;

const THEME = `
  @tailwind utilities;
  @theme { --color-accent: red; --color-muted: red; }
  @utility focus-line { outline: 2px solid var(--focus); outline-offset: 2px; }
  @utility focus-line-inset { outline: 2px solid var(--focus); outline-offset: -2px; }
`;

/** What each class renders, without the class name itself. Empty when it renders nothing. */
const rendered = new Map<string, string>();

const classesIn = (text: string): string[] =>
  text.split(/[\s"'`]+/).filter((name) => /outline|focus-line|bg-(?:accent|muted)$/.test(name));

async function render(text: string): Promise<void> {
  for (const name of new Set(classesIn(text))) {
    if (rendered.has(name)) continue;
    const { build } = await compile(THEME);
    rendered.set(name, build([name]).replace(/\.(?:\\.|[\w-])+/g, ''));
  }
}

const css = (name: string): string => rendered.get(name) ?? '';
const removesOutline = (name: string): boolean => REMOVES_OUTLINE.test(css(name));
const showsFocus = (name: string, state = FOCUS_STATE): boolean =>
  INDICATOR.test(name) && state.test(css(name)) && !OTHER_STATE.test(css(name));

interface Exemption {
  count: number;
  shownBy: string;
  /** The file that draws the line, when it is not the one that drops the outline. */
  frame?: string;
}

const PANEL = 'an overlay panel: focused by script when it opens, never a tab stop';

const EXEMPT: Record<string, Exemption> = {
  'components/ui/alert-dialog.tsx': { count: 1, shownBy: PANEL },
  'components/ui/dialog.tsx': { count: 1, shownBy: PANEL },
  'components/ui/popover.tsx': { count: 1, shownBy: PANEL },
  'components/ui/hover-card.tsx': { count: 1, shownBy: PANEL },
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

const SOURCES = sources(SRC_ROOT);

/** Class lists as written: one string literal each. Counts the ones that drop the outline and bring nothing. */
function unmarkedIn(text: string): number {
  const literals = text.match(/"[^"\n]*"|'[^'\n]*'|`[^`]*`/g) ?? [];
  return literals.filter((list) => {
    const classes = classesIn(list);
    return classes.some(removesOutline) && !classes.some((name) => showsFocus(name));
  }).length;
}

describe('what a class shows', () => {
  const unmarked = async (list: string): Promise<boolean> => {
    await render(list);
    return unmarkedIn(`"${list}"`) === 1;
  };

  it.each([
    'outline-none focus-visible:focus-line',
    'outline-hidden focus:bg-accent',
    'outline-none has-[input:focus-visible]:focus-line-inset',
    'outline-none [button,a]:focus-visible:focus-line',
    'outline-none data-selected:bg-muted',
    'hover:bg-accent focus-visible:focus-line',
  ])('accepts %s', async (list) => {
    expect(await unmarked(list)).toBe(false);
  });

  it.each([
    'outline-none',
    'focus:outline-none',
    '[outline:none]',
    '[outline-style:none] hover:bg-accent',
    'outline-0',
    'outline-none focus-line',
    'outline-none group-hover:focus-line',
    'outline-none hover:focus-visible:focus-line',
    'outline-none not-focus:focus-line',
    'outline-none xyz:focus-line',
    'outline-none focus-visible:focus-lines',
  ])('refuses %s', async (list) => {
    expect(await unmarked(list)).toBe(true);
  });
});

describe('focus indicator audit', () => {
  beforeAll(async () => {
    for (const { text } of SOURCES) await render(text);
  });

  it('leaves every element that drops its outline with something that shows focus', () => {
    const counts = Object.fromEntries(
      SOURCES.map(({ rel, text }) => [rel, unmarkedIn(text)] as const).filter(([, count]) => count > 0),
    );
    const allowed = Object.fromEntries(Object.entries(EXEMPT).map(([rel, { count }]) => [rel, count]));
    expect(counts).toEqual(allowed);
  });

  it('keeps the line on every frame an exemption relies on', () => {
    const missing = Object.entries(EXEMPT)
      .filter(([, { shownBy }]) => / line\b/.test(shownBy))
      .map(([rel, { frame }]) => frame ?? rel)
      .filter(
        (rel) => !classesIn(readFileSync(join(SRC_ROOT, rel), 'utf8')).some((name) => showsFocus(name, FRAME_STATE)),
      );
    expect(missing).toEqual([]);
  });

  it('keeps `data-noring`, which drops the fallback line, to elements with a framed or fixed focus', () => {
    const files = SOURCES.filter(({ rel, text }) => rel.endsWith('.tsx') && /\sdata-noring\b/.test(text))
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
