import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ---- Module mocks --------------------------------------------------------

vi.mock('../../../renderer/lib/api/todos-api', () => ({
  todosApi: {
    uploadAttachment: vi.fn().mockResolvedValue({ id: 'att-1' }),
    listAttachments: vi.fn().mockResolvedValue([]),
    getAttachment: vi.fn().mockResolvedValue({}),
    deleteAttachment: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../../renderer/lib/logger', () => ({
  createLogger: () => ({
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  }),
}));

// ---- Imports after mocks -------------------------------------------------

import { todosApi } from '../../../renderer/lib/api/todos-api';
import { TodoModal } from '../../../renderer/components/todos/TodoModal';
import type { PendingAttachment } from '../../../renderer/components/todos/TodoModal';

// ---- Helpers -------------------------------------------------------------

function makeImageFile(name = 'capture.png', type = 'image/png'): File {
  const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
  return new File([bytes], name, { type });
}

const noop = vi.fn();

// ---- Tests ---------------------------------------------------------------

describe('TodoModal – image preview (new todo)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows a thumbnail after pasting an image', async () => {
    render(<TodoModal onClose={noop} onSave={noop} />);

    const textarea = screen.getByPlaceholderText('Describe the task...');
    const file = makeImageFile();
    fireEvent.paste(textarea, {
      clipboardData: { items: [{ type: 'image/png', getAsFile: () => file }] },
    });

    await waitFor(() => {
      expect(screen.getByRole('img', { name: 'capture.png' })).toBeInTheDocument();
    });
  });

  it('removes a pending thumbnail via remove button', async () => {
    render(<TodoModal onClose={noop} onSave={noop} />);

    const textarea = screen.getByPlaceholderText('Describe the task...');
    const file = makeImageFile();
    fireEvent.paste(textarea, {
      clipboardData: { items: [{ type: 'image/png', getAsFile: () => file }] },
    });

    await waitFor(() => {
      expect(screen.getByRole('img', { name: 'capture.png' })).toBeInTheDocument();
    });

    await userEvent.click(screen.getByLabelText('Remove capture.png'));

    expect(screen.queryByRole('img', { name: 'capture.png' })).not.toBeInTheDocument();
  });

  it('passes pendingAttachments to onSave when files are pending', async () => {
    const onSave = vi.fn();
    render(<TodoModal onClose={noop} onSave={onSave} />);

    // Set title
    const titleInput = screen.getByPlaceholderText('Task title');
    await userEvent.type(titleInput, 'New task with image');

    // Paste image
    const textarea = screen.getByPlaceholderText('Describe the task...');
    const file = makeImageFile();
    fireEvent.paste(textarea, {
      clipboardData: { items: [{ type: 'image/png', getAsFile: () => file }] },
    });

    await waitFor(() => {
      expect(screen.getByRole('img', { name: 'capture.png' })).toBeInTheDocument();
    });

    // Submit the form
    await userEvent.click(screen.getByRole('button', { name: 'Save Task' }));

    expect(onSave).toHaveBeenCalledTimes(1);
    const [_formData, attachments] = onSave.mock.calls[0] as [unknown, PendingAttachment[] | undefined];
    expect(attachments).toHaveLength(1);
    expect(attachments?.[0]).toMatchObject({ filename: 'capture.png', mimeType: 'image/png' });
  });

  it('calls onSave with no attachments when no files are pending', async () => {
    const onSave = vi.fn();
    render(<TodoModal onClose={noop} onSave={onSave} />);

    const titleInput = screen.getByPlaceholderText('Task title');
    await userEvent.type(titleInput, 'Simple task');

    await userEvent.click(screen.getByRole('button', { name: 'Save Task' }));

    expect(onSave).toHaveBeenCalledTimes(1);
    const [_formData, attachments] = onSave.mock.calls[0] as [unknown, PendingAttachment[] | undefined];
    expect(attachments).toBeUndefined();
  });
});

describe('TodoModal – image preview (edit todo)', () => {
  const existingTodo = {
    id: 'todo-existing',
    number: 42,
    project_id: 'proj-1',
    title: 'Existing task',
    body: 'Some description',
    status: 'open' as const,
    type: 'feature' as const,
    priority: 'medium' as const,
    labels: [],
    assignees: [],
    dependencies: [],
    order_index: 0,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders TodoAttachments section (not pending previews) for existing todo', async () => {
    render(<TodoModal todo={existingTodo} onClose={noop} onSave={noop} />);

    // The "Add image" button from TodoAttachments should be visible
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /add image/i })).toBeInTheDocument();
    });
  });

  it('uploads directly on paste when editing an existing todo', async () => {
    render(<TodoModal todo={existingTodo} onClose={noop} onSave={noop} />);

    const textarea = screen.getByPlaceholderText('Describe the task...');
    const file = makeImageFile('edit-paste.png');
    fireEvent.paste(textarea, {
      clipboardData: { items: [{ type: 'image/png', getAsFile: () => file }] },
    });

    await waitFor(() => {
      expect(vi.mocked(todosApi.uploadAttachment)).toHaveBeenCalledWith(
        'todo-existing',
        expect.objectContaining({ filename: 'edit-paste.png', mimeType: 'image/png' }),
      );
    });
  });
});
