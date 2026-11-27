/**
 * Stands in for `features/sessions/runtime/chat-controller-registry` in the rig: a sub-agent's pages
 * come from the synthetic pager. No chat controller exists otherwise (`get` finds none, as in the app
 * before a chat opens), and nothing connects to a daemon.
 */
import { agentPager } from '../agent-pager';

const controller = new Proxy(
  { subagentHistory: { page: (_agentId: string, before?: string, until?: string) => agentPager.page(before, until) } },
  { get: (target, name) => (name in target ? target[name as keyof typeof target] : () => undefined) },
);

export const chatControllerRegistry = {
  get: () => undefined,
  getOrCreate: () => controller,
  adopt: () => undefined,
  dispose: () => undefined,
  disposeAll: () => undefined,
};
export type ChatControllerRegistry = typeof chatControllerRegistry;
