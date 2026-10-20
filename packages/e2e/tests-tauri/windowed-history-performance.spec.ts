import { test, expect } from '@playwright/test';
import { rmSync } from 'node:fs';
import { seedWindowedHistory } from '../helpers/tauri/windowed-history.js';
import { cleanupHeadlessProject } from '../helpers/tauri/headless-chat.js';
import { measureHistory, percentile95, type HistoryMeasurement } from '../helpers/tauri/history-performance.js';

test('windowed history meets the reference transcript performance gates', async ({}, info) => {
  const manualCi = process.env['CI'] === 'true' && process.env['GITHUB_EVENT_NAME'] === 'workflow_dispatch';
  test.skip(
    process.env['MF_E2E_HISTORY_PERF'] !== '1' && !manualCi,
    'Run manually on CI or with MF_E2E_HISTORY_PERF=1',
  );
  test.setTimeout(30 * 60_000);
  const seed = await seedWindowedHistory();
  const measurements: Record<string, HistoryMeasurement[]> = {};
  try {
    for (const legacy of ['uncompressed', 'full', false] as const) {
      for (const warm of [true, false]) {
        const key = `${legacy ? `legacy-${legacy}` : 'windowed'}-${warm ? 'memory' : 'jsonl'}`;
        const runs: HistoryMeasurement[] = (measurements[key] = []);
        for (let run = 0; run < 10; run++) runs.push(await measureHistory(seed, warm, legacy));
      }
    }
    const memory = measurements['windowed-memory']!;
    const cold = measurements['windowed-jsonl']!;
    expect(percentile95(memory.map((run) => run.openMs))).toBeLessThanOrEqual(400);
    expect(percentile95(cold.map((run) => run.openMs - run.historyLoadMs))).toBeLessThanOrEqual(400);
    expect(percentile95(memory.map((run) => run.switchMs))).toBeLessThanOrEqual(150);
    expect(percentile95(memory.map((run) => run.pageMs!))).toBeLessThanOrEqual(300);
    const bytes = percentile95(memory.map((run) => run.bytes));
    const full = percentile95(measurements['legacy-uncompressed-memory']!.map((run) => run.bytes));
    expect(full).toBeGreaterThan(20_000_000);
    expect(bytes).toBeLessThan(3_000_000);
    expect(bytes).toBeLessThan(full * 0.1);
    expect(Math.min(...memory.map((run) => run.fps!))).toBeGreaterThanOrEqual(50);
    expect(percentile95(memory.map((run) => run.keypressMs!))).toBeLessThanOrEqual(100);
  } finally {
    console.log('history-performance', JSON.stringify(measurements));
    await info.attach('history-performance.json', {
      body: JSON.stringify(measurements, null, 2),
      contentType: 'application/json',
    });
    rmSync(seed.dataDir, { recursive: true, force: true });
    rmSync(seed.recordingsDir, { recursive: true, force: true });
    cleanupHeadlessProject(seed.project);
  }
});
