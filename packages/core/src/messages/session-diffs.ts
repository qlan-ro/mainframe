import type { ChatMessage } from '@qlan-ro/mainframe-types';

export interface SessionFileDiff {
  filePath: string;
  original: string | null;
  modified: string;
  status: 'added' | 'modified';
}

const FILE_TOOLS = new Set(['Write', 'Edit']);

export function extractSessionDiffs(messages: ChatMessage[]): SessionFileDiff[] {
  const toolUseMap = new Map<string, string>();
  const firstOriginal = new Map<string, string | null>();
  const lastModified = new Map<string, string>();

  for (const message of messages) {
    for (const block of message.content) {
      if (block.type === 'tool_use' && FILE_TOOLS.has(block.name)) {
        const filePath = (block.input as Record<string, unknown>).file_path as string | undefined;
        if (filePath) toolUseMap.set(block.id, filePath);
      }

      if (block.type === 'tool_result' && !block.isError) {
        const filePath = toolUseMap.get(block.toolUseId);
        if (!filePath) continue;
        const modified = (block as Record<string, unknown>).modifiedFile as string | undefined;
        if (modified === undefined) continue;

        if (!firstOriginal.has(filePath)) {
          const original = (block as Record<string, unknown>).originalFile as string | undefined;
          firstOriginal.set(filePath, original ?? null);
        }
        lastModified.set(filePath, modified);
      }
    }
  }

  const results: SessionFileDiff[] = [];
  for (const [filePath, modified] of lastModified) {
    const original = firstOriginal.get(filePath) ?? null;
    results.push({
      filePath,
      original,
      modified,
      status: original === null ? 'added' : 'modified',
    });
  }
  return results;
}
