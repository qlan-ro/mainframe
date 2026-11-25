import type { BackgroundTask } from '@qlan-ro/mainframe-types';
import { describe, expect, it } from 'vitest';
import { presentAgent } from '../agent-status';

type Evidence = Parameters<typeof presentAgent>[0];
const base: Evidence = {
  codex: false,
  background: false,
  explicitForeground: false,
  needsPermission: false,
  cancelled: false,
  foregroundRunning: false,
  parentRunning: false,
  failed: false,
  answer: '',
  childAnswer: '',
  childTurns: [],
  parentCut: false,
  tasks: null,
  tasksFresh: false,
};
const task = (status: BackgroundTask['status'], startedAt = 1) =>
  ({ id: String(startedAt), status, startedAt, summary: 'Summary' }) as BackgroundTask;
const launch = { background: true, answer: 'Launch' };
const alive = task('running');
const done = task('completed');
const codex = { codex: true, answer: 'Answer' };

describe('agent presentation evidence', () => {
  it.each<[string, Partial<Evidence>, string | null, string, string?, string?]>([
    ['unfinished call', { foregroundRunning: true }, 'running', ''],
    ['idle call', {}, 'no-result', ''],
    ['cancelled call', { cancelled: true, foregroundRunning: true }, 'stopped', ''],
    ['permission takes precedence', { needsPermission: true, cancelled: true }, 'needs-you', ''],
    ['unclassified text', { answer: 'Spawned successfully' }, null, 'Spawned successfully'],
    ['foreground answer', { explicitForeground: true, answer: 'Answer' }, 'completed', 'Answer'],
    ['tool failure', { failed: true, answer: 'Error' }, 'failed', 'Error'],
    ['launch fails', { ...launch, failed: true, answer: 'Error' }, 'failed', 'Error'],
    ['list unknown', launch, null, ''],
    ['stale empty list', { ...launch, tasks: [] }, null, ''],
    ['fresh empty list', { ...launch, tasks: [], tasksFresh: true }, 'no-result', ''],
    ['live task', { ...launch, tasks: [alive], tasksFresh: true }, 'running', '', '1'],
    ['stale live task', { ...launch, tasks: [alive] }, null, ''],
    ['stale mixed tasks', { ...launch, tasks: [alive, done] }, null, ''],
    ['settled task', { ...launch, tasks: [done] }, 'completed', 'Summary'],
    ['failed task', { ...launch, tasks: [task('failed')] }, 'failed', 'Summary'],
    ['stopped task', { ...launch, tasks: [task('stopped')] }, 'stopped', 'Summary'],
    ['worst settled outcome', { ...launch, tasks: [task('stopped'), task('failed', 2), done] }, 'failed', 'Summary'],
    ['Codex answer', codex, 'completed', 'Answer'],
    ['Codex list unknown while parent runs', { ...codex, parentRunning: true }, null, 'Answer'],
    [
      'Codex live group',
      { ...codex, tasks: [alive, task('running', 2), done], tasksFresh: true },
      'running',
      'Answer',
      '1',
      '2 running',
    ],
    ['Codex stale live group', { ...codex, tasks: [alive, done] }, null, 'Answer'],
    [
      'Codex failed child',
      { ...codex, childTurns: ['failed', 'completed'] },
      'failed',
      'Answer',
      undefined,
      '1 of 2 failed',
    ],
    ['Codex cancelled child', { ...codex, childTurns: ['cancelled'] }, 'stopped', 'Answer'],
    ['Codex cut with no child result', { ...codex, parentCut: true }, 'no-result', ''],
    [
      'Codex cut with a partial result',
      { ...codex, parentCut: true, childTurns: ['completed', 'unknown'], childAnswer: 'Child answer' },
      null,
      'Child answer',
    ],
    [
      'Codex cut with all children complete',
      { ...codex, parentCut: true, childTurns: ['completed'], tasks: [done] },
      'completed',
      'Answer',
    ],
    ['Codex cut with a tool error', { ...codex, parentCut: true, failed: true }, 'failed', 'Answer'],
    ['Codex settled task without answer', { codex: true, tasks: [done] }, 'no-result', ''],
  ])('%s', (_, evidence, status, result, runningTask, label) => {
    const shown = presentAgent({ ...base, ...evidence });
    expect(shown.state?.status ?? null).toBe(status);
    expect(shown.state?.label).toBe(label);
    expect(shown.result).toBe(result);
    expect(shown.runningTask?.id).toBe(runningTask);
  });
});
