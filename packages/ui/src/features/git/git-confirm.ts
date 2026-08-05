/**
 * Git's binding of the app-wide confirm bridge. It exists only to pin the
 * `git-confirm-dialog` testid the git e2e specs assert, in one place instead of
 * at each of the four git call sites.
 */
import { requestConfirm, type ConfirmRequest } from '@/lib/confirm-bridge';

export const requestGitConfirm = (opts: Omit<ConfirmRequest, 'testid'>): Promise<boolean> =>
  requestConfirm({ ...opts, testid: 'git-confirm-dialog' });
