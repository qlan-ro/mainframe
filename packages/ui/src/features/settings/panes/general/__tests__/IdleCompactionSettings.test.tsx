import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GENERAL_DEFAULTS } from '@qlan-ro/mainframe-types';
import { GeneralPane } from '../GeneralPane';
import { useSettingsStore } from '@/store/settings';

const update = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api/settings', () => ({ updateGeneralSettings: update }));

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  useSettingsStore.getState().loadGeneral(structuredClone(GENERAL_DEFAULTS));
  update.mockReset().mockResolvedValue(undefined);
});

describe('idle compaction settings', () => {
  it('places Chats between directory and Updates with an accessible, default-off switch', () => {
    render(<GeneralPane port={9999} />);
    expect(screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)).toEqual([
      'Appearance',
      'Worktree directory',
      'Chats',
      'Updates',
    ]);
    const toggle = screen.getByRole('switch', { name: 'Compact idle chats' });
    expect(toggle).toHaveAttribute('data-testid', 'idle-compaction-enabled');
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(toggle).toHaveAccessibleDescription(
      "Summarize long idle chats before the provider's prompt cache expires, so returning is cheaper.",
    );
    expect(update).not.toHaveBeenCalled();
  });

  it('disables pending writes and merges only an acknowledged toggle into the latest settings', async () => {
    const request = deferred();
    update.mockReturnValueOnce(request.promise);
    render(<GeneralPane port={9999} />);
    const toggle = screen.getByTestId('idle-compaction-enabled');
    fireEvent.click(toggle);
    expect(toggle).toBeDisabled();
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(useSettingsStore.getState().general.idleCompaction.enabled).toBe(false);
    fireEvent.click(toggle);
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith(9999, { idleCompaction: { enabled: true } });
    act(() =>
      useSettingsStore.getState().patchGeneral({ worktreeDir: 'other', notifications: { other: { plugin: false } } }),
    );
    await act(async () => request.resolve());
    expect(toggle).not.toBeDisabled();
    expect(useSettingsStore.getState().general).toMatchObject({
      idleCompaction: { enabled: true },
      worktreeDir: 'other',
      notifications: { other: { plugin: false } },
    });
  });

  it('rolls back failure without replacing concurrent settings and can retry', async () => {
    const request = deferred();
    update.mockReturnValueOnce(request.promise);
    render(<GeneralPane port={9999} />);
    const toggle = screen.getByTestId('idle-compaction-enabled');
    fireEvent.click(toggle);
    act(() => useSettingsStore.getState().patchGeneral({ updateChannel: 'prerelease' }));
    await act(async () => request.reject(new Error('Save unavailable')));
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(toggle).not.toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('Save unavailable');
    expect(useSettingsStore.getState().general.updateChannel).toBe('prerelease');
    fireEvent.click(toggle);
    await waitFor(() => expect(toggle).not.toBeDisabled());
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('retains the saved toggle when an earlier directory save acknowledges later', async () => {
    const directory = deferred();
    update.mockReturnValueOnce(directory.promise);
    render(<GeneralPane port={9999} />);
    fireEvent.change(screen.getByTestId('settings-worktree-dir-input'), { target: { value: 'other' } });
    fireEvent.click(screen.getByTestId('settings-worktree-dir-save'));
    fireEvent.click(screen.getByTestId('idle-compaction-enabled'));
    await waitFor(() => expect(useSettingsStore.getState().general.idleCompaction.enabled).toBe(true));
    await act(async () => directory.resolve());
    expect(useSettingsStore.getState().general).toMatchObject({
      idleCompaction: { enabled: true },
      worktreeDir: 'other',
    });
  });
});
