import type { PluginContext } from '@qlan-ro/mainframe-types';
import { CodexAdapter } from './adapter.js';

export function activate(ctx: PluginContext): void {
  const adapter = new CodexAdapter();
  ctx.adapters!.register(adapter);
  ctx.onUnload(() => adapter.killAll());
}
