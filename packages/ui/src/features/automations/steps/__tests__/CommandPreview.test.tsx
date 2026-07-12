/**
 * CommandPreview — A1's read-only "what will run" block: renders
 * `buildCommandPreview` (already pure-tested in domain/command-preview.ts)
 * as quoted `"$MF_<n>"` text plus the won't-expand warning. TDD: test
 * written first, implemented after.
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ChipText } from '../../contract';
import { CommandPreview } from '../CommandPreview';

describe('CommandPreview', () => {
  it('renders literal text and quoted "$MF_n" placeholders where chips sat', () => {
    const script: ChipText = ['echo ', { token: { stepId: 'a', output: 'scope' } }, ' done'];
    render(<CommandPreview script={script} testId="automations-preview-a" />);
    const pre = screen.getByTestId('automations-preview-a-text');
    expect(pre).toHaveTextContent('echo "$MF_1" done');
  });

  it('shows no warning when no chip sits inside single quotes or a quoted heredoc', () => {
    const script: ChipText = ['echo ', { token: { stepId: 'a', output: 'scope' } }];
    render(<CommandPreview script={script} testId="automations-preview-a" />);
    expect(screen.queryByTestId('automations-preview-a-warning-0')).not.toBeInTheDocument();
  });

  it('shows a plain-language warning for a chip inside single quotes', () => {
    const script: ChipText = ["echo '", { token: { stepId: 'a', output: 'scope' } }, "'"];
    render(<CommandPreview script={script} testId="automations-preview-a" />);
    expect(screen.getByTestId('automations-preview-a-warning-1')).toHaveTextContent(/will not expand/i);
  });

  it('shows a plain-language warning for a chip inside a quoted heredoc', () => {
    const script: ChipText = ["cat <<'EOF'\n", { token: { stepId: 'a', output: 'scope' } }, '\nEOF'];
    render(<CommandPreview script={script} testId="automations-preview-a" />);
    expect(screen.getByTestId('automations-preview-a-warning-1')).toHaveTextContent(/will not expand/i);
  });

  it('renders an empty-state when the script has no chips and no text', () => {
    render(<CommandPreview script={[]} testId="automations-preview-a" />);
    expect(screen.getByTestId('automations-preview-a-text')).toHaveTextContent('');
  });
});
