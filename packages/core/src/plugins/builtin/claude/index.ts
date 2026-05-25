import type { PluginContext } from '@qlan-ro/mainframe-types';
import { ClaudeAdapter } from './adapter.js';
import type { BackgroundTaskTracker } from '../../../background-tasks/tracker.js';

export function activate(ctx: PluginContext, backgroundTasks: BackgroundTaskTracker): void {
  const adapter = new ClaudeAdapter(backgroundTasks);
  ctx.adapters!.register(adapter);
  ctx.onUnload(() => adapter.killAll());
  ctx.logger.info('Claude Code adapter registered');
}
