import type { PluginContext } from '@qlan-ro/mainframe-types';
import { ClaudeSdkAdapter } from './adapter.js';

export function activate(ctx: PluginContext): void {
  const adapter = new ClaudeSdkAdapter();
  ctx.adapters!.register(adapter);
  ctx.onUnload(() => adapter.killAll());
  ctx.logger.info('Claude Agent SDK adapter registered');
}
