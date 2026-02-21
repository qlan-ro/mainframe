import React from 'react';
import { describe, expect, it } from 'vitest';
import { renderHighlights, PLAN_PREFIX } from './message-parsing.js';

describe('PLAN_PREFIX', () => {
  it('has the expected value', () => {
    expect(PLAN_PREFIX).toBe('Implement the following plan:\n\n');
  });
});

describe('renderHighlights', () => {
  it('returns plain text as a single string node for plain input', () => {
    const parts = renderHighlights('hello world');
    expect(parts).toHaveLength(1);
    expect(parts[0]).toBe('hello world');
  });

  it('returns empty array for empty string', () => {
    const parts = renderHighlights('');
    expect(parts).toHaveLength(0);
  });

  it('wraps a leading slash-command in an accent span', () => {
    const parts = renderHighlights('/build');
    expect(parts).toHaveLength(1);
    const el = parts[0] as React.ReactElement;
    expect(el.type).toBe('span');
    expect(el.props.children).toBe('/build');
  });

  it('wraps a leading slash-command and keeps trailing text as a string', () => {
    const parts = renderHighlights('/run some args');
    // First part is the span with the command
    const el = parts[0] as React.ReactElement;
    expect(el.type).toBe('span');
    expect(el.props.children).toBe('/run');
    // Remaining text is a plain string
    expect(parts[1]).toBe(' some args');
  });

  it('wraps @mentions in accent spans', () => {
    const parts = renderHighlights('hello @user how are you');
    // Should find a span with @user
    const mentionSpan = parts.find(
      (p) => React.isValidElement(p) && (p as React.ReactElement).props.children === '@user',
    );
    expect(mentionSpan).toBeDefined();
  });

  it('does not wrap @mention that is not preceded by whitespace', () => {
    const parts = renderHighlights('foo@bar');
    // All parts should be plain strings (no React elements)
    expect(parts.every((p) => typeof p === 'string')).toBe(true);
    expect(parts.join('')).toBe('foo@bar');
  });

  it('wraps @mention at the start of the string', () => {
    const parts = renderHighlights('@alice');
    expect(parts).toHaveLength(1);
    const el = parts[0] as React.ReactElement;
    expect(el.type).toBe('span');
    expect(el.props.children).toBe('@alice');
  });

  it('handles multiple @mentions in text', () => {
    const parts = renderHighlights('ping @alice and @bob please');
    const spans = parts.filter((p) => React.isValidElement(p));
    expect(spans).toHaveLength(2);
  });

  it('handles slash-command combined with @mention', () => {
    const parts = renderHighlights('/skill @myagent');
    const spans = parts.filter((p) => React.isValidElement(p));
    // Both /skill and @myagent should be spans
    expect(spans.length).toBeGreaterThanOrEqual(2);
  });
});
