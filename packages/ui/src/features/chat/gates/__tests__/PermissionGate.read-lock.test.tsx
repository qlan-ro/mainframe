import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { PermissionGate } from '../PermissionGate';
import {
  gate,
  ui,
  queueFront,
  arm,
  show,
  slot,
  option,
  showRest,
  locked,
  LOCKED,
  FREE,
  press,
  enter,
  scrollTo,
  resize,
  layout,
  reply,
  WRAPPED,
  GAP,
  TALL,
  rule,
} from './read-lock-fixture';
import type { ControlUpdate } from '@qlan-ro/mainframe-types';

describe('a request whose end is out of view', () => {
  it.each([
    ['one wrapped line', WRAPPED, 400],
    ['a ten-line gap', GAP, 240],
    ['200 lines', TALL, 3600],
  ])('locks what allows it: %s', (_what, command, height) => {
    layout.parts = { tool: height };
    show(gate('r1', { command }));

    expect(locked()).toEqual(LOCKED);
    expect(showRest()).toHaveAccessibleName('Show the rest of the command');

    press(option('allow-once'));
    press(option('allow-always'));
    enter(option('allow-once'));
    fireEvent.keyDown(option('allow-once'), { key: ' ' });
    fireEvent.keyUp(option('allow-once'), { key: ' ' });
    fireEvent.click(option('allow-once'), { detail: 0 });
    expect(reply).not.toHaveBeenCalled();
  });

  it('leaves Reject live', () => {
    layout.parts = { tool: 400 };
    show(gate('r1', { command: WRAPPED }));

    expect(option('reject-once')).not.toHaveAttribute('aria-disabled');
    press(option('reject-once'));

    expect(reply).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ behavior: 'deny' }), 'reject-once');
  });

  it('locks an answer of a kind it does not know, which may allow', () => {
    layout.parts = { tool: 400 };
    const front = gate('r1', { command: WRAPPED });
    front.entry.options.push({ optionId: 'new', name: 'New', kind: 'allow_for_a_day' as never });
    show(front);

    press(option('new'));

    expect(reply).not.toHaveBeenCalled();
  });

  it('the button scrolls to the end and unlocks every answer', () => {
    layout.parts = { tool: 400 };
    show(gate('r1', { command: WRAPPED }));

    press(showRest()!);

    // Head and command are 450 px; 300 − 44 − 40 of them show above the answers and the button.
    expect(slot().scrollTop).toBe(450 - 216);
    expect(locked()).toEqual(FREE);
    expect(showRest()).toBeNull();
    press(option('allow-once'));
    expect(reply).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ behavior: 'allow' }), 'allow-once');
  });

  it('scrolling there unlocks it too, and scrolling short of it does not', () => {
    layout.parts = { tool: 400 };
    show(gate('r1', { command: WRAPPED }));

    scrollTo(200);
    expect(locked()).toEqual(LOCKED);

    scrollTo(450 - 216);
    expect(locked()).toEqual(FREE);
    expect(showRest()).toBeNull();
  });

  it('a last line behind the answers is out of view', () => {
    layout.parts = { tool: 220 };
    show(gate('r1', { command: GAP }));

    // It ends at 270: inside the slot, under the answers that start at 256.
    expect(locked()).toEqual(LOCKED);
  });

  it('a jump past the end does not count: the end was never in view', () => {
    layout.parts = { tool: 400, grants: 900 };
    show(gate('r1', { command: WRAPPED }, { suggestions: [rule('a')] }));

    scrollTo(900);

    expect(showRest()).toHaveAccessibleName('Show the rest of the command');
  });

  it('once shown, hiding the end again locks nothing', () => {
    layout.parts = { tool: 150 };
    show(gate('r1', { command: GAP }));
    expect(locked()).toEqual(FREE);

    layout.cap = 120;
    resize();
    scrollTo(0);

    expect(locked()).toEqual(FREE);
    expect(showRest()).toBeNull();
  });

  it('a resize that brings the end into view unlocks it', () => {
    layout.parts = { tool: 400 };
    show(gate('r1', { command: WRAPPED }));

    layout.cap = 900;
    fireEvent(window, new Event('resize'));

    expect(locked()).toEqual(FREE);
  });

  it('the next request is locked again, for itself, and starts at its top', () => {
    layout.parts = { tool: 400 };
    const { rerender } = show(gate('r1', { command: WRAPPED }));
    press(showRest()!);
    expect(slot().scrollTop).toBeGreaterThan(0);
    press(option('allow-once'));

    // The same command, asked again.
    queueFront(gate('r2', { command: WRAPPED }));
    rerender(ui());
    arm();

    expect(slot().scrollTop).toBe(0);
    expect(locked()).toEqual(LOCKED);
    press(option('allow-once'));
    expect(reply).toHaveBeenCalledTimes(1);
  });
});

