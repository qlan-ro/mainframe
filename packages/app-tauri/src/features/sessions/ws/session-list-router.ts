/**
 * SessionListRouter — maps daemon WS chat events to sessions-list actions.
 * Stub for TDD red phase. Full implementation in task 7.1.
 */
import type { DaemonEvent } from '@qlan-ro/mainframe-types';
import type { DaemonWsClient } from '../../../lib/daemon/ws-client';

export interface SessionListRouterDeps {
  onReload: () => void;
  onMarkUnread: (chatId: string) => void;
}

export class SessionListRouter {
  private readonly unsubscribe: () => void;

  constructor(ws: DaemonWsClient, _deps: SessionListRouterDeps) {
    this.unsubscribe = ws.onEvent((_event: DaemonEvent) => {
      // stub — intentionally not implemented yet
    });
  }

  dispose(): void {
    this.unsubscribe();
  }
}
