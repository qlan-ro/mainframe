/**
 * AutomationsGateway — every REST verb the Automations v2 UI needs (contract
 * §4), abstracted behind an interface so the store never cares whether it's
 * talking to the real daemon or the in-memory fixture gateway. `data/http-
 * gateway.ts` (Phase 6) implements this over `lib/api/automations.ts`;
 * `fixtures/fixture-gateway.ts` (this phase) implements it in-memory, seeded
 * from the six canonical fixtures, for development ahead of live routes.
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

export interface AutomationsGateway {
  /** Omitted/null returns every automation the caller can see; a projectId scopes the list to that project (contract: automations are project-scoped, todo #234 bullet 1). */
  listAutomations(projectId?: string | null): Promise<AutomationSummary[]>;
  createAutomation(input: AutomationCreateInput): Promise<AutomationSummary>;
  getAutomation(id: string): Promise<AutomationSummary>;
  updateAutomation(id: string, input: AutomationCreateInput): Promise<AutomationSummary>;
  deleteAutomation(id: string): Promise<void>;
  setEnabled(id: string, enabled: boolean): Promise<AutomationSummary>;

  startRun(id: string): Promise<AutomationRunSummary>;
  listRuns(id: string): Promise<AutomationRunSummary[]>;
  getRun(runId: string): Promise<AutomationRunSummary>;
  cancelRun(runId: string): Promise<void>;
  /**
   * The run's step-by-step timeline (contract §2's checkpoint `steps` map,
   * flattened to the array shape `AutomationTimelineEntry[]` already models
   * for exactly this purpose). Not part of `AutomationRunSummary` — the run
   * view fetches it separately, on demand, rather than every list call
   * paying for full step detail.
   */
  getRunTimeline(runId: string): Promise<AutomationTimelineEntry[]>;

  listInteractions(): Promise<AutomationInteractionSummary[]>;
  respondInteraction(id: string, response: Record<string, unknown>): Promise<void>;

  listActions(): Promise<ActionCatalogEntry[]>;

  listCredentialLabels(): Promise<string[]>;
  putCredential(label: string, token: string): Promise<void>;
  deleteCredential(label: string): Promise<void>;

  /**
   * Subscribe to the 5 `automation.*` DaemonEvent members. The fixture
   * gateway implements this as a synchronous local emitter; the Phase 6
   * `http-gateway.ts` wraps `daemonWs.onEvent` behind the same shape so
   * callers (`use-automation-toasts`) never care which backend is live.
   */
  onEvent(listener: (event: DaemonEvent) => void): () => void;
}
