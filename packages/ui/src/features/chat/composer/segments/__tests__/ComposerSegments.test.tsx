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
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, within, act } from '@testing-library/react';
import { useComposerSegments } from '../segment-store';
import { ComposerSegments } from '../ComposerSegments';

const THREAD_ID = 'thread-1';

function Harness() {
  return (
    <div data-testid="chat-composer">
      <div data-testid="composer-dropzone">
        <ComposerSegments threadId={THREAD_ID} />
      </div>
      <div data-testid="composer-scroll-wrapper">
        <textarea data-testid="chat-composer-input" defaultValue="typed draft" />
      </div>
    </div>
  );
}

function findSegment(id: string): HTMLElement {
  const segment = screen.getAllByTestId('composer-segment').find((el) => el.dataset.segmentId === id);
  expect(segment).toBeDefined();
  return segment!;
}

function segmentInput(id: string): HTMLTextAreaElement {
  return within(findSegment(id)).getByTestId('composer-segment-input') as HTMLTextAreaElement;
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

  it('renders one committed segment as a composer-segment with quote preview, dismiss and a controlled textarea, all sharing the segment id', () => {
    useComposerSegments.setState({
      byThread: { [THREAD_ID]: { committed: [{ id: 's1', quote: 'Q1', text: 'keep me' }], liveQuote: null } },
    });
    render(<Harness />);

    const segment = findSegment('s1');
    const preview = within(segment).getByTestId('composer-quote-preview');
    const dismiss = within(segment).getByTestId('composer-quote-dismiss');
    const textarea = segmentInput('s1');

    expect(preview.dataset.segmentId).toBe('s1');
    expect(dismiss.dataset.segmentId).toBe('s1');
    expect(textarea.tagName).toBe('TEXTAREA');
    expect(textarea.dataset.segmentId).toBe('s1');
    expect(textarea.value).toBe('keep me');
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

  it('dismissing a committed segment with prose present keeps the segment, drops only the quote pill', () => {
    useComposerSegments.setState({
      byThread: { [THREAD_ID]: { committed: [{ id: 's1', quote: 'Q1', text: 'keep me' }], liveQuote: null } },
    });
    render(<Harness />);

    act(() => {
      within(findSegment('s1')).getByTestId('composer-quote-dismiss').click();
    });

    expect(within(findSegment('s1')).queryByTestId('composer-quote-preview')).toBeNull();
    expect(segmentInput('s1').value).toBe('keep me');
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

  it('placeholder rule: a committed box under a quote reads "Add a message…", a quoteless committed box reads "Reply to Mainframe…"', () => {
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

    expect(segmentInput('s1').placeholder).toBe('Add a message…');
    expect(segmentInput('s2').placeholder).toBe('Reply to Mainframe…');
  });
});
