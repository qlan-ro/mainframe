import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { ReactElement } from 'react';

const emitSurfaceIntent = vi.fn();
vi.mock('@/store/surface-intents', () => ({ emitSurfaceIntent: (...a: unknown[]) => emitSurfaceIntent(...a) }));

import { ContextFileItem } from '../ContextFileItem';

// The app mounts a global TooltipProvider at the root; wrap for test isolation.
const renderItem = (ui: ReactElement) => render(<TooltipProvider>{ui}</TooltipProvider>);

describe('ContextFileItem', () => {
  it('renders the basename and badge and emits open-file on click', () => {
    renderItem(<ContextFileItem path="src/deep/file.ts" badge="@" />);
    const btn = screen.getByTestId('sidebar-context-item-src/deep/file.ts');
    expect(btn).toHaveTextContent('file.ts');
    expect(btn).toHaveTextContent('@');
    fireEvent.click(btn);
    expect(emitSurfaceIntent).toHaveBeenCalledWith({ type: 'open-file', path: 'src/deep/file.ts' });
  });

  it('prefers displayName over the basename', () => {
    renderItem(<ContextFileItem path="skills/run.sh" displayName="Run Tests" />);
    expect(screen.getByTestId('sidebar-context-item-skills/run.sh')).toHaveTextContent('Run Tests');
  });
});
