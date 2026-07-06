import type { MessageContent, DiffHunk } from '@qlan-ro/mainframe-types';

export function deriveModifiedFile(
  tur: Record<string, unknown> | undefined,
  originalFile: string | undefined,
): string | undefined {
  if (!tur) return undefined;
  if (typeof tur.content === 'string' && (tur.type === 'create' || tur.type === 'update')) {
    return tur.content;
  }
  if (originalFile && typeof tur.oldString === 'string') {
    const oldStr = tur.oldString;
    const newStr = (tur.newString as string) ?? '';
    return tur.replaceAll ? originalFile.split(oldStr).join(newStr) : originalFile.replace(oldStr, newStr);
  }
  return undefined;
}

export function extractToolResultContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const texts: string[] = [];
    for (const block of content) {
      if (typeof block === 'object' && block !== null && 'text' in block && typeof block.text === 'string') {
        texts.push(block.text);
      }
    }
    if (texts.length > 0) return texts.join('\n');
  }
  return JSON.stringify(content ?? '');
}

export function buildToolResultBlocks(
  message: Record<string, unknown>,
  tur: Record<string, unknown> | undefined,
): MessageContent[] {
  const rawContent = message.content;
  if (!Array.isArray(rawContent)) return [];

  const sp = tur?.structuredPatch as DiffHunk[] | undefined;
  const originalFile = tur?.originalFile as string | undefined;
  const modifiedFile = deriveModifiedFile(tur, originalFile);

  const blocks: MessageContent[] = [];
  for (const block of rawContent) {
    if (block.type !== 'tool_result') continue;
    blocks.push({
      type: 'tool_result',
      toolUseId: (block.tool_use_id as string) || '',
      content: extractToolResultContent(block.content),
      isError: !!block.is_error,
      ...(sp?.length ? { structuredPatch: sp } : {}),
      ...(originalFile != null ? { originalFile } : {}),
      ...(modifiedFile != null ? { modifiedFile } : {}),
    });
  }
  return blocks;
}
