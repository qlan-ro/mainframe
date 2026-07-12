/**
 * In-memory `AutomationsGateway`, seeded from the six canonical fixtures —
 * the Phase 0-5 dev backend (no live daemon routes needed until Phase 6).
 * Also exposes a scripted `onEvent` emitter so later phases (run view
 * polling, toast wiring) can be built and tested against synthetic
 * `automation.*` events before the real WS wiring lands.
 */
import type {
  ActionCatalogEntry,
  AutomationCreateInput,
  AutomationInteractionSummary,
  AutomationRunSummary,
  AutomationSummary,
  AutomationTimelineEntry,
  DaemonEvent,
} from '../contract';
import type { AutomationsGateway } from '../data/gateway';
import { ACTION_CATALOG_FIXTURE } from './action-catalog';
import { AUTOMATION_FIXTURES } from './fixtures';
import { buildDemoRuns } from './run-seeds';

type EventListener = (event: DaemonEvent) => void;

let seq = 0;
function nextId(prefix: string): string {
  seq += 1;
  return `${prefix}-${seq}`;
}

function notFound(kind: string, id: string): never {
  throw new Error(`${kind} "${id}" not found`);
}

export function createFixtureGateway(): AutomationsGateway {
  const definitions = new Map<string, AutomationSummary>();
  const runs = new Map<string, AutomationRunSummary>();
  const timelines = new Map<string, AutomationTimelineEntry[]>();
  const interactions = new Map<string, AutomationInteractionSummary>();
  const listeners = new Set<EventListener>();

  const now = () => Date.now();
  const emit = (event: DaemonEvent) => listeners.forEach((l) => l(event));

  for (const fixture of AUTOMATION_FIXTURES) {
    const id = nextId('automation');
    definitions.set(id, {
      id,
      name: fixture.name,
      description: fixture.description,
      scope: fixture.scope,
      projectId: fixture.projectId ?? null,
      enabled: true,
      definition: fixture.definition,
      createdAt: now(),
      updatedAt: now(),
    });
  }

  const demo = buildDemoRuns(Array.from(definitions.values()), nextId, now);
  for (const run of demo.runs) runs.set(run.id, run);
  for (const [runId, timeline] of demo.timelines) timelines.set(runId, timeline);
  for (const interaction of demo.interactions) interactions.set(interaction.id, interaction);

  return {
    onEvent(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    async listAutomations() {
      return Array.from(definitions.values());
    },

    async createAutomation(input: AutomationCreateInput) {
      const id = nextId('automation');
      const summary: AutomationSummary = {
        id,
        name: input.name,
        description: input.description,
        scope: input.scope,
        projectId: input.projectId ?? null,
        enabled: true,
        definition: input.definition,
        createdAt: now(),
        updatedAt: now(),
      };
      definitions.set(id, summary);
      return summary;
    },

    async getAutomation(id: string) {
      return definitions.get(id) ?? notFound('automation', id);
    },

    async updateAutomation(id: string, input: AutomationCreateInput) {
      const existing = definitions.get(id) ?? notFound('automation', id);
      const updated: AutomationSummary = {
        ...existing,
        name: input.name,
        description: input.description,
        scope: input.scope,
        projectId: input.projectId ?? null,
        definition: input.definition,
        updatedAt: now(),
      };
      definitions.set(id, updated);
      return updated;
    },

    async deleteAutomation(id: string) {
      if (!definitions.delete(id)) notFound('automation', id);
    },

    async setEnabled(id: string, enabled: boolean) {
      const existing = definitions.get(id) ?? notFound('automation', id);
      const updated = { ...existing, enabled, updatedAt: now() };
      definitions.set(id, updated);
      return updated;
    },

    async startRun(automationId: string) {
      if (!definitions.has(automationId)) notFound('automation', automationId);
      const id = nextId('run');
      const run: AutomationRunSummary = {
        id,
        automationId,
        status: 'running',
        trigger: { kind: 'manual' },
        startedAt: now(),
        finishedAt: null,
        error: null,
      };
      runs.set(id, run);
      timelines.set(id, []);
      emit({ type: 'automation.run.updated', run });
      return run;
    },

    async listRuns(automationId: string) {
      return Array.from(runs.values()).filter((r) => r.automationId === automationId);
    },

    async getRun(runId: string) {
      return runs.get(runId) ?? notFound('run', runId);
    },

    async getRunTimeline(runId: string) {
      if (!runs.has(runId)) notFound('run', runId);
      return timelines.get(runId) ?? [];
    },

    async cancelRun(runId: string) {
      const existing = runs.get(runId) ?? notFound('run', runId);
      const updated: AutomationRunSummary = { ...existing, status: 'cancelled', finishedAt: now() };
      runs.set(runId, updated);
      emit({ type: 'automation.run.updated', run: updated });
    },

    async listInteractions() {
      return Array.from(interactions.values());
    },

    async respondInteraction(id: string) {
      const existing = interactions.get(id) ?? notFound('interaction', id);
      const updated: AutomationInteractionSummary = { ...existing, status: 'answered', resolvedAt: now() };
      interactions.set(id, updated);
      emit({ type: 'automation.interaction.resolved', interactionId: id, runId: existing.runId });
    },

    async listActions(): Promise<ActionCatalogEntry[]> {
      return ACTION_CATALOG_FIXTURE;
    },

    async listCredentialLabels() {
      return [];
    },

    async putCredential() {
      /* fixture gateway keeps no credential state — the dev host never authenticates */
    },

    async deleteCredential() {
      /* fixture gateway keeps no credential state — the dev host never authenticates */
    },
  };
}
