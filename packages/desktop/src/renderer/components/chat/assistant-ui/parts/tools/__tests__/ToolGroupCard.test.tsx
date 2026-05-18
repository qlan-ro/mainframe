import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { TooltipProvider } from '../../../../../ui/tooltip.js';
import { ToolGroupCard } from '../ToolGroupCard.js';

const wrap = (ui: React.ReactNode) => <TooltipProvider>{ui}</TooltipProvider>;

const items = [
  { toolCallId: 't1', toolName: 'Read', args: { file_path: '/a.ts' }, result: { content: 'hi' }, isError: false },
  { toolCallId: 't2', toolName: 'Grep', args: { pattern: 'foo' }, result: { content: 'no match' }, isError: false },
];

describe('ToolGroupCard (U8 unified)', () => {
  it('renders Layers icon and a summary line', () => {
    const { container } = render(wrap(<ToolGroupCard args={{ items }} />));
    expect(container.querySelector('svg.lucide-layers, svg[class*="layers"]')).toBeTruthy();
  });

  it('does not render Maximize2 toggle', () => {
    const { container } = render(wrap(<ToolGroupCard args={{ items }} />));
    expect(container.querySelector('svg.lucide-maximize-2')).toBeNull();
  });
});
