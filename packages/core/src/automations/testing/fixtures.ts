// packages/core/src/automations/testing/fixtures.ts
//
// Thin loader for the six canonical Automations v2 reference automations
// (contract §8). packages/types/fixtures/automations/*.json is the
// cross-language tie-breaker artifact — Node, Rust, and the UI all load
// these files by relative path rather than each authoring their own.
// Test-only: not compiled into the package build.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { AutomationDefinition } from '@qlan-ro/mainframe-types';

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../../../types/fixtures/automations');

export type FixtureName =
  | 'daily-health-log'
  | 'daily-standup'
  | 'pr-auto-review'
  | 'morning-pr-sweep'
  | 'ship-work'
  | 'daily-feature-spike';

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
