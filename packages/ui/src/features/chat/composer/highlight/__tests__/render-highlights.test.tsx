/**
 * renderHighlights — unit tests for the pure highlight helper.
 *
 * TDD: these tests were written FIRST (RED) before the implementation.
 *
 * Behaviors:
 *  1. @mention wrapped in accent span, surrounding text plain, textContent preserved char-for-char
 *  2. Leading /command wrapped in accent span, textContent preserved
 *  3. Plain text (no directives) returns no span, textContent preserved
 */
import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { renderHighlights } from '../render-highlights';

function html(text: string) {
  const { container } = render(<>{renderHighlights(text)}</>);
  return container;
}

describe('renderHighlights', () => {
  it('wraps an @mention in an accent span and leaves surrounding text plain', () => {
    const c = html('see @src/app.ts now');
    const span = c.querySelector('span.text-primary');
    expect(span?.textContent).toBe('@src/app.ts');
    expect(c.textContent).toBe('see @src/app.ts now'); // full text preserved char-for-char
  });

  it('highlights a leading /skill command', () => {
    const c = html('/review the diff');
    const span = c.querySelector('span.text-primary');
    expect(span?.textContent).toBe('/review');
    expect(c.textContent).toBe('/review the diff');
  });

  it('returns the text unchanged when there are no directives', () => {
    const c = html('plain message');
    expect(c.querySelector('span.text-primary')).toBeNull();
    expect(c.textContent).toBe('plain message');
  });

  it('preserves full textContent char-for-char with both a command and a mention', () => {
    const input = '/deploy @src/main.ts and @tests/foo.ts';
    const c = html(input);
    expect(c.textContent).toBe(input);
    const spans = c.querySelectorAll('span.text-primary');
    expect(spans).toHaveLength(3); // /deploy, @src/main.ts, @tests/foo.ts
  });

  it('does not double-count the space before an @mention', () => {
    const input = 'hello @world end';
    const c = html(input);
    expect(c.textContent).toBe(input);
  });
});
