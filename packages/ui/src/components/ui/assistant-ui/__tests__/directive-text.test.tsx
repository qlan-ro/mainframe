/**
 * directive-text — behavior tests for createDirectiveText's per-type render mode.
 *
 * Design contract (parity finding 7.1): a `mention` segment renders as plain
 * inline text (accent color + semibold, no box/border/icon) while a `command`
 * segment keeps the boxed DirectiveChip treatment. `plainTypes` in
 * CreateDirectiveTextOptions opts specific segment types out of the chip.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AtSign, Wrench } from 'lucide-react';
import { createDirectiveText } from '../directive-text';
import type { Unstable_DirectiveFormatter } from '@assistant-ui/react';

const formatter: Unstable_DirectiveFormatter = {
  serialize: () => '',
  parse: (text: string) => [
    { kind: 'text', text: 'see ' },
    { kind: 'mention', type: 'mention', label: '@a.ts', id: 'a.ts' },
    { kind: 'text', text: ' and ' },
    { kind: 'mention', type: 'command', label: '/fix', id: 'fix' },
    { kind: 'text', text: ` — ${text.length} chars` },
  ],
};

describe('createDirectiveText — plainTypes render mode', () => {
  it('renders a plainTypes segment as bare text with no chip wrapper', () => {
    const Text = createDirectiveText(formatter, {
      iconMap: { mention: AtSign, command: Wrench },
      plainTypes: ['mention'],
    });
    render(<Text type="text" text="hi" status={{ type: 'complete' }} />);

    const mention = screen.getByText('@a.ts');
    expect(mention).toBeInTheDocument();
    // Plain mode: no chip slot marker on the mention's own element.
    expect(mention.closest('[data-slot="directive-text-chip"]')).toBeNull();
  });

  it('still renders a non-plainTypes segment (command) as a boxed chip', () => {
    const Text = createDirectiveText(formatter, {
      iconMap: { mention: AtSign, command: Wrench },
      plainTypes: ['mention'],
    });
    render(<Text type="text" text="hi" status={{ type: 'complete' }} />);

    const command = screen.getByText('/fix');
    expect(command.closest('[data-slot="directive-text-chip"]')).not.toBeNull();
  });

  it('applies the accent + semibold classes to a plainTypes segment', () => {
    const Text = createDirectiveText(formatter, {
      iconMap: { mention: AtSign, command: Wrench },
      plainTypes: ['mention'],
    });
    render(<Text type="text" text="hi" status={{ type: 'complete' }} />);

    const mention = screen.getByText('@a.ts');
    expect(mention.className).toContain('text-primary');
    expect(mention.className).toContain('font-semibold');
  });

  it('renders no icon for a plainTypes segment even when iconMap has an entry', () => {
    const Text = createDirectiveText(formatter, {
      iconMap: { mention: AtSign, command: Wrench },
      plainTypes: ['mention'],
    });
    render(<Text type="text" text="hi" status={{ type: 'complete' }} />);
    // AtSign renders an <svg>; a plain-mode mention has no icon inside its own span.
    const mention = screen.getByText('@a.ts');
    expect(mention.querySelector('svg')).toBeNull();
    expect(mention.tagName).toBe('SPAN');
  });

  it('keeps the boxed chip behavior unchanged when plainTypes is omitted', () => {
    const Text = createDirectiveText(formatter, { iconMap: { mention: AtSign, command: Wrench } });
    render(<Text type="text" text="hi" status={{ type: 'complete' }} />);

    const mention = screen.getByText('@a.ts');
    expect(mention.closest('[data-slot="directive-text-chip"]')).not.toBeNull();
  });
});
