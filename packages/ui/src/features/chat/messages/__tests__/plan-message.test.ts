/**
 * plan-message — pure detection-logic tests for the two approved-plan paths.
 *
 * Strategy:
 *  - Every expected value is a hardcoded literal, never recomputed via the
 *    same regex/slice logic the functions under test use.
 *  - Covers the clear-context user-message prefix path and the no-clear-context
 *    ExitPlanMode result path, including the shared nullish/blank-body guards.
 */
import { describe, it, expect } from 'vitest';
import { parsePlanUserMessage, parseApprovedPlanResult } from '../plan-message';

// ---------------------------------------------------------------------------
// parsePlanUserMessage — clear-context path
// ---------------------------------------------------------------------------

describe('parsePlanUserMessage', () => {
  it('strips the "Implement the following plan:" prefix and trims the body', () => {
    const text = 'Implement the following plan:\n\n# Dummy Plan\n## Context\nSome body';
    expect(parsePlanUserMessage(text)).toBe('# Dummy Plan\n## Context\nSome body');
  });

  it('returns null when the prefix is present but not at the start of the string', () => {
    expect(parsePlanUserMessage('Please implement the following plan: do X')).toBeNull();
  });

  it('returns null when there is no plan prefix at all', () => {
    expect(parsePlanUserMessage('How is the weather?')).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(parsePlanUserMessage('')).toBeNull();
  });

  it('returns null for null', () => {
    expect(parsePlanUserMessage(null)).toBeNull();
  });

  it('returns null for undefined', () => {
    expect(parsePlanUserMessage(undefined)).toBeNull();
  });

  it('returns null when the prefix is present but the body is blank', () => {
    expect(parsePlanUserMessage('Implement the following plan:\n\n   ')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// parseApprovedPlanResult — no-clear-context ExitPlanMode result path
// ---------------------------------------------------------------------------

describe('parseApprovedPlanResult', () => {
  it('extracts the body after the "## Approved Plan" heading, dropping the boilerplate', () => {
    const result =
      'User has approved your plan. You can now start coding.\n\n' +
      'Your plan has been saved to: /tmp/p.md\n\n' +
      '## Approved Plan (edited by user):\n' +
      '# Real Plan\n## Steps\nStep one';
    expect(parseApprovedPlanResult(result)).toBe('# Real Plan\n## Steps\nStep one');
  });

  it('falls back to the whole trimmed string when approval is signalled but no heading is present', () => {
    const result = 'User has approved your plan. Go ahead and implement it now.';
    expect(parseApprovedPlanResult(result)).toBe('User has approved your plan. Go ahead and implement it now.');
  });

  it('returns null for a non-approval ExitPlanMode result', () => {
    const result = 'You are not in plan mode. To enter plan mode, call the EnterPlanMode tool first.';
    expect(parseApprovedPlanResult(result)).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(parseApprovedPlanResult('')).toBeNull();
  });

  it('returns null for null', () => {
    expect(parseApprovedPlanResult(null)).toBeNull();
  });

  it('returns null for undefined', () => {
    expect(parseApprovedPlanResult(undefined)).toBeNull();
  });

  // The heading regex (`/^[ \t]*#{1,6}[ \t]*Approved Plan[^\n]*\n/im`) is
  // case-insensitive and accepts 1-6 leading '#' characters.
  it('matches a lowercase heading ("## approved plan:") case-insensitively', () => {
    const result = '## approved plan:\n<body>';
    expect(parseApprovedPlanResult(result)).toBe('<body>');
  });
});
