import { act, fireEvent, render, screen, within } from '@testing-library/react';
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

function items(): HTMLElement[] {
  return within(screen.getByTestId('history-release-group')).getAllByRole('radio');
}

function selected(): string[] {
  return items()
    .filter((item) => item.getAttribute('aria-checked') === 'true')
    .map((item) => item.textContent ?? '');
}

beforeEach(() => {
  useSettingsStore.getState().loadGeneral(structuredClone(GENERAL_DEFAULTS));
  update.mockReset().mockResolvedValue(undefined);
});

describe('history release settings', () => {
  it('offers 5, 10, 30 and 60 minutes or never in Chats, with 10 minutes selected by default', () => {
    render(<GeneralPane port={9999} />);
    const group = screen.getByTestId('history-release-group');
    expect(group).toHaveAccessibleName('Free memory of idle chats');
    expect(group).toHaveAccessibleDescription(
      "After this long unopened and unused, a chat's history leaves memory. It reloads when you return.",
    );
    expect(items().map((item) => item.textContent)).toEqual(['5 min', '10 min', '30 min', '1 hour', 'Never']);
    expect(selected()).toEqual(['10 min']);
    expect(update).not.toHaveBeenCalled();
  });

  it('saves a new idle time and keeps the choice disabled until the daemon acknowledges it', async () => {
    const request = deferred();
    update.mockReturnValueOnce(request.promise);
    render(<GeneralPane port={9999} />);

    fireEvent.click(screen.getByTestId('history-release-30'));

    expect(update).toHaveBeenCalledWith(9999, { historyRelease: { idleMinutes: 30 } });
    expect(screen.getByTestId('history-release-5')).toBeDisabled();
    expect(selected()).toEqual(['30 min']);
    expect(useSettingsStore.getState().general.historyRelease.idleMinutes).toBe(10);
    await act(async () => request.resolve());
    expect(useSettingsStore.getState().general.historyRelease.idleMinutes).toBe(30);
    expect(screen.getByTestId('history-release-5')).not.toBeDisabled();
  });

  it('stores never as null', async () => {
    render(<GeneralPane port={9999} />);
    await act(async () => fireEvent.click(screen.getByTestId('history-release-never')));
    expect(update).toHaveBeenCalledWith(9999, { historyRelease: { idleMinutes: null } });
    expect(useSettingsStore.getState().general.historyRelease.idleMinutes).toBeNull();
    expect(selected()).toEqual(['Never']);
  });

  it('rolls back a failed save and shows why', async () => {
    const request = deferred();
    update.mockReturnValueOnce(request.promise);
    render(<GeneralPane port={9999} />);
    fireEvent.click(screen.getByTestId('history-release-60'));
    await act(async () => request.reject(new Error('Save unavailable')));
    expect(selected()).toEqual(['10 min']);
    expect(screen.getByRole('alert')).toHaveTextContent('Save unavailable');
  });

  it('shows a stored idle time the UI does not offer', () => {
    useSettingsStore.getState().patchGeneral({ historyRelease: { idleMinutes: 15 } });
    render(<GeneralPane port={9999} />);
    expect(selected()).toEqual(['15 min']);
  });
});
