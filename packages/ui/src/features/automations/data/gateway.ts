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
} from '../contract';

export interface AutomationsGateway {
  listAutomations(): Promise<AutomationSummary[]>;
  createAutomation(input: AutomationCreateInput): Promise<AutomationSummary>;
  getAutomation(id: string): Promise<AutomationSummary>;
  updateAutomation(id: string, input: AutomationCreateInput): Promise<AutomationSummary>;
  deleteAutomation(id: string): Promise<void>;
  setEnabled(id: string, enabled: boolean): Promise<AutomationSummary>;

  startRun(id: string): Promise<AutomationRunSummary>;
  listRuns(id: string): Promise<AutomationRunSummary[]>;
  getRun(runId: string): Promise<AutomationRunSummary>;
  cancelRun(runId: string): Promise<void>;

  listInteractions(): Promise<AutomationInteractionSummary[]>;
  respondInteraction(id: string, response: Record<string, unknown>): Promise<void>;

  listActions(): Promise<ActionCatalogEntry[]>;

  listCredentialLabels(): Promise<string[]>;
  putCredential(label: string, token: string): Promise<void>;
  deleteCredential(label: string): Promise<void>;
}
