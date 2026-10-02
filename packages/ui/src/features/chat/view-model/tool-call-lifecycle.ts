import type { ToolCallStatus } from '@qlan-ro/mainframe-types';

export function projectToolLifecycle(status: ToolCallStatus | undefined) {
  return status === undefined ? undefined : { acpStatus: status };
}
