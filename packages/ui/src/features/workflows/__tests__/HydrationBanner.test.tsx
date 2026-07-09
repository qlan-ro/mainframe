/**
 * HydrationBanner — TDD tests (Task 20).
 *
 * Covers:
 * - renders the raw YAML read-only and the banner message with the reason
 * - no Convert button when onConvert is absent (unparseable file)
 * - Convert button renders and calls onConvert when present (comments-only file)
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { HydrationBanner } from '@/features/workflows/editor/HydrationBanner';

const RAW_YAML = `version: 1
name: greet
steps:
  - id: say
    set:
      msg: "hi" # a comment
`;

describe('HydrationBanner', () => {
  it('renders the banner message including the reason', () => {
    render(<HydrationBanner reason="invalid YAML: unexpected token" rawYaml={RAW_YAML} />);
    const message = screen.getByTestId('workflows-hydration-banner-message');
    expect(message).toHaveTextContent("This workflow can't be edited visually");
    expect(message).toHaveTextContent('invalid YAML: unexpected token');
  });

  it('renders the raw YAML read-only', () => {
    render(<HydrationBanner reason="invalid YAML: unexpected token" rawYaml={RAW_YAML} />);
    expect(screen.getByTestId('workflows-hydration-banner-yaml').textContent).toContain('name: greet');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('does not render a Convert button when onConvert is absent', () => {
    render(<HydrationBanner reason="invalid YAML: unexpected token" rawYaml={RAW_YAML} />);
    expect(screen.queryByTestId('workflows-hydration-banner-convert')).not.toBeInTheDocument();
  });

  it('renders a Convert button and calls onConvert on click when present', () => {
    const onConvert = vi.fn();
    render(
      <HydrationBanner reason="this file has comments that would be lost" rawYaml={RAW_YAML} onConvert={onConvert} />,
    );
    const button = screen.getByTestId('workflows-hydration-banner-convert');
    fireEvent.click(button);
    expect(onConvert).toHaveBeenCalledOnce();
  });
});
