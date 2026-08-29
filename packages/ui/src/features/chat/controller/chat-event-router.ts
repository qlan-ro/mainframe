/**
 * Daemon-event routing — the controller's side-effect dispatch for a single
 * SIDE-BAND daemon event, extracted so the controller stays under the
 * 300-line limit. The transcript/run/gate planes live on the ACP facade
 * (`acp-session-plane.ts`), not here.
 *
 * Owns NO state. It mirrors live chat.updated into the composer config,
 * surfaces trust/run-failure toasts, and runs the pure `handleDaemonEvent`
 * mapper. Transcript clearing arrives on the facade
 * (`_mainframe.dev/transcript_cleared`, handled by the session plane), not
 * here.
 */
import type { DaemonEvent } from '@qlan-ro/mainframe-types';
import { mfToast } from '@/lib/toast';
import { trustWorkspace } from '@/lib/api/chats';
import type { ChatStateEvent } from './chat-thread-state';
import { handleDaemonEvent } from './handle-daemon-event';

export interface DaemonEventRouterHost {
  /** The daemon chat id at routing time (read lazily — it can flip via setRemoteId). */
  getChatId: () => string;
  /** Apply a state event through the reducer. */
  dispatch: (event: ChatStateEvent) => void;
}

export function routeDaemonEvent(event: DaemonEvent, host: DaemonEventRouterHost): void {
  // subscribe:ack is consumed by ChatWsSubscription before it reaches here, so
  // routing only sees real daemon events (ack-gating lives in the helper now).
  const chatId = host.getChatId();

  // Keep the composer config (model/plan/permission/effort/features) live:
  // mirror the daemon's chat metadata into state so the toolbar reflects
  // daemon-side changes (e.g. the agent exiting plan mode). This is additive —
  // handleDaemonEvent below still maps chat.updated → run.started/stopped.
  if (event.type === 'chat.updated' && event.chat.id === chatId) {
    host.dispatch({ type: 'chat.config.updated', chat: event.chat });
    // Server-authoritative resync of the live background set: enrichChat stamps
    // `backgroundActivity` on every broadcast, so a missed background_task.*
    // event self-heals at the next turn boundary. Absent field = nothing live.
    host.dispatch({ type: 'background.snapshot', tasks: event.chat.backgroundActivity?.tasks ?? [] });
  }

  // Non-fatal: the CLI reported the workspace is untrusted. Surface an actionable
  // permission toast (NOT a run failure) whose Trust action fixes it server-side.
  if (event.type === 'chat.trustRequired' && event.chatId === chatId) {
    mfToast.permission('Workspace not trusted', {
      description:
        `Claude ignored the permission rules in ${event.projectPath} because the workspace ` +
        `isn't trusted yet. Trust it to apply them and silence this notice.`,
      action: { label: 'Trust', onClick: () => void trustWorkspace(0, chatId) },
    });
    return;
  }

  // A daemon run error (e.g. the CLI process failed to start) otherwise only
  // flips runState to 'error' — silent to the user. Surface the message so the
  // reason is visible (chatId is optional: undefined = global/current run).
  if (event.type === 'error' && (event.chatId === undefined || event.chatId === chatId)) {
    const description = typeof event.error === 'string' ? event.error : undefined;
    mfToast.error('Agent run failed', description !== undefined ? { description } : undefined);
  }

  const result = handleDaemonEvent(event, chatId);
  if (result.kind === 'event') {
    host.dispatch(result.event);
  }
}
