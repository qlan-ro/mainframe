/**
 * ContextFileItem — unit tests.
 *
 * Moved out of the retired bottom panel with the component (plan D14). Two cases
 * from the original are gone with the behavior they covered: the fixed-step
 * indentation (the outline nesting it indented for died with the bottom panel)
 * and the per-badge-type `mf-*` tint (the badge is the v2 `Badge` primitive now,
 * matching the scope chips its sibling rows render).
 *
 * Behaviors covered:
 *  - basename + badge render, and a click emits the open-file intent
 *  - displayName wins over the basename
 *  - the testId prop scopes the row; it falls back to a path-keyed default
 *  - the full path is exposed for the Hint via aria-label
 *
 * Mocked dependencies: @/store/surface-intents.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { ReactElement } from 'react';

const emitSurfaceIntent = vi.fn();
vi.mock('@/store/surface-intents', () => ({ emitSurfaceIntent: (...a: unknown[]) => emitSurfaceIntent(...a) }));

import { ContextFileItem } from '../ContextFileItem';

// The app mounts a global TooltipProvider at the root; wrap for test isolation.
const renderItem = (ui: ReactElement) => render(<TooltipProvider>{ui}</TooltipProvider>);

beforeEach(() => {
  emitSurfaceIntent.mockReset();
});

describe('ContextFileItem', () => {
  it('renders the basename and badge and emits open-file on click', () => {
    renderItem(<ContextFileItem path="src/deep/file.ts" badge="@" />);
    const btn = screen.getByTestId('session-panel-session-item-src/deep/file.ts');
    expect(btn).toHaveTextContent('file.ts');
    expect(btn).toHaveTextContent('@');
    fireEvent.click(btn);
    expect(emitSurfaceIntent).toHaveBeenCalledWith({ type: 'open-file', path: 'src/deep/file.ts' });
  });

  it('prefers displayName over the basename', () => {
    renderItem(<ContextFileItem path="skills/run.sh" displayName="Run Tests" />);
    expect(screen.getByTestId('session-panel-session-item-skills/run.sh')).toHaveTextContent('Run Tests');
  });

  it('uses the testId prop when the caller scopes the row', () => {
    renderItem(<ContextFileItem path="src/a.ts" testId="session-panel-session-item-custom" />);
    expect(screen.getByTestId('session-panel-session-item-custom')).toBeInTheDocument();
    expect(screen.queryByTestId('session-panel-session-item-src/a.ts')).toBeNull();
  });

  it('carries the full path as the accessible name so the Hint has something to show', () => {
    renderItem(<ContextFileItem path="src/deep/file.ts" />);
    expect(screen.getByTestId('session-panel-session-item-src/deep/file.ts')).toHaveAttribute(
      'aria-label',
      'src/deep/file.ts',
    );
  });

  it('renders no badge element when no badge is given', () => {
    renderItem(<ContextFileItem path="src/plain.ts" />);
    const btn = screen.getByTestId('session-panel-session-item-src/plain.ts');
    expect(btn.querySelector('[data-slot="badge"]')).toBeNull();
  });
});
