import { describe, it, expect } from 'vitest';
import { extractPrFromToolResult } from '../events.js';

describe('History PR Detection', () => {
  it('detects GitHub PR URL from tool result content', () => {
    const content = 'PR created at https://github.com/owner/repo/pull/123';
    const pr = extractPrFromToolResult(content);
    expect(pr).toBeTruthy();
    expect(pr?.number).toBe(123);
    expect(pr?.owner).toBe('owner');
    expect(pr?.repo).toBe('repo');
  });

  it('detects GitLab MR URL from tool result content', () => {
    const content = 'MR created at https://gitlab.com/org/project/-/merge_requests/456';
    const pr = extractPrFromToolResult(content);
    expect(pr).toBeTruthy();
    expect(pr?.number).toBe(456);
  });

  it('returns null when no PR URL found', () => {
    const content = 'No PR here';
    const pr = extractPrFromToolResult(content);
    expect(pr).toBeNull();
  });

  it('detects multiple PRs and returns first match', () => {
    const content = `
      First PR: https://github.com/org/repo1/pull/111
      Second PR: https://github.com/org/repo2/pull/222
    `;
    const pr = extractPrFromToolResult(content);
    expect(pr?.number).toBe(111);
  });
});
