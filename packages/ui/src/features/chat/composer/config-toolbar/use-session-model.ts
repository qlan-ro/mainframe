import type { AdapterInfo, Chat, ProviderConfig } from '@qlan-ro/mainframe-types';
import type { ChatThreadState } from '../../controller/chat-thread-state';
import { resolveModel, selectedModel, withCliModel } from '@/lib/cli-model';
import { useCliModel } from '@/lib/use-cli-model';

export function useSessionModel(
  port: number | null,
  catalog: AdapterInfo | null,
  chat: Chat | null,
  state: ChatThreadState | undefined,
  provider?: ProviderConfig,
  draft?: { cliModel?: string },
) {
  const selectedId = chat?.model || provider?.defaultModel || undefined;
  const inherited = !selectedId || selectedId === 'default';
  const cliModel = useCliModel(
    port,
    draft && (!inherited || draft.cliModel) ? undefined : catalog?.id,
    chat?.projectId,
    draft ? undefined : chat?.id,
    JSON.stringify([
      selectedId,
      chat?.claudeSessionId,
      chat?.worktreePath,
      chat?.processState,
      state?.runState?.type,
      state?.loadState?.type,
    ]),
  );
  const adapter = catalog ? withCliModel(catalog, inherited ? (draft?.cliModel ?? cliModel) : null) : null;
  const model = chat ? selectedModel(adapter, selectedId) : null;
  const runningModel = !draft && cliModel ? resolveModel(catalog, cliModel) : null;
  return { adapter, model, runningModel };
}
