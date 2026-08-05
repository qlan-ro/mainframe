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

// ---------------------------------------------------------------------------
// Per-type renderers (todo #240) — a segment type may supply its own chrome.
// ---------------------------------------------------------------------------

const sessionFormatter: Unstable_DirectiveFormatter = {
  serialize: () => '',
  parse: () => [
    { kind: 'text', text: 'see ' },
    { kind: 'mention', type: 'session', label: '@session[Foo]', id: 'Foo' },
    { kind: 'text', text: ' and ' },
    { kind: 'mention', type: 'mention', label: '@a.ts', id: 'a.ts' },
  ],
};

function SessionMarker({ id }: { type: string; label: string; id: string }) {
  return <span data-testid={`session-marker-${id}`}>{id}</span>;
}

describe('createDirectiveText — per-type renderers', () => {
  it('renders a segment through its type renderer instead of a chip', () => {
    const Text = createDirectiveText(sessionFormatter, { renderers: { session: SessionMarker } });
    render(<Text type="text" text="hi" status={{ type: 'complete' }} />);

    const marker = screen.getByTestId('session-marker-Foo');
    expect(marker).toHaveTextContent('Foo');
    expect(marker.closest('[data-slot="directive-text-chip"]')).toBeNull();
    expect(screen.queryByText('@session[Foo]')).not.toBeInTheDocument();
  });

  it('takes precedence over plainTypes for the same type', () => {
    const Text = createDirectiveText(sessionFormatter, {
      plainTypes: ['session', 'mention'],
      renderers: { session: SessionMarker },
    });
    render(<Text type="text" text="hi" status={{ type: 'complete' }} />);

    expect(screen.getByTestId('session-marker-Foo')).toBeInTheDocument();
    // The type with no renderer keeps its plain treatment.
    expect(screen.getByText('@a.ts').className).toContain('text-primary');
  });

  it('leaves types with no renderer entry on their existing treatment', () => {
    const Text = createDirectiveText(sessionFormatter, {
      iconMap: { mention: AtSign },
      renderers: { session: SessionMarker },
    });
    render(<Text type="text" text="hi" status={{ type: 'complete' }} />);

    expect(screen.getByText('@a.ts').closest('[data-slot="directive-text-chip"]')).not.toBeNull();
  });
});
