import type { ToolCallMessagePart } from '@assistant-ui/react';

export function complexText(index: number) {
  const code = Array.from(
    { length: 30 },
    (_, i) => `const row${i} = { index: ${i}, label: "Transcript benchmark ${index}" };`,
  ).join('\n');
  return `## Answer ${index}\n\n${'Long response with **formatting** and a [reference](https://example.test). '.repeat(12)}\n\n\`\`\`typescript\n${code}\n\`\`\`\n\n| Change | Evidence | Result |\n| --- | --- | --- |\n${Array.from({ length: 8 }, (_, i) => `| ${i} | ${'Evidence wraps across columns. '.repeat(4)} | Pass |`).join('\n')}`;
}

export function complexTools(index: number): ToolCallMessagePart[] {
  return [
    readTool(index),
    {
      type: 'tool-call',
      toolCallId: `agent-${index}`,
      toolName: 'Task',
      args: { subagent_type: 'explorer', description: `Inspect module ${index}` },
      argsText: '{}',
      result: 'Nested agent completed',
      providerMetadata: { mainframe: { acpStatus: 'completed' } },
      messages: [
        {
          id: `child-${index}`,
          role: 'assistant',
          createdAt: new Date(0),
          content: [{ type: 'text', text: 'Nested transcript content. '.repeat(50) }, readTool(`child-${index}`)],
          status: { type: 'complete', reason: 'stop' },
          metadata: { unstable_state: null, unstable_annotations: [], unstable_data: [], steps: [], custom: {} },
        },
      ],
    },
  ];
}

function readTool(index: number | string): ToolCallMessagePart {
  return {
    type: 'tool-call',
    toolCallId: `read-${index}`,
    toolName: 'Read',
    args: { file_path: `/src/long-${index}.ts` },
    argsText: '{}',
    result: 'const example = "long tool output";\n'.repeat(100),
    providerMetadata: { mainframe: { acpStatus: 'completed' } },
  };
}
