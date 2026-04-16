import type { ChatMessage } from '@qlan-ro/mainframe-types';

const FILE_TOOLS = new Set(['Write', 'Edit']);

/** Extract deduplicated file paths from Write/Edit tool_use blocks in messages. */
export function extractSessionFilePaths(messages: ChatMessage[]): string[] {
  const seen = new Set<string>();
  const paths: string[] = [];

  for (const message of messages) {
    for (const block of message.content) {
      if (block.type !== 'tool_use' || !FILE_TOOLS.has(block.name)) continue;
      const filePath = (block.input as Record<string, unknown>)?.file_path as string | undefined;
      if (filePath && !seen.has(filePath)) {
        seen.add(filePath);
        paths.push(filePath);
      }
    }
  }

  return paths;
}
