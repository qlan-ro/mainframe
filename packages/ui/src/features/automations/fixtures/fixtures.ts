/**
 * Loads the six canonical, Node-owned reference automations (contract §8).
 * Single author = Node Phase 0 — this module only LOADS
 * `packages/types/fixtures/automations/*.json`, never authors or diverges
 * from them. Fixture 6 (`daily-feature-spike`) is the sole carrier
 * exercising A1 (`run_command` preview), A2 (`ask_agent.expects`), and A3
 * (`is_one_of`) — every A1/A2/A3 domain test is keyed off it.
 *
 * JSON imports cross the package boundary via a filesystem-relative path
 * (not the `@qlan-ro/mainframe-types` package specifier — its `exports` map
 * only publishes `.`, and fixtures aren't part of the published surface);
 * `resolveJsonModule` is enabled in this package's tsconfig for exactly
 * this import.
 */
import type { AutomationCreateInput } from '../contract';
import dailyHealthLog from '../../../../../types/fixtures/automations/daily-health-log.json';
import dailyStandup from '../../../../../types/fixtures/automations/daily-standup.json';
import prAutoReview from '../../../../../types/fixtures/automations/pr-auto-review.json';
import morningPrSweep from '../../../../../types/fixtures/automations/morning-pr-sweep.json';
import shipWork from '../../../../../types/fixtures/automations/ship-work.json';
import dailyFeatureSpike from '../../../../../types/fixtures/automations/daily-feature-spike.json';

export const FEATURE_SPIKE_FIXTURE = dailyFeatureSpike as unknown as AutomationCreateInput;

export const AUTOMATION_FIXTURES: AutomationCreateInput[] = [
  dailyHealthLog as unknown as AutomationCreateInput,
  dailyStandup as unknown as AutomationCreateInput,
  prAutoReview as unknown as AutomationCreateInput,
  morningPrSweep as unknown as AutomationCreateInput,
  shipWork as unknown as AutomationCreateInput,
  FEATURE_SPIKE_FIXTURE,
];
