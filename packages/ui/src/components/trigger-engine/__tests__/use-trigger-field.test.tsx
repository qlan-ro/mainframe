/**
 * Compatibility contract for `useTriggerField` + `TriggerFieldPopover`.
 *
 * These pin the behaviors the composer previously inherited from
 * assistant-ui's `Unstable_TriggerPopover`: filtering while typing, Escape
 * closing by rewinding the tracked cursor to the trigger offset, mouse picks
 * inserting and closing, directory picks keeping the token open — plus the
 * combobox ARIA that came with `useTriggerPopoverAriaProps` and is now ours.
 */
import { describe, it, expect } from 'vitest';
import { useRef, useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { useTriggerField } from '../use-trigger-field';
import { TriggerFieldPopover } from '../TriggerFieldPopover';
import type { TriggerAdapter, TriggerItem } from '../types';

const SKILLS: TriggerItem[] = [
  { id: 'query-db', type: 'skill', label: 'Query DB', description: 'runs a query' },
  { id: 'quick-fix', type: 'skill', label: 'Quick Fix' },
  { id: 'deploy', type: 'skill', label: 'Deploy' },
];

const skillsAdapter: TriggerAdapter = {
  categories: () => [],
  categoryItems: () => SKILLS,
  search: (q) => SKILLS.filter((s) => s.id.includes(q)),
};

const TREE: Record<string, TriggerItem[]> = {
  'x/': [
    { id: 'x/sub', type: 'directory', label: 'sub' },
    { id: 'x/a.ts', type: 'file', label: 'a.ts' },
  ],
  'x/sub/': [{ id: 'x/sub/deep.ts', type: 'file', label: 'deep.ts' }],
};

const filesAdapter: TriggerAdapter = {
  categories: () => [],
  categoryItems: () => [],
  search: (q) => TREE[q] ?? [],
};

function Field({ onHandled }: { onHandled?: (handled: boolean) => void } = {}) {
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const field = useTriggerField({
    value,
    onChange: setValue,
    textareaRef,
    triggers: [
      {
        char: '/',
        adapter: skillsAdapter,
        formatter: { serialize: (i) => `/${i.id}` },
        itemTestIdPrefix: 'composer-skill-item',
      },
      {
        char: '@',
        adapter: filesAdapter,
        formatter: { serialize: (i) => (i.type === 'directory' ? `@${i.id}/` : `@${i.id}`) },
        itemTestIdPrefix: 'composer-file-item',
        closeOnInsert: (i) => i.type !== 'directory',
      },
    ],
  });

  return (
    // The popover anchors to one element, so the textarea needs its own wrapper.
    <TriggerFieldPopover field={field} testId="composer-trigger-popover">
      <div>
        <textarea
          ref={textareaRef}
          data-testid="field-input"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            field.setCursorPosition(e.target.selectionStart ?? e.target.value.length);
          }}
          onKeyDown={(e) => {
            const handled = field.handleKeyDown(e);
            onHandled?.(handled);
          }}
          {...field.ariaProps}
        />
      </div>
    </TriggerFieldPopover>
  );
}

const type = (value: string) => {
  const input = screen.getByTestId('field-input');
  fireEvent.change(input, { target: { value, selectionStart: value.length, selectionEnd: value.length } });
  return input as HTMLTextAreaElement;
};

describe('useTriggerField — detection and filtering', () => {
  it('opens the popover and filters items as the query is typed', () => {
    render(<Field />);
    type('/qu');

    expect(screen.getByTestId('composer-trigger-popover')).toBeInTheDocument();
    expect(screen.getByTestId('composer-skill-item-query-db')).toBeInTheDocument();
    expect(screen.getByTestId('composer-skill-item-quick-fix')).toBeInTheDocument();
    expect(screen.queryByTestId('composer-skill-item-deploy')).not.toBeInTheDocument();
  });

  it('renders no popover when the query matches nothing', () => {
    render(<Field />);
    type('/zzz');
    expect(screen.queryByTestId('composer-trigger-popover')).not.toBeInTheDocument();
  });

  it('renders no popover without an active trigger token', () => {
    render(<Field />);
    type('plain text');
    expect(screen.queryByTestId('composer-trigger-popover')).not.toBeInTheDocument();
  });

  it('activates the second trigger char independently', () => {
    render(<Field />);
    type('@x/');
    expect(screen.getByTestId('composer-file-item-x/sub')).toBeInTheDocument();
  });
});

