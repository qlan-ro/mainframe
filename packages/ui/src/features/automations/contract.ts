/**
 * Automations v2 — the UI's single import surface for wire types.
 *
 * The plan's original TEMP-mirror step (duplicate the shapes locally, then
 * swap to `@qlan-ro/mainframe-types` in Phase 6) is obsolete: the Node lane
 * already landed the canonical types there (see
 * docs/plans/2026-07-12-automations-v2-contract.md §1). This file is a thin,
 * intentional re-export — every automations UI module imports from here,
 * never from `@qlan-ro/mainframe-types` directly, so a future reshuffle of
 * the upstream package only touches this one file.
 */
export { TOKEN_STEP_TRIGGER, TOKEN_STEP_BUILTIN, TOKEN_STEP_CURRENT } from '@qlan-ro/mainframe-types';
export type {
  TokenRef,
  ChipPart,
  ChipText,
  AutomationExpectedOutput,
  AskAgentStep,
  AutomationFormField,
  AskMeStep,
  RunActionStep,
  NotifyStep,
  Comparator,
  ConditionRow,
  IfBlock,
  RepeatBlock,
  AutomationStep,
  SchedulePattern,
  ScheduleTrigger,
  AutomationEventName,
  EventTrigger,
  WebhookTrigger,
  AutomationTrigger,
  AutomationDefinition,
  AutomationScope,
  AutomationSummary,
  AutomationCreateInput,
  AutomationRunStatus,
  AutomationRunTriggerKind,
  AutomationRunSummary,
  AutomationStepStatus,
  AutomationTimelineEntry,
  AutomationInteractionStatus,
  AutomationInteractionSummary,
  ActionOutputType,
  ActionCatalogEntry,
  DaemonEvent,
} from '@qlan-ro/mainframe-types';
