import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AssistantErrorBlock } from '../AssistantErrorBlock';

const HEADLINE = 'OpenAI kept dropping the response and Codex gave up retrying.';
const RAW = 'stream disconnected before completion: stream closed before response.completed';

describe('AssistantErrorBlock', () => {
  it('renders the headline in the destructive style and the original text muted, mono and selectable', () => {
    render(<AssistantErrorBlock text={`${HEADLINE}\n\n${RAW}`} />);
    const headline = screen.getByText(HEADLINE);
    expect(headline).toHaveClass('text-destructive');
    const raw = screen.getByText(RAW);
    expect(raw).toHaveClass('text-muted-foreground', 'font-mono', 'text-xs', 'select-text');
    expect(raw).not.toHaveClass('text-destructive');
    expect(screen.getByTestId('chat-error-block')).toContainElement(raw);
  });

  it('splits only at the first blank line and keeps the rest verbatim', () => {
    render(<AssistantErrorBlock text={'Headline\n\nOpenAI: line one\n\nline two'} />);
    expect(screen.getByText('Headline')).toHaveClass('text-destructive');
    const raw = screen.getByText(/OpenAI: line one/);
    expect(raw.textContent).toBe('OpenAI: line one\n\nline two');
    expect(raw).toHaveClass('whitespace-pre-wrap');
  });

  it('renders a message with no blank line exactly as before, with no second block', () => {
    const { container } = render(
      <AssistantErrorBlock text={'Selected model is at capacity.\nPlease try a different model.'} />,
    );
    expect(container.querySelectorAll('.font-mono')).toHaveLength(0);
    expect(screen.getByText(/Selected model is at capacity\./)).toHaveClass('text-destructive');
  });

  it('treats an empty remainder as no split', () => {
    const { container } = render(<AssistantErrorBlock text={'Only a headline\n\n'} />);
    expect(container.querySelectorAll('.font-mono')).toHaveLength(0);
    expect(screen.getByText(/Only a headline/)).toHaveClass('text-destructive');
  });
});
