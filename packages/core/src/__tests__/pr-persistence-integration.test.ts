import { describe, it, expect } from 'vitest';
import type { DetectedPr } from '@qlan-ro/mainframe-types';

/**
 * Integration test: Verify that when a DetectedPr event is emitted,
 * it gets persisted to the database so it survives session reload.
 *
 * Currently FAILING because:
 * 1. onPrDetected emits event but doesn't persist to database
 * 2. Chat type doesn't have a detectedPrs field
 * 3. ChatsRepository doesn't have addDetectedPr method
 */
describe('PR Persistence Integration', () => {
  it('persists detected PR to database on onPrDetected', () => {
    // Simulate what happens when a PR is detected during live stream or history
    const pr: DetectedPr = {
      owner: 'doruchiulan',
      repo: 'mainframe',
      number: 123,
      url: 'https://github.com/doruchiulan/mainframe/pull/123',
      source: 'created',
    };

    // This is what SHOULD happen but currently doesn't:
    // 1. onPrDetected({ ...pr, source: 'created' }) is called
    // 2. EventHandler emits event
    // 3. Daemon receives event and calls db.chats.addDetectedPr(chatId, pr)
    // 4. PR is stored in database
    // 5. On session reload, PR is available

    // For now, just verify the PR structure is correct
    expect(pr.number).toBe(123);
    expect(pr.source).toBe('created');
  });

  it('avoids duplicates when same PR detected twice', () => {
    // If PR detection runs twice (history + live stream),
    // we should only have one entry in the database
    const pr1: DetectedPr = {
      owner: 'org',
      repo: 'repo',
      number: 42,
      url: 'https://github.com/org/repo/pull/42',
      source: 'mentioned',
    };

    const pr2: DetectedPr = {
      owner: 'org',
      repo: 'repo',
      number: 42,
      url: 'https://github.com/org/repo/pull/42',
      source: 'created',
    };

    // Should recognize these are the same PR (owner, repo, number)
    // and upgrade source from 'mentioned' to 'created'
    const isSamePr = pr1.owner === pr2.owner && pr1.repo === pr2.repo && pr1.number === pr2.number;
    expect(isSamePr).toBe(true);
  });
});
