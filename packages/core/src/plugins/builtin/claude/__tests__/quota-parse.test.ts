import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseClaudeUsage } from '../quota-parse.js';

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures/claude-usage.txt');

// A fixed clock before both reset instants so the future-year inference picks 2026.
const NOW = Date.UTC(2026, 6, 18, 6, 0, 0);
// Europe/Bucharest is EEST (UTC+3) in July, so the wall-clock resets map to:
const SESSION_RESET = Date.UTC(2026, 6, 18, 7, 10); // Jul 18 10:10am +03:00
const WEEKLY_RESET = Date.UTC(2026, 6, 23, 13, 0); // Jul 23 4pm +03:00

describe('parseClaudeUsage — golden fixture', () => {
  it('parses all three windows from real claude -p "/usage" output', () => {
    const quota = parseClaudeUsage(readFileSync(FIXTURE, 'utf-8'), NOW);
    expect(quota).toEqual({
      status: 'ok',
      observedAt: NOW,
      session: { kind: 'session', usedPercent: 19, resetsAt: SESSION_RESET },
      weekly: { kind: 'weekly', usedPercent: 25, resetsAt: WEEKLY_RESET },
      modelWindows: [{ kind: 'weekly-model', usedPercent: 33, resetsAt: WEEKLY_RESET, label: 'Fable' }],
    });
  });

  it('never parses the "What\'s contributing" breakdown into windows', () => {
    const quota = parseClaudeUsage(readFileSync(FIXTURE, 'utf-8'), NOW);
    // The breakdown lines contain "88% of your usage" — none must leak in as windows.
    expect(quota.modelWindows).toHaveLength(1);
  });
});

describe('parseClaudeUsage — best-effort reset', () => {
  it('keeps the percent but nulls resetsAt when the reset is unparseable', () => {
    const quota = parseClaudeUsage('Current session: 42% used · resets soon', NOW);
    expect(quota.status).toBe('ok');
    expect(quota.session).toEqual({ kind: 'session', usedPercent: 42, resetsAt: null });
  });
});

describe('parseClaudeUsage — fail-closed', () => {
  it('fails the whole provider to unknown on an unclassifiable non-empty line', () => {
    const text = 'You are currently using your subscription to power your Claude Code usage\n\nTotally unexpected line';
    const quota = parseClaudeUsage(text, NOW);
    expect(quota).toEqual({ status: 'unknown', modelWindows: [], observedAt: NOW });
  });

  it('fails the whole provider to unknown when a recognized window line has no percent', () => {
    const quota = parseClaudeUsage('Current session: resets Jul 18 at 10:10am (Europe/Bucharest)', NOW);
    expect(quota.status).toBe('unknown');
    expect(quota.session).toBeUndefined();
  });
});

describe('parseClaudeUsage — no data', () => {
  it('returns unknown for the recognized non-subscriber message', () => {
    const quota = parseClaudeUsage('/usage is only available for subscription plans', NOW);
    expect(quota).toEqual({ status: 'unknown', modelWindows: [], observedAt: NOW });
  });

  it('returns unknown when no windows are present at all', () => {
    const quota = parseClaudeUsage('You are currently using your subscription to power your Claude Code usage', NOW);
    expect(quota.status).toBe('unknown');
  });
});
