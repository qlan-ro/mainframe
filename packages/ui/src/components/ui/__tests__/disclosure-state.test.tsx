// @vitest-environment jsdom
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DisclosureScope, DisclosureStateProvider, useRetainedValue } from '../disclosure-state';
import { Collapsible, CollapsibleTrigger } from '../collapsible';

function Card({ name, controlled = false }: { name: string; controlled?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <DisclosureScope id={name}>
      <Collapsible data-testid="card" {...(controlled ? { open, onOpenChange: setOpen } : {})}>
        <CollapsibleTrigger>{name}</CollapsibleTrigger>
      </Collapsible>
      <button onClick={() => setOpen(true)}>Automatically open {name}</button>
    </DisclosureScope>
  );
}

function Harness({ mounted, controlled = false }: { mounted: boolean; controlled?: boolean }) {
  return (
    <DisclosureStateProvider>
      {mounted && (
        <>
          <Card name="A" controlled={controlled} />
          <Card name="B" />
        </>
      )}
    </DisclosureStateProvider>
  );
}

describe('retained transcript disclosure state', () => {
  it('restores an unmounted card without opening another tool with the same test id', () => {
    const view = render(<Harness mounted />);
    fireEvent.click(screen.getByRole('button', { name: 'A' }));
    view.rerender(<Harness mounted={false} />);
    view.rerender(<Harness mounted />);
    expect(screen.getByRole('button', { name: 'A' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: 'B' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('retains a controlled automatic change after an earlier manual choice', () => {
    const view = render(<Harness mounted controlled />);
    const trigger = screen.getByRole('button', { name: 'A' });
    fireEvent.click(trigger);
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('button', { name: 'Automatically open A' }));
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    view.rerender(<Harness mounted={false} controlled />);
    view.rerender(<Harness mounted controlled />);
    expect(screen.getByRole('button', { name: 'A' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('retains fetched output and functional state updates across row unmounts', () => {
    function Output() {
      const [value, setValue] = useRetainedValue('output', 'preview');
      return (
        <button
          onClick={() => {
            setValue('full');
            setValue((text) => `${text} output`);
          }}
        >
          {value}
        </button>
      );
    }
    const tree = (mounted: boolean) => <DisclosureStateProvider>{mounted && <Output />}</DisclosureStateProvider>;
    const view = render(tree(true));
    fireEvent.click(screen.getByRole('button', { name: 'preview' }));
    view.rerender(tree(false));
    view.rerender(tree(true));
    expect(screen.getByRole('button', { name: 'full output' })).toBeVisible();
  });
});