describe('useTriggerField — Escape', () => {
  it('closes the popover and stops matching the same token', () => {
    render(<Field />);
    const input = type('/qu');

    fireEvent.keyDown(input, { key: 'Escape' });

    expect(screen.queryByTestId('composer-trigger-popover')).not.toBeInTheDocument();
  });

  it('reports Escape as handled so the caller does not also cancel the field', () => {
    const handled: boolean[] = [];
    render(<Field onHandled={(h) => handled.push(h)} />);
    const input = type('/qu');

    fireEvent.keyDown(input, { key: 'Escape' });
    expect(handled[handled.length - 1]).toBe(true);

    // Closed: a second Escape is no longer ours to consume.
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(handled[handled.length - 1]).toBe(false);
  });

  it('survives a pointer press inside the field it anchors to', () => {
    // The overlay's dismiss layer treats the field as "outside" — without the
    // anchor guard, clicking to move the caret mid-token would close the list.
    render(<Field />);
    const input = type('/qu');

    fireEvent.pointerDown(input);

    expect(screen.getByTestId('composer-trigger-popover')).toBeInTheDocument();
  });

  it('re-opens once the token is extended after an Escape', () => {
    render(<Field />);
    const input = type('/qu');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByTestId('composer-trigger-popover')).not.toBeInTheDocument();

    type('/qui');
    expect(screen.getByTestId('composer-skill-item-quick-fix')).toBeInTheDocument();
  });
});

describe('useTriggerField — selection', () => {
  it('inserts the directive with one trailing space and closes on a mouse pick', () => {
    render(<Field />);
    const input = type('/qu');

    fireEvent.click(screen.getByTestId('composer-skill-item-quick-fix'));

    expect(input.value).toBe('/quick-fix ');
    expect(screen.queryByTestId('composer-trigger-popover')).not.toBeInTheDocument();
  });

  it('keeps the token open and re-lists after a directory pick', () => {
    render(<Field />);
    const input = type('@x/');

    fireEvent.click(screen.getByTestId('composer-file-item-x/sub'));

    expect(input.value).toBe('@x/sub/');
    expect(screen.getByTestId('composer-trigger-popover')).toBeInTheDocument();
    expect(screen.getByTestId('composer-file-item-x/sub/deep.ts')).toBeInTheDocument();
  });

  it('closes after picking a file inside a drilled-into directory', () => {
    render(<Field />);
    const input = type('@x/');
    fireEvent.click(screen.getByTestId('composer-file-item-x/sub'));
    fireEvent.click(screen.getByTestId('composer-file-item-x/sub/deep.ts'));

    expect(input.value).toBe('@x/sub/deep.ts ');
    expect(screen.queryByTestId('composer-trigger-popover')).not.toBeInTheDocument();
  });

  it('inserts the highlighted item on Enter', () => {
    render(<Field />);
    const input = type('/qu');

    fireEvent.keyDown(input, { key: 'Enter' });

    expect(input.value).toBe('/query-db ');
  });

  it('leaves Shift+Enter to the caller', () => {
    render(<Field />);
    const input = type('/qu');

    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });

    expect(input.value).toBe('/qu');
    expect(screen.getByTestId('composer-trigger-popover')).toBeInTheDocument();
  });
});

describe('useTriggerField — keyboard highlight', () => {
  it('moves the highlight with ArrowDown and wraps at the end', () => {
    render(<Field />);
    const input = type('/qu');
    const first = screen.getByTestId('composer-skill-item-query-db');
    const second = screen.getByTestId('composer-skill-item-quick-fix');

    expect(first).toHaveAttribute('data-highlighted');

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(second).toHaveAttribute('data-highlighted');
    expect(first).not.toHaveAttribute('data-highlighted');

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(first).toHaveAttribute('data-highlighted');
  });

  it('wraps backwards with ArrowUp', () => {
    render(<Field />);
    const input = type('/qu');

    fireEvent.keyDown(input, { key: 'ArrowUp' });

    expect(screen.getByTestId('composer-skill-item-quick-fix')).toHaveAttribute('data-highlighted');
  });

  it('highlights the hovered row', () => {
    render(<Field />);
    type('/qu');

    fireEvent.mouseMove(screen.getByTestId('composer-skill-item-quick-fix'));

    expect(screen.getByTestId('composer-skill-item-quick-fix')).toHaveAttribute('data-highlighted');
  });
});

describe('useTriggerField — combobox ARIA', () => {
  it('marks the field as a collapsed combobox when nothing is open', () => {
    render(<Field />);
    const input = screen.getByTestId('field-input');

    expect(input).toHaveAttribute('role', 'combobox');
    expect(input).toHaveAttribute('aria-expanded', 'false');
    expect(input).not.toHaveAttribute('aria-activedescendant');
  });

  it('points at the listbox and the highlighted option when open', () => {
    render(<Field />);
    const input = type('/qu');

    expect(input).toHaveAttribute('aria-expanded', 'true');
    expect(input).toHaveAttribute('aria-haspopup', 'listbox');

    const listbox = screen.getByRole('listbox');
    expect(input.getAttribute('aria-controls')).toBe(listbox.id);
    expect(input.getAttribute('aria-activedescendant')).toBe(screen.getByTestId('composer-skill-item-query-db').id);
  });

  it('follows the highlight to the next option', () => {
    render(<Field />);
    const input = type('/qu');

    fireEvent.keyDown(input, { key: 'ArrowDown' });

    expect(input.getAttribute('aria-activedescendant')).toBe(screen.getByTestId('composer-skill-item-quick-fix').id);
  });

  it('exposes every row as an option', () => {
    render(<Field />);
    type('/qu');

    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(2);
    expect(options[0]).toHaveAttribute('aria-selected', 'true');
    expect(options[1]).toHaveAttribute('aria-selected', 'false');
  });
});
