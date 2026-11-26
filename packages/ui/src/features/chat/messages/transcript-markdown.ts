import type { ThreadMessage } from '@assistant-ui/react';
import type { AcpChatController } from '../controller/acp-chat-controller';
import { subagentFact } from '../view-model/subagent-facts';
import { normalizeNativeMessage } from '../view-model/normalize-native-messages';

export function downloadMarkdown(content: string, name: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/markdown' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `${name}-${Date.now()}.md`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 40_000);
}

export async function transcriptMarkdown(
  messages: readonly ThreadMessage[],
  exportChild: (id: string) => Promise<string>,
): Promise<string> {
  const sections: string[] = [];
  for (const message of messages) {
    for (const part of message.content) {
      if (part.type === 'text') sections.push(part.text);
      if (part.type !== 'tool-call') continue;
      if (subagentFact(part)) sections.push(await exportChild(part.toolCallId));
      else if (part.messages?.length) sections.push(await transcriptMarkdown(part.messages, exportChild));
    }
  }
  return sections.filter(Boolean).join('\n\n');
}

export async function exportConversation(controller: AcpChatController): Promise<string> {
  await controller.load();
  if (controller.getState().loadState.type !== 'ready') throw new Error('Chat history is unavailable');
  let history = controller.getState().historyWindow;
  while (history?.hasMore) {
    if (!(await controller.loadEarlier())) throw new Error('Could not load earlier messages');
    const next = controller.getState().historyWindow;
    if (next?.hasMore && next.floorItemId === history.floorItemId) throw new Error('History did not advance');
    history = next;
  }
  return transcriptMarkdown(controller.getState().messages.map(normalizeNativeMessage), (id) =>
    controller.subagentHistory.export(id),
  );
}
