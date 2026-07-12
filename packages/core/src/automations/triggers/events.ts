// packages/core/src/automations/triggers/events.ts
//
// Task 22: event-trigger bindings. `session.finished` fires from a terminal
// `chat.updated` (the CLI process for that chat exited); `automation.finished`
// / `automation.failed` fire from `automation.completed`, filtered by status
// and an optional source-automation scope. AutomationService (Task 23) owns
// the daemon-event subscription and turns a match into `RunStore.createRun`.
import type { AutomationEventName, DaemonEvent } from '@qlan-ro/mainframe-types';

export interface EventTriggerBinding {
  automationId: string;
  triggerId: string;
  event: AutomationEventName;
  /** For automation.finished/automation.failed: only fire when the source automationId matches (unset = any). */
  automationFilter?: string;
}

/** Flat token bag frozen as the run's `trigger.payload` — resolved via `{stepId:'trigger', output:'result'|'chatId'}`. */
export interface EventTriggerTokens {
  result: string;
  chatId?: string;
}

export interface EventTriggerMatch {
  binding: EventTriggerBinding;
  tokens: EventTriggerTokens;
}

/**
 * Matches armed event-trigger bindings against one incoming daemon event.
 *
 * `isAgentOwnedChat` excludes chats currently tracked by an ask_agent wait
 * (`agent_waits`) from `session.finished`: that chat's completion already
 * drives its own ask_agent step via `AgentWaitService`, so treating it as a
 * fresh session-finished event too would double-fire.
 */
export function matchEventTriggers(
  bindings: EventTriggerBinding[],
  event: DaemonEvent,
  isAgentOwnedChat: (chatId: string) => boolean,
): EventTriggerMatch[] {
  if (event.type === 'chat.updated' && event.reason) {
    if (isAgentOwnedChat(event.chat.id)) return [];
    const tokens: EventTriggerTokens = { result: event.reason, chatId: event.chat.id };
    return bindings.filter((b) => b.event === 'session.finished').map((binding) => ({ binding, tokens }));
  }

  if (event.type === 'automation.completed') {
    const wanted: AutomationEventName = event.status === 'succeeded' ? 'automation.finished' : 'automation.failed';
    const tokens: EventTriggerTokens = { result: event.result };
    return bindings
      .filter(
        (b) => b.event === wanted && (b.automationFilter === undefined || b.automationFilter === event.automationId),
      )
      .map((binding) => ({ binding, tokens }));
  }

  return [];
}
