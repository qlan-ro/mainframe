import { it, expect } from 'vitest';
import { formatCaptures } from '../format-captures';
import { parseSandboxCaptureBlock } from '@/features/chat/view-model/parse-captures';

it('format → parse round-trips labels, selectors, and annotations', () => {
  const { markdown, attachments } = formatCaptures([
    {
      id: '1',
      type: 'element',
      imageDataUrl: 'data:image/png;base64,AAAA',
      selector: 'button.primary',
      annotation: 'click me',
    },
    { id: '2', type: 'screenshot', imageDataUrl: 'data:image/png;base64,BBBB' },
  ]);
  expect(attachments).toHaveLength(2);
  expect(attachments[0]!.name).toBe('element1.png');
  expect(attachments[1]!.name).toBe('screenshot1.png');

  const parsed = parseSandboxCaptureBlock(markdown);
  expect(parsed).not.toBeNull();
  // The screenshot row must OMIT selector/annotation keys (not set them to undefined) —
  // parse-captures only sets them when matched, and toEqual distinguishes absent from undefined.
  expect(parsed!.rows).toEqual([
    { label: 'element1', imageName: 'element1.png', selector: 'button.primary', annotation: 'click me' },
    { label: 'screenshot1', imageName: 'screenshot1.png' },
  ]);
});

it('empty captures produce empty markdown + attachments', () => {
  expect(formatCaptures([])).toEqual({ markdown: '', attachments: [] });
});

it('attachment data is the raw base64 without the data-url prefix', () => {
  const { attachments } = formatCaptures([
    { id: '1', type: 'screenshot', imageDataUrl: 'data:image/png;base64,iVBORw0KGgo=' },
  ]);
  expect(attachments[0]!.data).toBe('iVBORw0KGgo=');
  expect(attachments[0]!.mediaType).toBe('image/png');
  expect(attachments[0]!.kind).toBe('image');
});

it('element and screenshot counters are independent', () => {
  const { attachments } = formatCaptures([
    { id: '1', type: 'element', imageDataUrl: 'data:image/png;base64,A' },
    { id: '2', type: 'screenshot', imageDataUrl: 'data:image/png;base64,B' },
    { id: '3', type: 'element', imageDataUrl: 'data:image/png;base64,C' },
  ]);
  expect(attachments.map((a) => a.name)).toEqual(['element1.png', 'screenshot1.png', 'element2.png']);
});

it('markdown starts with the sentinel', () => {
  const { markdown } = formatCaptures([{ id: '1', type: 'screenshot', imageDataUrl: 'data:image/png;base64,A' }]);
  expect(markdown.startsWith('\0__MF_SANDBOX_CAPTURE__')).toBe(true);
});
