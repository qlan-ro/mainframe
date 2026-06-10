/**
 * UserAttachments — behavior tests for FilePill rendering.
 *
 * Strategy:
 *  - Mock `@assistant-ui/react` so `useAuiState` receives a synthetic state
 *    shaped as `{ attachment: { name: <currentName> } }`. The selector is called
 *    with that object and returns whatever the selector picks.
 *  - `MessagePrimitive.Attachments` is stubbed to invoke the render-prop child
 *    once (one FilePill per test), using the current `__attachmentName`.
 *  - `useMainframeMeta` from the view-model is stubbed to return `__meta`, a
 *    mutable object controlled per-test.
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
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { MainframeMessageMeta } from '../../view-model/message-meta';

// ---------------------------------------------------------------------------
// Mock @assistant-ui/react
// ---------------------------------------------------------------------------

// `useAuiState` in FilePill is called with: (s) => s.attachment.name
// We keep a mutable `__attachmentName` so each test controls which name the
// pill reads.

let __attachmentName = 'file.txt';

vi.mock('@assistant-ui/react', () => ({
  useAuiState: (selector: (s: { attachment: { name: string } }) => unknown) =>
    selector({ attachment: { name: __attachmentName } }),
  MessagePrimitive: {
    // Invoke the render-prop child once so one FilePill renders per test.
    Attachments: ({ children }: { children: () => React.ReactNode }) => <>{children()}</>,
  },
}));

// ---------------------------------------------------------------------------
// Mock ../view-model/message-meta
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
