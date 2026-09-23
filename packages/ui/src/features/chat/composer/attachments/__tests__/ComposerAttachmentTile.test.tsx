/**
 * ComposerAttachmentTile — fixed-width sizing contract (todo #364).
 *
 * Before this fix the tile was `max-w-56` (content-driven, capped): a short
 * name like `image.png` rendered a narrow pill while a long name grew all the
 * way to the cap before truncating, so two pending attachments showed two
 * different pill widths. The fix makes the tile a fixed `w-56` regardless of
 * name length or attachment type — jsdom does no layout, so (mirroring
 * UserAttachments.test.tsx's B5 pattern) the regression contract is asserted
 * on the className, not a measured rect.
 *
 * Strategy: mock `@assistant-ui/react` so `ComposerPrimitive.Attachments`
 * invokes its render-prop child once per render (one tile per test) and
 * `useAuiState` reads from a mutable `{ attachment: { name, type } }`, exactly
 * as UserAttachments.test.tsx does for `MessagePrimitive.Attachments`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, within } from '@testing-library/react';

let __attachmentName = 'image.png';
let __attachmentType = 'image';

vi.mock('@assistant-ui/react', () => ({
  useAuiState: (selector: (s: { attachment: { name: string; type: string } }) => unknown) =>
    selector({ attachment: { name: __attachmentName, type: __attachmentType } }),
  ComposerPrimitive: {
    Attachments: ({ children }: { children: () => React.ReactNode }) => <>{children()}</>,
  },
  AttachmentPrimitive: {
    // `asChild` semantics aren't exercised here — AttachmentAction already
    // carries its own testid/aria-label; the Remove wrapper just needs to not
    // swallow its child.
    Remove: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  },
}));

vi.mock('@/components/ui/assistant-ui/attachment', () => ({
  useAttachmentSrc: () => undefined,
  AttachmentPreviewDialog: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { ComposerAttachments } from '../ComposerAttachmentStrip';

// Each call mounts into its own container and unmounts immediately after
// reading the tile's className — a test comparing two renders (short vs long
// name) would otherwise leave both mounted and `getByTestId` would find two.
function renderTileClassName(name: string, type: string): string {
  __attachmentName = name;
  __attachmentType = type;
  const { container, unmount } = render(<ComposerAttachments />);
  const tile = within(container).getByTestId('composer-attachment-tile');
  const className = tile.className;
  unmount();
  return className;
}

describe('ComposerAttachmentTile — fixed-width sizing contract (todo #364)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('a short image name gets the fixed w-56 width, not a content-driven max-w-56 cap', () => {
    const className = renderTileClassName('image.png', 'image');
    expect(className).toContain('w-56');
    expect(className).not.toContain('max-w-56');
  });

  it('a long image name gets the identical fixed-width class as the short one', () => {
    const shortClass = renderTileClassName('image.png', 'image');
    const longClass = renderTileClassName('Screenshot 2026-09-23 at 10.15.42 very long name.png', 'image');
    expect(longClass).toBe(shortClass);
  });

  it('a non-image file tile shares the same fixed-width class', () => {
    const imageClass = renderTileClassName('image.png', 'image');
    const fileClass = renderTileClassName('notes.md', 'file');
    expect(fileClass).toBe(imageClass);
  });
});
