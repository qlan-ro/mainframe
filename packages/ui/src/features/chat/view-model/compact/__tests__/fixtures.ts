import type { CompactToolPart, IndexedPart } from '../types';

export function tool(overrides: Partial<CompactToolPart> = {}): CompactToolPart {
  return {
    type: 'tool-call',
    toolCallId: 'call',
    toolName: 'Read',
    args: { file_path: 'src/file.ts' },
    argsText: '',
    status: { type: 'complete' },
    ...overrides,
  };
}
export function indexed(index: number, overrides: Partial<CompactToolPart> = {}): IndexedPart {
  return { index, part: tool({ toolCallId: `call-${index}`, result: '', ...overrides }) };
}
