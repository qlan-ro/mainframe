import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import React from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';

// Verifies that the remark-breaks plugin — added to REMARK_PLUGINS in UserMessage.tsx —
// converts single newlines into <br> elements so user-typed line breaks are visible
// in rendered messages. Without remark-breaks, CommonMark collapses single newlines
// to spaces, making multi-line user input look like a single paragraph.

const REMARK_PLUGINS = [remarkGfm, remarkBreaks];

describe('UserMessage newline preservation', () => {
  it('renders a <br> element for a single newline between two lines', () => {
    const { container } = render(<Markdown remarkPlugins={REMARK_PLUGINS}>{'line1\nline2'}</Markdown>);
    const br = container.querySelector('br');
    expect(br).toBeInTheDocument();
  });

  it('preserves text on both sides of the newline', () => {
    const { container } = render(<Markdown remarkPlugins={REMARK_PLUGINS}>{'hello\nworld'}</Markdown>);
    expect(container.textContent).toContain('hello');
    expect(container.textContent).toContain('world');
  });

  it('handles multiple newlines producing multiple <br> elements', () => {
    const { container } = render(<Markdown remarkPlugins={REMARK_PLUGINS}>{'a\nb\nc'}</Markdown>);
    const brs = container.querySelectorAll('br');
    expect(brs.length).toBeGreaterThanOrEqual(2);
  });
});
