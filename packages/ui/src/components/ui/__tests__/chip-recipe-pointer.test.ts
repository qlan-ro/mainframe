// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Regression guard for spec AC 22: CHIP_BASE lives in components/ui/chip.ts,
// not layout/MainToolbar.tsx — the design-system docs must point there.
const REPO_ROOT = dirname(dirname(dirname(dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url))))))));
const SKILL_MD = join(REPO_ROOT, '.claude/skills/mainframe-design-system/SKILL.md');
const RECIPES_MD = join(REPO_ROOT, '.claude/skills/mainframe-design-system/references/recipes.md');

describe('chip recipe pointer', () => {
  it('never names CHIP_BASE and MainToolbar on the same line', () => {
    for (const path of [SKILL_MD, RECIPES_MD]) {
      const offendingLines = readFileSync(path, 'utf8')
        .split('\n')
        .filter((line) => line.includes('CHIP_BASE') && line.includes('MainToolbar'));
      expect(offendingLines).toEqual([]);
    }
  });

  it('points both docs at components/ui/chip.ts for CHIP_BASE', () => {
    expect(readFileSync(SKILL_MD, 'utf8')).toContain('components/ui/chip.ts');
    expect(readFileSync(RECIPES_MD, 'utf8')).toContain('components/ui/chip.ts');
  });

  it('still resolves ICON_BTN to layout/MainToolbar.tsx in recipes.md', () => {
    const recipes = readFileSync(RECIPES_MD, 'utf8');
    const iconBtnLine = recipes.split('\n').find((line) => line.includes('ICON_BTN'));
    expect(recipes).toContain('layout/MainToolbar.tsx');
    expect(iconBtnLine).toBeDefined();
  });
});
