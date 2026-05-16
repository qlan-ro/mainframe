import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/api/files-api', () => ({
  browseFilesystem: vi.fn(),
}));

vi.mock('../../lib/logger', () => ({
  createLogger: () => ({ warn: vi.fn(), error: vi.fn() }),
}));

import { DirectoryPickerModal } from '../DirectoryPickerModal';
import { browseFilesystem } from '../../lib/api/files-api';

const mockEntries = [
  { name: 'projects', path: '/home/user/projects', type: 'directory' as const },
  { name: 'documents', path: '/home/user/documents', type: 'directory' as const },
  { name: 'claude', path: '/usr/local/bin/claude', type: 'file' as const },
  { name: 'node', path: '/usr/local/bin/node', type: 'file' as const },
];

beforeEach(() => {
  vi.mocked(browseFilesystem).mockReset();
  vi.mocked(browseFilesystem).mockResolvedValue({
    path: '/home/user',
    entries: mockEntries,
  });
});

describe('DirectoryPickerModal: default mode (no mode prop)', () => {
  it('renders only directories, not files', async () => {
    render(<DirectoryPickerModal open onSelect={vi.fn()} onCancel={vi.fn()} />);

    await waitFor(() => expect(screen.getByText('projects')).toBeInTheDocument());

    expect(screen.getByText('documents')).toBeInTheDocument();
    expect(screen.queryByText('claude')).not.toBeInTheDocument();
    expect(screen.queryByText('node')).not.toBeInTheDocument();
  });

  it('calls browseFilesystem without includeFiles on initial load', async () => {
    render(<DirectoryPickerModal open onSelect={vi.fn()} onCancel={vi.fn()} />);

    await waitFor(() => expect(browseFilesystem).toHaveBeenCalled());

    const call = vi.mocked(browseFilesystem).mock.calls[0]!;
    // Called with no args or with opts where includeFiles is falsy
    const opts = call[1] as { includeFiles?: boolean } | undefined;
    expect(opts?.includeFiles).toBeFalsy();
  });

  it('selecting a directory enables confirm and calls onSelect with directory path', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<DirectoryPickerModal open onSelect={onSelect} onCancel={vi.fn()} />);

    await waitFor(() => expect(screen.getByText('projects')).toBeInTheDocument());

    await user.click(screen.getByTestId('dir-entry-/home/user/projects'));

    const selectBtn = screen.getByTestId('dir-picker-select-btn');
    expect(selectBtn).not.toBeDisabled();
    await user.click(selectBtn);

    expect(onSelect).toHaveBeenCalledWith('/home/user/projects');
  });
});

describe('DirectoryPickerModal: mode="file"', () => {
  it('renders both file and directory entries', async () => {
    render(<DirectoryPickerModal open mode="file" onSelect={vi.fn()} onCancel={vi.fn()} />);

    await waitFor(() => expect(screen.getByText('projects')).toBeInTheDocument());

    expect(screen.getByText('documents')).toBeInTheDocument();
    expect(screen.getByText('claude')).toBeInTheDocument();
    expect(screen.getByText('node')).toBeInTheDocument();
  });

  it('calls browseFilesystem with includeFiles: true', async () => {
    render(<DirectoryPickerModal open mode="file" onSelect={vi.fn()} onCancel={vi.fn()} />);

    await waitFor(() => expect(browseFilesystem).toHaveBeenCalled());

    const call = vi.mocked(browseFilesystem).mock.calls[0]!;
    const opts = call[1] as { includeFiles?: boolean } | undefined;
    expect(opts?.includeFiles).toBe(true);
  });

  it('confirm is disabled when a directory is highlighted', async () => {
    const user = userEvent.setup();
    render(<DirectoryPickerModal open mode="file" onSelect={vi.fn()} onCancel={vi.fn()} />);

    await waitFor(() => expect(screen.getByText('projects')).toBeInTheDocument());

    await user.click(screen.getByTestId('dir-entry-/home/user/projects'));

    expect(screen.getByTestId('dir-picker-select-btn')).toBeDisabled();
  });

  it('selecting a file enables confirm and calls onSelect with the file absolute path', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<DirectoryPickerModal open mode="file" onSelect={onSelect} onCancel={vi.fn()} />);

    await waitFor(() => expect(screen.getByText('claude')).toBeInTheDocument());

    await user.click(screen.getByTestId('dir-entry-/usr/local/bin/claude'));

    const selectBtn = screen.getByTestId('dir-picker-select-btn');
    expect(selectBtn).not.toBeDisabled();
    await user.click(selectBtn);

    expect(onSelect).toHaveBeenCalledWith('/usr/local/bin/claude');
  });
});
