// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { getAttachment } from '@/lib/api/attachments';
import { mfToast } from '@/lib/toast';
import { moveQueuedToComposer } from '../move-queued-to-composer';
import type { DraftComposer } from '../../unsent/restore-draft';

vi.mock('@/lib/api/attachments', () => ({ getAttachment: vi.fn() }));
vi.mock('@/lib/toast', () => ({ mfToast: { error: vi.fn() } }));
vi.mock('../../focus-composer', () => ({ focusVisibleComposer: vi.fn() }));

it('appends queued text and reports a failed file while adding the others', async () => {
  vi.mocked(getAttachment).mockImplementation(
    async (_port, _chat, id) =>
      ({
        name: id + '.txt',
        data: 'YQ==',
        mediaType: 'text/plain',
      }) as Awaited<ReturnType<typeof getAttachment>>,
  );
  const composer = {
    getState: () => ({ text: 'Existing draft' }),
    setText: vi.fn(),
    addAttachment: vi.fn(async (file: Parameters<DraftComposer['addAttachment']>[0]) => {
      if (file.name === 'bad.txt') throw new Error('Cannot read file');
    }),
  };

  await moveQueuedToComposer(composer, 1, 'chat', 'Queued text', ['bad', 'good']);

  expect(composer.setText).toHaveBeenCalledWith('Existing draft\n\nQueued text');
  expect(composer.addAttachment.mock.calls.map(([file]) => file.name)).toEqual(['bad.txt', 'good.txt']);
  expect(mfToast.error).toHaveBeenCalledWith('Could not copy some queued attachments', {
    description: 'bad.txt',
  });
});
