import { expect, it, vi } from 'vitest';
import { normalizeNativeMessage } from '../../view-model/normalize-native-messages';
import { transcriptMarkdown } from '../transcript-markdown';

it('includes full saved child Markdown in transcript order', async () => {
  const messages = [
    normalizeNativeMessage({ role: 'user', content: 'Parent prompt' }),
    normalizeNativeMessage({
      role: 'assistant',
      content: [
        { type: 'text', text: 'Before' },
        {
          type: 'tool-call',
          toolCallId: 'saved-child',
          toolName: 'Task',
          providerMetadata: { mainframe: { subagentFact: { status: 'completed' } } },
          messages: [normalizeNativeMessage({ role: 'assistant', content: 'Partial child copy' })],
        },
        { type: 'text', text: 'After' },
      ],
    }),
  ];
  const exportChild = vi.fn().mockResolvedValue('Older step\n\nChild answer');
  await expect(transcriptMarkdown(messages, exportChild)).resolves.toBe(
    'Parent prompt\n\nBefore\n\nOlder step\n\nChild answer\n\nAfter',
  );
  expect(exportChild).toHaveBeenCalledExactlyOnceWith('saved-child');
});
