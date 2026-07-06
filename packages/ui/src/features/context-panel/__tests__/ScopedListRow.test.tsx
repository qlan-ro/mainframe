import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ReactElement } from 'react';
import { Bolt } from 'lucide-react';
import { TooltipProvider } from '@/components/ui/tooltip';

const emitSurfaceIntent = vi.fn();
vi.mock('@/store/surface-intents', () => ({ emitSurfaceIntent: (...a: unknown[]) => emitSurfaceIntent(...a) }));

import { ScopedListRow } from '../ScopedListRow';

const renderRow = (ui: ReactElement) => render(<TooltipProvider>{ui}</TooltipProvider>);

describe('ScopedListRow', () => {
  it('renders name, description, scope and emits open-file with the filePath', () => {
    renderRow(
      <ScopedListRow
        testId="sidebar-skill-item-s1"
        icon={Bolt}
        name="/clean-code"
        description="Apply clean-code principles"
        scope="global"
        filePath="/skills/clean-code.md"
      />,
    );
    const row = screen.getByTestId('sidebar-skill-item-s1');
    expect(row).toHaveTextContent('/clean-code');
    expect(row).toHaveTextContent('Apply clean-code principles');
    expect(row).toHaveTextContent('global');
    fireEvent.click(row);
    expect(emitSurfaceIntent).toHaveBeenCalledWith({ type: 'open-file', path: '/skills/clean-code.md' });
  });
});
