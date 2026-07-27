// packages/core/src/automations/testing/fixtures.ts
//
// Thin loader for the canonical Automations v2 reference automations
// (contract §8). packages/types/fixtures/automations/*.json is the
// cross-language tie-breaker artifact — Node, Rust, and the UI all load
// these files by relative path rather than each authoring their own.
// Test-only: not compiled into the package build.
//
// The 7th fixture (`release-digest`) is deliberately absent from FixtureName:
// this daemon is retired, and its zod schema predates `set_variable` and the
// `once` schedule, so it would reject the file. Rust and the UI carry it.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { AutomationDefinition } from '@qlan-ro/mainframe-types';

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../../../types/fixtures/automations');

export type FixtureName =
  'daily-health-log' | 'daily-standup' | 'pr-auto-review' | 'morning-pr-sweep' | 'ship-work' | 'daily-feature-spike';

interface FixtureFile {
  name: string;
  description?: string;
  scope: 'global' | 'project';
  definition: AutomationDefinition;
}

export function loadFixture(name: FixtureName): AutomationDefinition {
  const raw = readFileSync(join(FIXTURES_DIR, `${name}.json`), 'utf-8');
  return (JSON.parse(raw) as FixtureFile).definition;
}
