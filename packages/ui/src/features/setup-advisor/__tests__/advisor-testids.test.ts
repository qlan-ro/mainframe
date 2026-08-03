/**
 * advisor-testids.test.ts (spec AC 2, plan D6; plan T32)
 *
 * Regression guard, not a red test — green from the start and must stay
 * green through the section-switcher work. Reads the advisor source files
 * off disk and asserts every pre-existing `data-testid` token is still
 * present, so the new Skills section can't silently drop one while editing
 * these files.
 *
 * Spec AC 2 says "all six existing advisor `data-testid` values"; the repo
 * actually has five string literals plus two template-literal prefixes —
 * seven tokens total (plan Decision D6). This test asserts the real seven
 * rather than silently reinterpreting the spec's count down to six.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const advisorDir = join(here, '..');
const layoutDir = join(here, '..', '..', '..', 'layout');

function read(...segments: string[]): string {
  return readFileSync(join(...segments), 'utf-8');
}

describe('Setup Advisor — pre-existing data-testid tokens survive the section work', () => {
  it('keeps all five literal testids', () => {
    const host = read(advisorDir, 'SetupAdvisorHost.tsx');
    const sheet = read(advisorDir, 'SetupAdvisorSheet.tsx');
    const evidence = read(advisorDir, 'EvidenceDisclosure.tsx');
    const toolbar = read(layoutDir, 'MainToolbar.tsx');

    expect(host).toContain('data-testid="automation-recommender-sheet"');
    expect(sheet).toContain('data-testid="automation-recommender-loading"');
    expect(sheet).toContain('data-testid="automation-recommender-retry"');
    expect(evidence).toContain('data-testid="automation-recommender-evidence-toggle"');
    expect(toolbar).toContain('data-testid="automation-recommender-open"');
  });

  it('keeps both template-literal testid prefixes', () => {
    const categoryTabs = read(advisorDir, 'CategoryTabs.tsx');
    const recommendationRow = read(advisorDir, 'RecommendationRow.tsx');

    expect(categoryTabs).toContain('data-testid={`automation-recommender-tab-');
    expect(recommendationRow).toContain('data-testid={`automation-recommender-copy-');
  });
});
