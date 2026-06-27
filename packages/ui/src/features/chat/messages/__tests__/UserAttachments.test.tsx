/**
 * UserAttachments — behavior tests for FilePill and ImageAttachment rendering.
 *
 * Strategy:
 *  - Mock `@assistant-ui/react` so `useAuiState` receives a synthetic state
 *    shaped as `{ attachment: { name, type } }`. Both selectors
 *    (`s.attachment.name` and `s.attachment.type`) read from the same mutable
 *    object, controlled per-test.
 *  - `MessagePrimitive.Attachments` is stubbed to invoke the render-prop child
 *    once (one tile per test), using the current mutable attachment state.
 *  - `useMainframeMeta` from the view-model is stubbed to return `__meta`, a
 *    mutable object controlled per-test.
 *  - `@/components/ui/assistant-ui/attachment` is stubbed:
 *      - `useAttachmentSrc` returns `__src` (mutable string, default '').
 *      - `AttachmentPreviewDialog` is a passthrough wrapper.
 *  - All assertions are against hardcoded values; no component logic is
 *    recomputed here.
 *
 * Behaviors covered:
 *  B1 — known extension (tsx) + matching preview with sizeBytes renders the
 *       correct type label and formatted KB size in the subline.
 *  B2 — known extension (md) with NO matching preview renders just the type
 *       label in the subline (no "·", no size).
 *  B3 — unknown extension (.bin) with no preview renders ".bin" in the tile
 *       and "File" as the subline.
 *  B4 — large file (>= 1MB) renders the size in MB notation.
 *  B5 — image attachment with matching capture row renders thumb + selector text.
 *  B6 — image attachment with no selector/annotation renders thumb only.
 *  B7 — image attachment with no matching capture renders thumb, no crash.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { MainframeMessageMeta } from '../../view-model/message-meta';

// ---------------------------------------------------------------------------
// Mock @assistant-ui/react
// ---------------------------------------------------------------------------

// Both `useAuiState` calls in the component read from `s.attachment`:
//   (s) => s.attachment.type   — in MessageAttachmentTile
//   (s) => s.attachment.name   — in MessageAttachmentTile / FilePill
// We expose one mutable object so each test can set both fields.

let __attachmentName = 'file.txt';
let __attachmentType = 'file';

vi.mock('@assistant-ui/react', () => ({
  useAuiState: (selector: (s: { attachment: { name: string; type: string } }) => unknown) =>
    selector({ attachment: { name: __attachmentName, type: __attachmentType } }),
  MessagePrimitive: {
    // Invoke the render-prop child once so one tile renders per test.
    Attachments: ({ children }: { children: () => React.ReactNode }) => <>{children()}</>,
  },
}));

// ---------------------------------------------------------------------------
// Mock @/components/ui/assistant-ui/attachment
// ---------------------------------------------------------------------------

// `useAttachmentSrc` in ImageAttachment returns the resolved image src.
// `AttachmentPreviewDialog` wraps the clickable button — stub as passthrough.

let __src = '';

vi.mock('@/components/ui/assistant-ui/attachment', () => ({
  useAttachmentSrc: () => __src,
  AttachmentPreviewDialog: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// ---------------------------------------------------------------------------
// Mock ../../view-model/message-meta
// ---------------------------------------------------------------------------

// The path is relative to the TEST file — one level up from __tests__/ then
// into view-model/.
let __meta: MainframeMessageMeta = {};

vi.mock('../../view-model/message-meta', () => ({
  useMainframeMeta: () => __meta,
}));

import { UserAttachments } from '../UserAttachments';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderAttachments() {
  return render(<UserAttachments />);
}

// ---------------------------------------------------------------------------
// Tests — B1: known ext + preview with sizeBytes → type label · KB size
// ---------------------------------------------------------------------------

describe('UserAttachments — B1: TypeScript file with size preview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __attachmentType = 'file';
    __src = '';
  });

  it('renders filename, TypeScript label, and KB-formatted size', () => {
    __attachmentName = 'Layout.tsx';
    __meta = {
      attachmentPreviews: [{ name: 'Layout.tsx', kind: 'file', sizeBytes: 6554 }],
    };

    renderAttachments();

    // The pill root carries the stable testid.
    expect(screen.getByTestId('chat-user-attachment-Layout.tsx')).toBeInTheDocument();

    // Filename rendered.
    expect(screen.getByText('Layout.tsx')).toBeInTheDocument();

    // Subline: 6554 / 1024 = 6.400390625 → toFixed(1) = "6.4"
    expect(screen.getByText('TypeScript · 6.4 KB')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Tests — B2: known ext (md) with no matching preview → label only
// ---------------------------------------------------------------------------

describe('UserAttachments — B2: Markdown file without size preview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __attachmentType = 'file';
    __src = '';
  });

  it('renders just the Markdown label with no size part when preview is absent', () => {
    __attachmentName = 'notes.md';
    __meta = { attachmentPreviews: [] };

    renderAttachments();

    expect(screen.getByTestId('chat-user-attachment-notes.md')).toBeInTheDocument();
    expect(screen.getByText('notes.md')).toBeInTheDocument();

    // No "·" — subline is the bare label.
    expect(screen.getByText('Markdown')).toBeInTheDocument();
    expect(screen.queryByText(/·/)).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Tests — B3: unknown extension → ".bin" tile + "File" subline
// ---------------------------------------------------------------------------

describe('UserAttachments — B3: unknown extension falls back to File', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __attachmentType = 'file';
    __src = '';
  });

  it('shows .bin in the ext tile and "File" as the subline', () => {
    __attachmentName = 'data.bin';
    __meta = {};

    renderAttachments();

    expect(screen.getByTestId('chat-user-attachment-data.bin')).toBeInTheDocument();
    expect(screen.getByText('data.bin')).toBeInTheDocument();

    // The tile renders ".ext" — the component renders "." + m.ext separately.
    expect(screen.getByText('.bin')).toBeInTheDocument();

    // Subline is the fallback label.
    expect(screen.getByText('File')).toBeInTheDocument();
    expect(screen.queryByText(/·/)).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Tests — B4: large file (>= 1 MB) → MB-formatted size
// ---------------------------------------------------------------------------

describe('UserAttachments — B4: large JSON file renders MB size', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __attachmentType = 'file';
    __src = '';
  });

  it('renders "JSON · 2.1 MB" for a 2_200_000-byte file', () => {
    __attachmentName = 'big.json';
    __meta = {
      attachmentPreviews: [{ name: 'big.json', kind: 'file', sizeBytes: 2_200_000 }],
    };

    renderAttachments();

    expect(screen.getByTestId('chat-user-attachment-big.json')).toBeInTheDocument();
    expect(screen.getByText('big.json')).toBeInTheDocument();

    // 2_200_000 / 1_048_576 = 2.09808… → toFixed(1) = "2.1"
    expect(screen.getByText('JSON · 2.1 MB')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Tests — B5: image attachment with capture context (selector) → thumb + selector
// ---------------------------------------------------------------------------

describe('UserAttachments — B5: image attachment with matching capture renders selector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __attachmentType = 'image';
    __src = 'data:img';
  });

  it('renders an img with the resolved src and the selector text alongside', () => {
    __attachmentName = 'element1.png';
    __meta = {
      captures: [{ label: 'element1', imageName: 'element1.png', selector: 'nav > .x' }],
    };

    renderAttachments();

    const tile = screen.getByTestId('chat-user-attachment-element1.png');
    expect(tile).toBeInTheDocument();

    // The <img> tag has the stubbed src (alt="" gives it presentation role; query within the tile).
    const img = tile.querySelector('img');
    expect(img).not.toBeNull();
    expect(img).toHaveAttribute('src', 'data:img');

    // Selector text is rendered as a <code> element.
    expect(screen.getByText('nav > .x')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Tests — B6: image attachment with no selector/annotation → bare thumb only
// ---------------------------------------------------------------------------

describe('UserAttachments — B6: image attachment without selector renders thumb, no context', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __attachmentType = 'image';
    __src = 'data:img';
  });

  it('renders the testid and img but no selector code element', () => {
    __attachmentName = 'screenshot1.png';
    __meta = {
      captures: [{ label: 'screenshot1', imageName: 'screenshot1.png' }],
    };

    renderAttachments();

    const tile = screen.getByTestId('chat-user-attachment-screenshot1.png');
    expect(tile).toBeInTheDocument();

    const img = tile.querySelector('img');
    expect(img).not.toBeNull();
    expect(img).toHaveAttribute('src', 'data:img');

    // No selector/annotation context rendered.
    expect(screen.queryByTestId('chat-capture-selector')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Tests — B8: capture chip selector uses mf-code-fn color token (not mf-success)
// ---------------------------------------------------------------------------

describe('UserAttachments — B8: capture selector uses text-mf-code-fn class', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __attachmentType = 'image';
    __src = 'data:img';
  });

  it('the selector element has text-mf-code-fn class and not text-mf-success', () => {
    __attachmentName = 'element1.png';
    __meta = {
      captures: [{ label: 'element1', imageName: 'element1.png', selector: 'nav > .active' }],
    };

    renderAttachments();

    // TruncatedWithTooltip renders a <span> (not <code>); the testid is the stable hook.
    const selectorEl = screen.getByTestId('chat-capture-selector');
    expect(selectorEl).toHaveTextContent('nav > .active');
    expect(selectorEl.className).toContain('text-mf-code-fn');
    expect(selectorEl.className).not.toContain('text-mf-success');
  });
});

// ---------------------------------------------------------------------------
// Tests — B7: image attachment with no matching capture → bare thumb, no crash
// ---------------------------------------------------------------------------

describe('UserAttachments — B7: image attachment with no matching capture renders bare thumb', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __attachmentType = 'image';
    __src = 'data:img';
  });

  it('renders the testid and img without crashing when captures is empty', () => {
    __attachmentName = 'unknown.png';
    __meta = { captures: [] };

    renderAttachments();

    const tile = screen.getByTestId('chat-user-attachment-unknown.png');
    expect(tile).toBeInTheDocument();

    const img = tile.querySelector('img');
    expect(img).not.toBeNull();
    expect(img).toHaveAttribute('src', 'data:img');

    expect(screen.queryByTestId('chat-capture-selector')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Tests — B9: capture selector chip carries data-testid and full selector text
// ---------------------------------------------------------------------------

describe('UserAttachments — B9: capture selector has chat-capture-selector testid', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __attachmentType = 'image';
    __src = 'data:img';
  });

  it('renders the capture selector in a tooltip-bearing chip with a testid', () => {
    __attachmentName = 'el.png';
    __meta = {
      captures: [
        {
          label: 'el',
          imageName: 'el.png',
          selector: 'div > div.min-h-screen.bg-background',
        },
      ],
    };

    renderAttachments();

    const el = screen.getByTestId('chat-capture-selector');
    expect(el).toHaveTextContent('div > div.min-h-screen.bg-background');
  });
});
