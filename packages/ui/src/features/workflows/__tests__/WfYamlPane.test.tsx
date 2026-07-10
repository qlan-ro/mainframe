/**
 * WfYamlPane — TDD tests for the read-only generated preview (Task 19).
 *
 * Covers:
 * - renders the yaml text (no editable textarea/textbox)
 * - the header validity chip still reflects validation (Valid / N issues)
 * - the copy button copies the yaml prop to the clipboard
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { WfYamlPane } from '@/features/workflows/editor/WfYamlPane';

const SAMPLE_YAML = `version: 1
name: greet
steps:
  - id: say
    set:
      msg: "hi"
`;

describe('WfYamlPane', () => {
  beforeEach(() => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  it('renders the yaml content in a read-only preview', () => {
    render(<WfYamlPane yaml={SAMPLE_YAML} validation={null} filename="greet.yaml" />);
    expect(screen.getByTestId('workflows-editor-yaml').textContent).toContain('name: greet');
  });

  it('has no editable textarea or textbox', () => {
    render(<WfYamlPane yaml={SAMPLE_YAML} validation={null} filename="greet.yaml" />);
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(document.querySelector('textarea')).not.toBeInTheDocument();
  });

  it('shows the filename in the header', () => {
    render(<WfYamlPane yaml={SAMPLE_YAML} validation={null} filename="greet.yaml" />);
    expect(screen.getByText('greet.yaml')).toBeInTheDocument();
  });

  it('shows a Valid chip when validation.valid is true', () => {
    render(<WfYamlPane yaml={SAMPLE_YAML} validation={{ valid: true, errors: [] }} filename="greet.yaml" />);
    expect(screen.getByText('Valid')).toBeInTheDocument();
  });

  it('shows an issue-count chip when validation.valid is false', () => {
    render(
      <WfYamlPane
        yaml={SAMPLE_YAML}
        validation={{ valid: false, errors: [{ message: 'bad' }, { message: 'worse' }] }}
        filename="greet.yaml"
      />,
    );
    expect(screen.getByText('2 issues')).toBeInTheDocument();
  });

  it('settles to an issue-count chip (not "Validating…") when the validate request itself failed', () => {
    render(
      <WfYamlPane
        yaml={SAMPLE_YAML}
        validation={null}
        validationError={`steps: Too small: expected array to have >=1 items`}
        filename="greet.yaml"
      />,
    );
    expect(screen.queryByText('Validating…')).not.toBeInTheDocument();
    expect(screen.getByText('1 issue')).toBeInTheDocument();
  });

  it('shows Validating… only while there is no settled validation and no validate error', () => {
    render(<WfYamlPane yaml={SAMPLE_YAML} validation={null} filename="greet.yaml" />);
    expect(screen.getByText('Validating…')).toBeInTheDocument();
  });

  it('copies the yaml to the clipboard when the copy button is clicked', async () => {
    render(<WfYamlPane yaml={SAMPLE_YAML} validation={null} filename="greet.yaml" />);
    fireEvent.click(screen.getByTestId('workflows-editor-yaml-copy'));
    await vi.waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(SAMPLE_YAML);
    });
  });
});
