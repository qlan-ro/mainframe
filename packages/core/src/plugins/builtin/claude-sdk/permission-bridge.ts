import { nanoid } from 'nanoid';
import type { ControlRequest, ControlResponse, ControlUpdate, SessionSink } from '@qlan-ro/mainframe-types';

interface CanUseToolOptions {
  signal: AbortSignal;
  suggestions?: PermissionUpdate[];
  toolUseID: string;
  agentID?: string;
  decisionReason?: string;
  title?: string;
  displayName?: string;
  description?: string;
  blockedPath?: string;
}

type PermissionUpdate = ControlUpdate;

type PermissionResult =
  | {
      behavior: 'allow';
      updatedInput?: Record<string, unknown>;
      updatedPermissions?: PermissionUpdate[];
      toolUseID?: string;
    }
  | {
      behavior: 'deny';
      message: string;
      interrupt?: boolean;
      toolUseID?: string;
    };

interface PendingPermission {
  resolve: (result: PermissionResult) => void;
}

export class PermissionBridge {
  private pending = new Map<string, PendingPermission>();

  constructor(private readonly sink: SessionSink) {}

  canUseTool(toolName: string, input: Record<string, unknown>, options: CanUseToolOptions): Promise<PermissionResult> {
    const requestId = nanoid();

    const request: ControlRequest = {
      requestId,
      toolName,
      toolUseId: options.toolUseID,
      input,
      suggestions: (options.suggestions ?? []) as ControlUpdate[],
      decisionReason: options.decisionReason,
    };

    return new Promise<PermissionResult>((resolve) => {
      this.pending.set(requestId, { resolve });
      this.sink.onPermission(request);
    });
  }

  resolve(response: ControlResponse): void {
    const entry = this.pending.get(response.requestId);
    if (!entry) return;
    this.pending.delete(response.requestId);

    if (response.behavior === 'allow') {
      entry.resolve({
        behavior: 'allow',
        updatedInput: response.updatedInput,
        updatedPermissions: response.updatedPermissions as PermissionUpdate[] | undefined,
        toolUseID: response.toolUseId,
      });
    } else {
      entry.resolve({
        behavior: 'deny',
        message: response.message ?? 'User denied permission',
        interrupt: true,
        toolUseID: response.toolUseId,
      });
    }
  }

  rejectAll(): void {
    for (const [, entry] of this.pending) {
      entry.resolve({ behavior: 'deny', message: 'Session terminated', interrupt: true });
    }
    this.pending.clear();
  }
}
