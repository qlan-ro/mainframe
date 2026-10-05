/**
 * advisor-testids.test.ts (spec AC 2, plan D6; plan T32)
 *
 * Regression guard, not a red test — green from the start and must stay
 * green through the section-switcher work. Reads the advisor source files
 * off disk and asserts every pre-existing `data-testid` token is still
 * present, so the new Skills section can't silently drop one while editing
 * these files.
 *
 * D8 update: the sheet (`SetupAdvisorHost`) is gone — its testids moved to
 * `AdvisorSurface` (the rail-view body) — and the title bar's Setup Advisor
 * button is gone too (it's a rail button now, `shell-rail-advisor`, covered
 * by `NavRail.test.tsx`), so `automation-recommender-sheet` and
 * `automation-recommender-open` are retired rather than tracked here.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const advisorDir = join(here, '..');

function read(...segments: string[]): string {
  return readFileSync(join(...segments), 'utf-8');
}

describe('Setup Advisor — pre-existing data-testid tokens survive the section work', () => {
  it('keeps the literal testids', () => {
    const sheet = read(advisorDir, 'SetupAdvisorSheet.tsx');
    const evidence = read(advisorDir, 'EvidenceDisclosure.tsx');

    expect(sheet).toContain('data-testid="automation-recommender-loading"');
    expect(sheet).toContain('data-testid="automation-recommender-retry"');
    expect(evidence).toContain('data-testid="automation-recommender-evidence-toggle"');
  });

  it('keeps both template-literal testid prefixes', () => {
    const categoryTabs = read(advisorDir, 'CategoryTabs.tsx');
    const recommendationRow = read(advisorDir, 'RecommendationRow.tsx');

    expect(categoryTabs).toContain('data-testid={`automation-recommender-tab-');
    expect(recommendationRow).toContain('data-testid={`automation-recommender-copy-');
  });
});
