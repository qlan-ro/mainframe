/** A pending file or image (C14): its tile's name, detail, lead and controls. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';

let attachment: { name: string; type: string; file?: { size: number } };
let src: string | undefined;

vi.mock('@assistant-ui/react', () => ({
  useAuiState: (selector: (s: unknown) => unknown) => selector({ attachment, threadListItem: { id: 't1' } }),
  ComposerPrimitive: {
    Attachments: ({ children }: { children: () => React.ReactNode }) => <>{children()}</>,
  },
  AttachmentPrimitive: { Remove: ({ children }: { children: React.ReactNode }) => <>{children}</> },
}));
vi.mock('@/components/ui/assistant-ui/attachment', () => ({
  useAttachmentSrc: () => src,
  AttachmentPreviewDialog: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { ComposerAttachments } from '../ComposerAttachmentStrip';

const images: { onload?: () => void; naturalWidth: number; naturalHeight: number }[] = [];
class FakeImage {
  onload?: () => void;
  src = '';
  naturalWidth = 1280;
  naturalHeight = 800;
  constructor() {
    images.push(this);
  }
}

const tile = (next: typeof attachment, imageSrc?: string) => {
  attachment = next;
  src = imageSrc;
  render(
    <TooltipProvider>
      <ComposerAttachments />
    </TooltipProvider>,
  );
  return screen.getByTestId('composer-attachment-tile');
};

beforeEach(() => {
  images.length = 0;
  vi.stubGlobal('Image', FakeImage);
});
afterEach(() => vi.unstubAllGlobals());

describe('a file', () => {
  it('shows its extension, name and size', () => {
    const el = tile({ name: 'quota-trace.log', type: 'document', file: { size: 14 * 1024 } });
    expect(el).toHaveTextContent('log');
    expect(el).toHaveTextContent('quota-trace.log');
    expect(el).toHaveTextContent('14 KB');
    expect(screen.queryByTestId('composer-attachment-preview')).toBeNull();
  });

  it('cuts a long extension to four letters', () => {
    expect(tile({ name: 'a.properties', type: 'document' }).querySelector('[aria-hidden]')).toHaveTextContent(/^prop$/);
  });

  it('has no extension to show for a name without one', () => {
    const el = tile({ name: 'Makefile', type: 'document', file: { size: 2048 } });
    expect(el.querySelector('[aria-hidden] svg')).not.toBeNull();
    expect(el).toHaveTextContent('2 KB');
  });

  it('says what it is when the size is unknown', () => {
    expect(tile({ name: 'notes.md', type: 'document' })).toHaveTextContent('Markdown');
  });
});

describe('an image', () => {
  it('shows its thumbnail, dimensions and size, and opens', async () => {
    const el = tile({ name: 'capsule.png', type: 'image', file: { size: 88 * 1024 } }, 'blob:1');
    expect(el.querySelector('img')).toHaveAttribute('src', 'blob:1');
    expect(el).toHaveTextContent('88 KB');
    act(() => images[0]!.onload!());
    await waitFor(() => expect(el).toHaveTextContent('1280×800 · 88 KB'));
    expect(screen.getByRole('button', { name: 'Preview capsule.png' })).toBeInTheDocument();
  });
});

it('can be removed', () => {
  tile({ name: 'a.ts', type: 'document' });
  expect(screen.getByRole('button', { name: 'Remove a.ts' })).toBeInTheDocument();
});

it('is the same size whatever it holds', () => {
  const short = tile({ name: 'a.ts', type: 'document' }).className;
  document.body.innerHTML = '';
  const long = tile({ name: 'Screenshot 2026-09-23 at 10.15.42 very long.png', type: 'image' }, 'blob:2').className;
  expect(long).toBe(short);
  expect(short).toContain('w-43');
  expect(short).toContain('h-10');
});
