import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import { openWorkflowDb, type WorkflowDb } from '../../workflows/db.js';
import { CronScheduler } from '../../workflows/triggers/scheduler.js';

describe('CronScheduler', () => {
  let dir: string;
  let db: WorkflowDb;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'wft-'));
    db = openWorkflowDb(join(dir, 'w.db'));
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const fired: string[] = [];

  function makeScheduler() {
    fired.length = 0;
    return new CronScheduler(db, pino({ level: 'silent' }), (workflowId) => {
      fired.push(workflowId);
    });
  }

  it('arms a schedule and fires when due', () => {
    const sched = makeScheduler();
    const base = new Date('2026-06-12T07:59:30Z').getTime();
    sched.arm('g:daily', 0, '0 8 * * *', 'skip', base);
    sched.sweep(base); // not due yet
    expect(fired).toEqual([]);
    sched.sweep(new Date('2026-06-12T08:00:10Z').getTime());
    expect(fired).toEqual(['g:daily']);
    // next fire re-armed for tomorrow — sweeping again should not re-fire
    sched.sweep(new Date('2026-06-12T08:00:40Z').getTime());
    expect(fired).toEqual(['g:daily']);
  });

  it('on_missed: skip drops missed fires after a long sleep', () => {
    const sched = makeScheduler();
    const base = new Date('2026-06-12T07:00:00Z').getTime();
    sched.arm('g:daily', 0, '0 8 * * *', 'skip', base);
    // Laptop slept 3 days:
    sched.sweep(new Date('2026-06-15T12:00:00Z').getTime());
    expect(fired).toEqual([]); // skipped — no backlog fires
  });

  it('on_missed: run_once fires exactly one make-up run after a long sleep', () => {
    const sched = makeScheduler();
    const base = new Date('2026-06-12T07:00:00Z').getTime();
    sched.arm('g:daily', 0, '0 8 * * *', 'run_once', base);
    sched.sweep(new Date('2026-06-15T12:00:00Z').getTime());
    expect(fired).toEqual(['g:daily']); // exactly one, not three
  });
});
