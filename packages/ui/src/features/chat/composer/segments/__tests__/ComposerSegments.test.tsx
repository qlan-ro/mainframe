/**
 * ComposerSegments — the block of committed quote+prose boxes stacked above
 * the native composer input, plus the pending live-quote pill (280-A3, A5,
 * A11). Renders against the real `useComposerSegments` store (seeded via
 * `setState`/the real `append`/`dismiss` actions) rather than a mock — the
 * model's own transitions (segment-model.test.ts) already pin `appendQuote`/
 * `dismissQuote`; this file only needs to pin what the component renders and
 * wires from those transitions.
 *
 * Harness choice (the focus-on-append case needs an element the component
 * does not itself render): a stub `chat-composer` root holds the component and
 * a stub `chat-composer-input` textarea, each behind its OWN wrapper div. The
 * nesting is deliberate — the component resolves the input from the composer
 * root, not from its immediate parent, so `Composer.tsx` can grow wrappers
 * between the two without breaking focus-on-append (and this harness would
 * catch a regression back to a sibling-only lookup). We do not render the real
 * `Composer` here: it pulls in the full aui/runtime mock surface for behavior
 * this file does not exercise.
 */
import { afterEach, describe, it, expect, beforeEach } from 'vitest';
import { fireEvent, render, screen, within, act, waitFor } from '@testing-library/react';
import {
  FIELD_MODES,
  RuntimeShell,
  chipsIn,
  fieldText,
  placeholderOf,
  replaceText,
  setFieldMode,
} from '../../__tests__/composer-field-driver';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useComposerSegments } from '../segment-store';
import { ComposerSegments } from '../ComposerSegments';

const THREAD_ID = 'thread-1';

function Harness() {
  return (
    <TooltipProvider>
      <RuntimeShell>
        <div data-testid="chat-composer">
          <div data-testid="composer-dropzone">
            <ComposerSegments threadId={THREAD_ID} />
          </div>
          <div data-testid="composer-scroll-wrapper">
            <textarea data-testid="chat-composer-input" defaultValue="typed draft" />
          </div>
        </div>
      </RuntimeShell>
    </TooltipProvider>
  );
}

function findSegment(id: string): HTMLElement {
  const segment = screen.getAllByTestId('composer-segment').find((el) => el.dataset.segmentId === id);
  expect(segment).toBeDefined();
  return segment!;
}

/** The segment's prose field. In chip mode it is a lazy chunk, which can take over the default 1 s to load. */
function segmentInput(id: string): Promise<HTMLElement> {
  return within(findSegment(id)).findByTestId('composer-segment-input', undefined, { timeout: 5000 });
}

beforeEach(() => {
  useComposerSegments.setState({ byThread: {} });
});

describe('ComposerSegments', () => {
  it('renders nothing for an empty composition', () => {
    render(<Harness />);
    expect(screen.queryByTestId('composer-segments')).toBeNull();
    expect(screen.queryByTestId('composer-segment')).toBeNull();
  });

  it('renders the live quote as a pill above the native input, not a second textarea', () => {
    useComposerSegments.setState({
      byThread: { [THREAD_ID]: { committed: [], liveQuote: { id: 'live1', text: 'Q2' } } },
    });
    render(<Harness />);

    expect(screen.queryByTestId('composer-segment')).toBeNull();
    const preview = screen.getByTestId('composer-quote-preview');
    expect(preview.dataset.segmentId).toBe('live1');
    // The live segment's prose lives only in the native input — no textarea
    // is rendered for it inside ComposerSegments.
    expect(document.querySelectorAll('textarea')).toHaveLength(1);
    expect(screen.getByTestId('chat-composer-input').tagName).toBe('TEXTAREA');
  });

  it('dismissing an empty committed segment removes the whole composer-segment element', () => {
    useComposerSegments.setState({
      byThread: { [THREAD_ID]: { committed: [{ id: 's1', quote: 'Q1', text: '' }], liveQuote: null } },
    });
    render(<Harness />);

    act(() => {
      within(findSegment('s1')).getByTestId('composer-quote-dismiss').click();
    });

    expect(screen.queryByTestId('composer-segment')).toBeNull();
  });

  it('dismissing the live quote leaves the native input and its text alone', () => {
    useComposerSegments.setState({
      byThread: { [THREAD_ID]: { committed: [], liveQuote: { id: 'live1', text: 'Q2' } } },
    });
    render(<Harness />);

    act(() => {
      screen.getByTestId('composer-quote-dismiss').click();
    });

    expect(screen.queryByTestId('composer-quote-preview')).toBeNull();
    const input = screen.getByTestId('chat-composer-input') as HTMLTextAreaElement;
    expect(input.value).toBe('typed draft');
  });

  it('appending a quote focuses the live box', () => {
    render(<Harness />);
    expect(document.activeElement).not.toBe(screen.getByTestId('chat-composer-input'));

    act(() => {
      useComposerSegments.getState().append(THREAD_ID, { quote: 'Q1', liveText: '' });
    });

    expect(document.activeElement).toBe(screen.getByTestId('chat-composer-input'));
  });

  it('a quote is one line, says where it is from, and is whole in its tooltip', async () => {
    const quote = 'The first line of it.\nAnd a second one.';
    render(<Harness />);
    act(() => {
      const { append } = useComposerSegments.getState();
      append(THREAD_ID, { quote, liveText: '', source: 'From the reply at 11:27 PM' });
      append(THREAD_ID, { quote: 'next', liveText: 'about the first', source: 'From your message at 11:30 PM' });
    });

    const [committed, live] = screen.getAllByTestId('composer-quote-preview');
    expect(committed).toHaveTextContent('From the reply at 11:27 PM');
    expect(live).toHaveTextContent('From your message at 11:30 PM');
    const line = within(committed!).getByTestId('composer-quote-text');
    expect(line).toHaveClass('truncate');
    fireEvent.focus(line);
    expect((await screen.findByRole('tooltip')).textContent).toBe(quote);
  });

  it('sizes a committed box without shrinking the live field to measure it (#519)', async () => {
    useComposerSegments.setState({
      byThread: { [THREAD_ID]: { committed: [{ id: 's1', quote: 'Q1', text: 'one\ntwo' }], liveQuote: null } },
    });
    render(<Harness />);
    const input = (await segmentInput('s1')) as HTMLTextAreaElement;
    // Every height written to the live field, even within one task: a height of `auto` there shortens the footer for
    // any layout read before the next write, and the browser clamps the transcript the reader follows.
    const heights: string[] = [];
    const style = input.style;
    const setProperty = style.setProperty.bind(style);
    style.setProperty = (name: string, value: string | null, priority?: string) => {
      if (name === 'height') heights.push(value ?? '');
      setProperty(name, value, priority);
    };
    Object.defineProperty(style, 'height', {
      configurable: true,
      get: () => style.getPropertyValue('height'),
      set: (value: string) => style.setProperty('height', value),
    });
    fireEvent.change(input, { target: { value: 'one\ntwo\nthree' } });
    await act(async () => Promise.resolve());
    expect(heights).not.toContain('auto');
  });

  it('removing a quote can be named apart from removing a tile', () => {
    useComposerSegments.setState({
      byThread: { [THREAD_ID]: { committed: [], liveQuote: { id: 'live1', text: 'Q2' } } },
    });
    render(<Harness />);
    expect(screen.getByRole('button', { name: 'Remove this quote' })).toBeInTheDocument();
  });
});

