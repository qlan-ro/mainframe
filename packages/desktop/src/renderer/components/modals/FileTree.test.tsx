import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { FileTree } from './FileTree';

describe('FileTree', () => {
  const mockFile1 = { path: 'src/index.ts', status: 'modified' as const };
  const mockFile2 = { path: 'README.md', status: 'added' as const };
  const mockFile3 = { path: 'src/utils/helper.ts', status: 'deleted' as const };
  const mockFile4 = { path: 'src/old.ts', status: 'renamed' as const };

  it('renders the changes header with file count', () => {
    render(<FileTree files={[mockFile1, mockFile2]} selectedFile={null} onSelectFile={vi.fn()} />);
    expect(screen.getByText(/Changes \(2\)/i)).toBeInTheDocument();
  });

  it('renders nothing in the list when there are no files', () => {
    render(<FileTree files={[]} selectedFile={null} onSelectFile={vi.fn()} />);
    expect(screen.getByText(/Changes \(0\)/i)).toBeInTheDocument();
    expect(screen.queryByText('index.ts')).not.toBeInTheDocument();
  });

  it('renders one row per file using the basename', () => {
    render(<FileTree files={[mockFile1, mockFile2, mockFile3]} selectedFile={null} onSelectFile={vi.fn()} />);
    expect(screen.getByText('index.ts')).toBeInTheDocument();
    expect(screen.getByText('README.md')).toBeInTheDocument();
    expect(screen.getByText('helper.ts')).toBeInTheDocument();
  });

  it('renders the correct status icon per file', () => {
    render(
      <FileTree files={[mockFile1, mockFile2, mockFile3, mockFile4]} selectedFile={null} onSelectFile={vi.fn()} />,
    );
    expect(screen.getByText('📄')).toBeInTheDocument(); // modified
    expect(screen.getByText('➕')).toBeInTheDocument(); // added
    expect(screen.getByText('🗑')).toBeInTheDocument(); // deleted
    expect(screen.getByText('🔄')).toBeInTheDocument(); // renamed
  });

  it('calls onSelectFile when a file row is clicked', async () => {
    const onSelectFile = vi.fn();
    const user = userEvent.setup();
    render(<FileTree files={[mockFile1, mockFile2]} selectedFile={null} onSelectFile={onSelectFile} />);

    await user.click(screen.getByText('index.ts'));
    expect(onSelectFile).toHaveBeenCalledWith('src/index.ts');
  });

  it('highlights the selected file row', () => {
    const { rerender } = render(<FileTree files={[mockFile1, mockFile2]} selectedFile={null} onSelectFile={vi.fn()} />);

    const indexRow = screen.getByText('index.ts').closest('div[class*="cursor-pointer"]');
    expect(indexRow).not.toHaveClass('bg-mf-hover');

    rerender(<FileTree files={[mockFile1, mockFile2]} selectedFile="src/index.ts" onSelectFile={vi.fn()} />);

    const selectedRow = screen.getByText('index.ts').closest('div[class*="cursor-pointer"]');
    expect(selectedRow).toHaveClass('bg-mf-hover');
  });
});
