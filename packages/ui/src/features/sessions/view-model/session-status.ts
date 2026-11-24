/**
 * The one status a sidebar row can show, from what the daemon reports.
 *
 * `needs-you` outranks `running`: a parent can be mid-turn while its side chat
 * or a delegated task is the thing waiting on the user, and the daemon already
 * lets the chat's own gate (permission, question, plan) win over its turn.
 *
 * `running` is `displayStatus`, not `isRunning`: the daemon keeps it on while
 * sub-agents, delegated tasks or background work outlive the turn (L3).
 */
import type { SessionCustom } from './chat-to-thread-custom';

export type SessionStatus = 'needs-you' | 'running' | 'idle';

export function sessionStatus(custom: SessionCustom): SessionStatus {
  if (custom.hasPending || custom.sideChatWaiting || custom.delegatedWaiting) return 'needs-you';
  return custom.displayStatus === 'working' ? 'running' : 'idle';
}