// The committed box's prose field: run against the textarea and the chip editor alike.
describe.each(FIELD_MODES)('ComposerSegments prose field (%s)', (mode) => {
  beforeEach(() => setFieldMode(mode));
  afterEach(() => setFieldMode('textarea'));

  it('renders one committed segment with quote preview, dismiss and its prose field, all sharing the segment id', async () => {
    useComposerSegments.setState({
      byThread: { [THREAD_ID]: { committed: [{ id: 's1', quote: 'Q1', text: 'keep me' }], liveQuote: null } },
    });
    render(<Harness />);

    const segment = findSegment('s1');
    const preview = within(segment).getByTestId('composer-quote-preview');
    const dismiss = within(segment).getByTestId('composer-quote-dismiss');
    const input = await segmentInput('s1');

    expect(preview.dataset.segmentId).toBe('s1');
    expect(dismiss.dataset.segmentId).toBe('s1');
    expect(input.tagName).toBe(mode === 'chips' ? 'DIV' : 'TEXTAREA');
    expect(input.dataset.segmentId).toBe('s1');
    expect(fieldText(input)).toBe('keep me');
  });

  it('dismissing a committed segment with prose present keeps the segment, drops only the quote pill', async () => {
    useComposerSegments.setState({
      byThread: { [THREAD_ID]: { committed: [{ id: 's1', quote: 'Q1', text: 'keep me' }], liveQuote: null } },
    });
    render(<Harness />);

    act(() => {
      within(findSegment('s1')).getByTestId('composer-quote-dismiss').click();
    });

    expect(within(findSegment('s1')).queryByTestId('composer-quote-preview')).toBeNull();
    expect(fieldText(await segmentInput('s1'))).toBe('keep me');
  });

  it('placeholder rule: a committed box under a quote reads "Add a message…", a quoteless committed box reads "Reply to the agent…"', async () => {
    useComposerSegments.setState({
      byThread: {
        [THREAD_ID]: {
          committed: [
            { id: 's1', quote: 'Q1', text: 'x' },
            { id: 's2', quote: null, text: 'y' },
          ],
          liveQuote: null,
        },
      },
    });
    render(<Harness />);

    expect(placeholderOf(await segmentInput('s1'))).toBe('Add a message…');
    expect(placeholderOf(await segmentInput('s2'))).toBe('Reply to the agent…');
  });

  it('an edit to a committed box goes to the store, and its tokens show as chips only in the chip field', async () => {
    useComposerSegments.setState({
      byThread: { [THREAD_ID]: { committed: [{ id: 's1', quote: 'Q1', text: 'see @src/a.ts' }], liveQuote: null } },
    });
    const { container } = render(<Harness />);
    const input = await segmentInput('s1');

    expect(chipsIn(container)).toEqual(mode === 'chips' ? ['@src/a.ts'] : []);
    replaceText(input, 'see @src/a.ts and more');

    await waitFor(() =>
      expect(useComposerSegments.getState().byThread[THREAD_ID]!.committed[0]!.text).toBe('see @src/a.ts and more'),
    );
  });
});
