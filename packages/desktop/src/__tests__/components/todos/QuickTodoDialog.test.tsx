import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ---- Module mocks --------------------------------------------------------

vi.mock('../../../renderer/store/plugins', () => ({
  usePluginLayoutStore: vi.fn(),
}));

vi.mock('../../../renderer/hooks/useActiveProjectId', () => ({
  getActiveProjectId: vi.fn(() => 'proj-1'),
}));

vi.mock('../../../renderer/lib/api/todos-api', () => ({
  todosApi: {
    list: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue({ id: 'todo-1', number: 1, title: 'Test' }),
    uploadAttachment: vi.fn().mockResolvedValue({ id: 'att-1' }),
  },
}));

vi.mock('../../../renderer/lib/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
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

import { usePluginLayoutStore } from '../../../renderer/store/plugins';
import { todosApi } from '../../../renderer/lib/api/todos-api';
import { QuickTodoDialog } from '../../../renderer/components/todos/QuickTodoDialog';

// ---- Helpers -------------------------------------------------------------

/** Returns a store mock that simulates the dialog being triggered (open). */
function makeOpenStore() {
  const clearTriggeredAction = vi.fn();
  vi.mocked(usePluginLayoutStore).mockImplementation((selector) => {
    const state = {
      triggeredAction: { pluginId: 'todos', actionId: 'quick-create' },
      clearTriggeredAction,
    };
    // selector-based usage
    if (typeof selector === 'function') {
      return (selector as (s: typeof state) => unknown)(state);
    }
    return state;
  });
  return { clearTriggeredAction };
}

/** Creates a minimal image File / ClipboardItem for paste simulation. */
function makeImageFile(name = 'paste.png', type = 'image/png'): File {
  const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]); // PNG magic bytes
  return new File([bytes], name, { type });
}

// ---- Tests ---------------------------------------------------------------

describe('QuickTodoDialog – image preview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing when not triggered', () => {
    vi.mocked(usePluginLayoutStore).mockImplementation((selector) => {
      const state = { triggeredAction: null, clearTriggeredAction: vi.fn() };
      if (typeof selector === 'function') return (selector as (s: typeof state) => unknown)(state);
      return state;
    });

    const { container } = render(<QuickTodoDialog />);
    expect(container.firstChild).toBeNull();
  });

  it('shows a thumbnail after pasting an image', async () => {
    makeOpenStore();
    render(<QuickTodoDialog />);

    const textarea = screen.getByPlaceholderText('Details (optional)');

    const file = makeImageFile();
    const clipboardData = {
      items: [{ type: 'image/png', getAsFile: () => file }],
    };

    fireEvent.paste(textarea, { clipboardData });

    await waitFor(() => {
      expect(screen.getByRole('img', { name: 'paste.png' })).toBeInTheDocument();
    });
  });

  it('removes a thumbnail when the remove button is clicked', async () => {
    makeOpenStore();
    render(<QuickTodoDialog />);

    const textarea = screen.getByPlaceholderText('Details (optional)');
    const file = makeImageFile();
    fireEvent.paste(textarea, { clipboardData: { items: [{ type: 'image/png', getAsFile: () => file }] } });

    await waitFor(() => {
      expect(screen.getByRole('img', { name: 'paste.png' })).toBeInTheDocument();
    });

    const removeBtn = screen.getByLabelText('Remove paste.png');
    await userEvent.click(removeBtn);

    expect(screen.queryByRole('img', { name: 'paste.png' })).not.toBeInTheDocument();
  });

  it('uploads pending files on save', async () => {
    makeOpenStore();
    render(<QuickTodoDialog />);

    // Type a title so the form can be submitted
    const titleInput = screen.getByPlaceholderText('What needs to be done?');
    await userEvent.type(titleInput, 'My task');

    // Paste an image
    const textarea = screen.getByPlaceholderText('Details (optional)');
    const file = makeImageFile();
    fireEvent.paste(textarea, { clipboardData: { items: [{ type: 'image/png', getAsFile: () => file }] } });

    await waitFor(() => {
      expect(screen.getByRole('img', { name: 'paste.png' })).toBeInTheDocument();
    });

    // Submit
    const createBtn = screen.getByRole('button', { name: 'Create' });
    await userEvent.click(createBtn);

    await waitFor(() => {
      expect(vi.mocked(todosApi.create)).toHaveBeenCalled();
      expect(vi.mocked(todosApi.uploadAttachment)).toHaveBeenCalledWith(
        'todo-1',
        expect.objectContaining({ filename: 'paste.png', mimeType: 'image/png' }),
      );
    });
  });
});
