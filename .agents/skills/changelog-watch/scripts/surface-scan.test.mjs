/**
 * The chunk-boundary gate. Real scans use 16MB chunks over a ~350MB build, so
 * a match straddling a boundary is certain; tiny chunks here put a boundary
 * at every offset of the match.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { scanFile } from './surface-scan.mjs';

const FLAG = '.option("--resume-session-at <message id>","When resuming")';

function writeTemp(content) {
  const file = path.join(mkdtempSync(path.join(os.tmpdir(), 'surface-scan-test-')), 'build.bin');
  writeFileSync(file, content);
  return file;
}

test('a match split across chunks is recorded whole, never truncated', async () => {
  // Shift the flag across every byte offset of a 7-byte chunk grid.
  for (let shift = 0; shift < 7; shift++) {
    const file = writeTemp(`${'\u0000'.repeat(2000 + shift)}${FLAG}${'\u0000'.repeat(2000)}`);
    const sets = await scanFile(file, { chunkBytes: 7 });
    assert.deepEqual([...sets.flags], ['--resume-session-at'], `shift ${shift}`);
  }
});

test('a match in the final tail is still recorded', async () => {
  const file = writeTemp(`${'\u0000'.repeat(5000)}{type:"local",name:"project",x}`);
  const sets = await scanFile(file, { chunkBytes: 1024 });
  assert.deepEqual([...sets.commands], ['project']);
});

test('a file shorter than the overlap is scanned in full', async () => {
  const sets = await scanFile(writeTemp('subtype:"ui_notify"'));
  assert.deepEqual([...sets.subtypes], ['ui_notify']);
});
