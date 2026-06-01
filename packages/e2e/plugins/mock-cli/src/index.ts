import type { PluginContext } from '@qlan-ro/mainframe-types';
import { MockCliAdapter } from './adapter';

export function activate(ctx: PluginContext): void {
  ctx.adapters!.register(new MockCliAdapter());
  ctx.logger.info('Mock CLI adapter registered (E2E replay)');
}
