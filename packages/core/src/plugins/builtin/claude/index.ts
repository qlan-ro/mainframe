import type { PluginContext } from '@mainframe/types';
import { ClaudeAdapter } from '../../../adapters/claude.js';

export function activate(ctx: PluginContext): void {
  const adapter = new ClaudeAdapter();
  ctx.adapters!.register(adapter);
  ctx.onUnload(() => adapter.killAll());
  ctx.logger.info('Claude CLI adapter registered');
}
