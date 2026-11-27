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
      if (subagentFact(part)) {
        try {
          sections.push((await exportChild(part.toolCallId)) || 'Sub-agent transcript unavailable');
        } catch {
          sections.push('Sub-agent transcript unavailable');
        }
      } else if (part.messages?.length) sections.push(await transcriptMarkdown(part.messages, exportChild));
    }
  }
  return sections.filter(Boolean).join('\n\n');
}

export async function exportConversation(controller: AcpChatController): Promise<string> {
  await controller.load();
  if (controller.getState().loadState.type !== 'ready') throw new Error('Chat history is unavailable');
  // The live window, even while the reader is in a window around a jump target.
  let history = controller.liveHistory;
  while (history.hasMore) {
    if (!(await controller.loadEarlierLive())) throw new Error('Could not load earlier messages');
    const next = controller.liveHistory;
    if (next.hasMore && next.floorItemId === history.floorItemId) throw new Error('History did not advance');
    history = next;
  }
  return transcriptMarkdown(controller.getState().messages.map(normalizeNativeMessage), (id) =>
    controller.subagentHistory.export(id),
  );
}