it('a request shown in the place of another is locked for itself', () => {
  layout.parts = { tool: 400 };
  const card = (id: string) => (
    <TooltipProvider>
      <div data-chat-gate data-testid="chat-thread-gate-slot">
        <PermissionGate entry={gate(id, { command: WRAPPED }).entry} reply={reply} />
      </div>
    </TooltipProvider>
  );
  const { rerender } = render(card('r1'));
  press(showRest()!);
  expect(locked()).toEqual(FREE);
  scrollTo(0);

  rerender(card('r2'));

  expect(locked()).toEqual(LOCKED);
});

it('measures a longer command again when its text changes in the same request', () => {
  const { rerender } = show(gate('r1', { command: 'ls' }));
  expect(locked()).toEqual(FREE);

  layout.parts = { tool: 600 };
  queueFront(gate('r1', { command: WRAPPED }));
  rerender(ui());

  expect(locked()).toEqual(LOCKED);
  press(showRest()!);
  expect(locked()).toEqual(FREE);
});

describe('a request that fits', () => {
  it('has no button and no lock', () => {
    layout.parts = { tool: 100 };
    show(gate('r1', { command: GAP }));

    expect(showRest()).toBeNull();
    expect(locked()).toEqual(FREE);
    expect(option('allow-once')).not.toHaveAccessibleDescription();
  });

  it('is measured without the button, whose own room would hide the end', () => {
    // Ends at 250, above the answers at 256; a button above them would cover it.
    layout.parts = { tool: 200 };
    show(gate('r1', { command: GAP }));

    expect(showRest()).toBeNull();
  });
});

describe('everything on show that is allowed', () => {
  it('counts the rules “Always allow” saves', () => {
    layout.parts = { grants: 800 };
    show(gate('r1', { command: 'ls' }, { suggestions: [rule('a'), rule('b')] }));

    expect(locked()).toEqual(LOCKED);
    expect(showRest()).toHaveAccessibleName('Show the rest of what “Always allow” saves');
    press(showRest()!);
    expect(locked()).toEqual(FREE);
  });

  it('counts directories', () => {
    layout.parts = { grants: 800 };
    show(
      gate(
        'r1',
        { command: 'ls' },
        {
          suggestions: [{ type: 'addDirectories', directories: ['/a', '/b'], destination: 'session' } as ControlUpdate],
        },
      ),
    );

    expect(locked()).toEqual(LOCKED);
  });

  it('counts Details once they are open', () => {
    layout.parts = { details: 700 };
    show(gate('r1', { file_path: '/a', content: 'x' }, { toolName: 'Write' }));
    expect(locked()).toEqual(FREE);

    press(screen.getByTestId('chat-permission-details-toggle'));

    expect(locked()).toEqual(LOCKED);
    expect(showRest()).toHaveAccessibleName('Show the rest of the details');
    press(showRest()!);
    expect(locked()).toEqual(FREE);
  });

  it('a long tool name counts as the request', () => {
    layout.parts = { tool: 500 };
    show(gate('r1', {}, { toolName: `mcp__${'x'.repeat(900)}` }));

    expect(showRest()).toHaveAccessibleName('Show the rest of the request');
  });

  it('one press shows one end: a command’s is not passed by on the way to the rules', () => {
    layout.parts = { tool: 900, grants: 900 };
    show(gate('r1', { command: TALL }, { suggestions: [rule('a')] }));

    press(showRest()!);
    expect(locked()).toEqual(LOCKED);
    expect(showRest()).toHaveAccessibleName('Show the rest of what “Always allow” saves');
    // The second click of a double-click is not a press.
    press(showRest()!, 2);
    expect(locked()).toEqual(LOCKED);

    press(showRest()!);
    expect(locked()).toEqual(FREE);
  });

  it('rules that fit behind the command’s end come into view with it', () => {
    layout.parts = { tool: 900, grants: 60 };
    show(gate('r1', { command: TALL }, { suggestions: [rule('a')] }));

    press(showRest()!);

    expect(locked()).toEqual(FREE);
  });
});

it('remeasures a resized part even when the slot has not resized', () => {
  layout.parts = { tool: 400 };
  show(gate('r1', { command: WRAPPED }));
  expect(locked()).toEqual(LOCKED);
  layout.parts = { tool: 140 };
  resize(screen.getByTestId('chat-permission-command').closest('[data-allowed-part]')!);
  expect(locked()).toEqual(FREE);
});

it('recognizes the last line within one pixel of the answer boundary', () => {
  layout.parts = { tool: 207 };
  show(gate('r1', { command: WRAPPED }));
  expect(locked()).toEqual(FREE);
  expect(showRest()).toBeNull();
});
