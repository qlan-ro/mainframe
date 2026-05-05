import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { FileTree } from './FileTree';

describe('FileTree', () => {
  const mockFile1 = { path: 'src/index.ts', status: 'modified' as const };
  const mockFile2 = { path: 'README.md', status: 'added' as const };
  const mockFile3 = { path: 'src/utils/helper.ts', status: 'deleted' as const };

  it('renders staged and unstaged sections when both have files', () => {
    const files = [mockFile1, mockFile2];
    const stagedFiles = new Set(['src/index.ts']);

    render(
      <FileTree
        stagedFiles={stagedFiles}
        files={files}
        selectedFile={null}
        onSelectFile={vi.fn()}
        onToggleStaged={vi.fn()}
        onStageAll={vi.fn()}
        onUnstageAll={vi.fn()}
      />,
    );

    const headers = screen.getAllByText(/\(/i);
    expect(headers.some((h) => h.textContent?.includes('Staged'))).toBe(true);
    expect(headers.some((h) => h.textContent?.includes('Unstaged'))).toBe(true);
  });

  it('renders only unstaged section when no files are staged', () => {
    const files = [mockFile1, mockFile2];
    const stagedFiles = new Set<string>();

    render(
      <FileTree
        stagedFiles={stagedFiles}
        files={files}
        selectedFile={null}
        onSelectFile={vi.fn()}
        onToggleStaged={vi.fn()}
        onStageAll={vi.fn()}
        onUnstageAll={vi.fn()}
      />,
    );

    const headers = screen.getAllByText(/\(/i);
    expect(headers.some((h) => h.textContent?.includes('Unstaged'))).toBe(true);
    expect(headers.some((h) => h.textContent?.includes('Staged'))).toBe(false);
  });

  it('renders only staged section when all files are staged', () => {
    const files = [mockFile1, mockFile2];
    const stagedFiles = new Set(['src/index.ts', 'README.md']);

    render(
      <FileTree
        stagedFiles={stagedFiles}
        files={files}
        selectedFile={null}
        onSelectFile={vi.fn()}
        onToggleStaged={vi.fn()}
        onStageAll={vi.fn()}
        onUnstageAll={vi.fn()}
      />,
    );

    const headers = screen.getAllByText(/\(/i);
    expect(headers.some((h) => h.textContent?.includes('Staged'))).toBe(true);
    expect(headers.some((h) => h.textContent?.includes('Unstaged'))).toBe(false);
  });

  it('displays file count in section headers', () => {
    const files = [mockFile1, mockFile2, mockFile3];
    const stagedFiles = new Set(['src/index.ts']);

    render(
      <FileTree
        stagedFiles={stagedFiles}
        files={files}
        selectedFile={null}
        onSelectFile={vi.fn()}
        onToggleStaged={vi.fn()}
        onStageAll={vi.fn()}
        onUnstageAll={vi.fn()}
      />,
    );

    expect(screen.getByText(/Staged \(1\)/)).toBeInTheDocument();
    expect(screen.getByText(/Unstaged \(2\)/)).toBeInTheDocument();
  });

  it('displays filenames extracted from full paths', () => {
    const files = [mockFile1, mockFile2];
    const stagedFiles = new Set<string>();

    render(
      <FileTree
        stagedFiles={stagedFiles}
        files={files}
        selectedFile={null}
        onSelectFile={vi.fn()}
        onToggleStaged={vi.fn()}
        onStageAll={vi.fn()}
        onUnstageAll={vi.fn()}
      />,
    );

    expect(screen.getByText('index.ts')).toBeInTheDocument();
    expect(screen.getByText('README.md')).toBeInTheDocument();
  });

  it('calls onSelectFile when a file item is clicked', async () => {
    const user = userEvent.setup();
    const onSelectFile = vi.fn();
    const files = [mockFile1];
    const stagedFiles = new Set<string>();

    render(
      <FileTree
        stagedFiles={stagedFiles}
        files={files}
        selectedFile={null}
        onSelectFile={onSelectFile}
        onToggleStaged={vi.fn()}
        onStageAll={vi.fn()}
        onUnstageAll={vi.fn()}
      />,
    );

    const fileItem = screen.getByText('index.ts').closest('div[class*="cursor-pointer"]');
    if (fileItem) {
      await user.click(fileItem);
    }

    expect(onSelectFile).toHaveBeenCalledWith('src/index.ts');
  });

  it('highlights selected file with appropriate styling', () => {
    const files = [mockFile1, mockFile2];
    const stagedFiles = new Set<string>();

    const { rerender } = render(
      <FileTree
        stagedFiles={stagedFiles}
        files={files}
        selectedFile={null}
        onSelectFile={vi.fn()}
        onToggleStaged={vi.fn()}
        onStageAll={vi.fn()}
        onUnstageAll={vi.fn()}
      />,
    );

    // Initially no file is selected
    const index = screen.getByText('index.ts').closest('div[class*="cursor-pointer"]');
    expect(index).not.toHaveClass('bg-mf-surface-secondary');

    // Rerender with file selected
    rerender(
      <FileTree
        stagedFiles={stagedFiles}
        files={files}
        selectedFile="src/index.ts"
        onSelectFile={vi.fn()}
        onToggleStaged={vi.fn()}
        onStageAll={vi.fn()}
        onUnstageAll={vi.fn()}
      />,
    );

    const selectedIndex = screen.getByText('index.ts').closest('div[class*="cursor-pointer"]');
    expect(selectedIndex).toHaveClass('bg-mf-surface-secondary');
  });

  it('calls onToggleStaged when checkbox is clicked for unstaged file', async () => {
    const user = userEvent.setup();
    const onToggleStaged = vi.fn();
    const files = [mockFile1];
    const stagedFiles = new Set<string>();

    render(
      <FileTree
        stagedFiles={stagedFiles}
        files={files}
        selectedFile={null}
        onSelectFile={vi.fn()}
        onToggleStaged={onToggleStaged}
        onStageAll={vi.fn()}
        onUnstageAll={vi.fn()}
      />,
    );

    const checkbox = screen.getByRole('checkbox', { name: /Stage index.ts/i });
    await user.click(checkbox);

    expect(onToggleStaged).toHaveBeenCalledWith('src/index.ts', true);
  });

  it('calls onToggleStaged with false when checkbox is clicked for staged file', async () => {
    const user = userEvent.setup();
    const onToggleStaged = vi.fn();
    const files = [mockFile1];
    const stagedFiles = new Set(['src/index.ts']);

    render(
      <FileTree
        stagedFiles={stagedFiles}
        files={files}
        selectedFile={null}
        onSelectFile={vi.fn()}
        onToggleStaged={onToggleStaged}
        onStageAll={vi.fn()}
        onUnstageAll={vi.fn()}
      />,
    );

    const checkbox = screen.getByRole('checkbox', { name: /Unstage index.ts/i });
    await user.click(checkbox);

    expect(onToggleStaged).toHaveBeenCalledWith('src/index.ts', false);
  });

  it('calls onStageAll when Stage All button is clicked', async () => {
    const user = userEvent.setup();
    const onStageAll = vi.fn();
    const files = [mockFile1, mockFile2];
    const stagedFiles = new Set<string>();

    render(
      <FileTree
        stagedFiles={stagedFiles}
        files={files}
        selectedFile={null}
        onSelectFile={vi.fn()}
        onToggleStaged={vi.fn()}
        onStageAll={onStageAll}
        onUnstageAll={vi.fn()}
      />,
    );

    const buttons = screen.getAllByRole('button');
    const stageAllButton = buttons.find((btn) => btn.textContent?.trim() === 'Stage All');
    if (stageAllButton) {
      await user.click(stageAllButton);
    }

    expect(onStageAll).toHaveBeenCalledOnce();
  });

  it('calls onUnstageAll when Unstage All button is clicked', async () => {
    const user = userEvent.setup();
    const onUnstageAll = vi.fn();
    const files = [mockFile1, mockFile2];
    const stagedFiles = new Set(['src/index.ts', 'README.md']);

    render(
      <FileTree
        stagedFiles={stagedFiles}
        files={files}
        selectedFile={null}
        onSelectFile={vi.fn()}
        onToggleStaged={vi.fn()}
        onStageAll={vi.fn()}
        onUnstageAll={onUnstageAll}
      />,
    );

    const buttons = screen.getAllByRole('button');
    const unstageAllButton = buttons.find((btn) => btn.textContent?.trim() === 'Unstage All');
    if (unstageAllButton) {
      await user.click(unstageAllButton);
    }

    expect(onUnstageAll).toHaveBeenCalledOnce();
  });

  it('renders status icons for different file states', () => {
    const files = [
      { path: 'src/index.ts', status: 'modified' as const },
      { path: 'new-file.ts', status: 'added' as const },
      { path: 'old-file.ts', status: 'deleted' as const },
      { path: 'renamed-file.ts', status: 'renamed' as const },
    ];
    const stagedFiles = new Set<string>();

    const { container } = render(
      <FileTree
        stagedFiles={stagedFiles}
        files={files}
        selectedFile={null}
        onSelectFile={vi.fn()}
        onToggleStaged={vi.fn()}
        onStageAll={vi.fn()}
        onUnstageAll={vi.fn()}
      />,
    );

    // Check that icons are rendered (emoji characters in text content)
    const text = container.textContent ?? '';
    expect(text).toContain('📄'); // modified icon
    expect(text).toContain('➕'); // added icon
    expect(text).toContain('🗑'); // deleted icon
    expect(text).toContain('🔄'); // renamed icon
  });

  it('renders empty state when no files provided', () => {
    const files: (typeof mockFile1)[] = [];
    const stagedFiles = new Set<string>();

    render(
      <FileTree
        stagedFiles={stagedFiles}
        files={files}
        selectedFile={null}
        onSelectFile={vi.fn()}
        onToggleStaged={vi.fn()}
        onStageAll={vi.fn()}
        onUnstageAll={vi.fn()}
      />,
    );

    // Should render the container and buttons, but no file sections
    const buttons = screen.getAllByRole('button');
    expect(buttons.find((btn) => btn.textContent?.trim() === 'Stage All')).toBeInTheDocument();
    const headers = screen.queryAllByText(/\(/i);
    expect(headers.some((h) => h.textContent?.includes('Staged'))).toBe(false);
    expect(headers.some((h) => h.textContent?.includes('Unstaged'))).toBe(false);
  });
});
