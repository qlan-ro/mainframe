import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { ReadMoreBubble } from '../../messages/ReadMoreBubble';

/**
 * The find search walks [data-message-id] → [data-text-part]. The user text body
 * carries `data-text-part` via ReadMoreBubble (asserted here behaviorally). The
 * assistant markdown wrapper's `data-text-part`, and `data-message-id` on the
 * message roots, are static attributes covered by typecheck + the searchMessages
 * unit test + live verification (the CSS Highlight paint can't run in jsdom).
 */
describe('find DOM hooks', () => {
  it('user text body carries data-text-part (ReadMoreBubble)', () => {
    const { container } = render(<ReadMoreBubble>hello world</ReadMoreBubble>);
    const part = container.querySelector('[data-text-part]');
    expect(part).not.toBeNull();
    expect(part?.textContent).toContain('hello world');
  });
});
