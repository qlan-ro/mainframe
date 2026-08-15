/**
 * FirstRunState — shared-store regression.
 *
 * FirstRunState.test.tsx mocks `useProjects` entirely, which is exactly why the
 * original bug (adding a project from the empty first-run state left the
 * sidebar/chat surface stuck on the empty hero until a full reload) went
 * uncaught: a mocked hook can't exercise the cross-instance update path. This
 * file renders FirstRunState next to a sibling consumer of the SAME real
 * `useProjects()` hook and asserts the sibling sees the new project — without
 * either component remounting — once Add project completes.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DaemonPortProvider } from '../../runtime/daemon-port-context';
import { resetProjectsStore } from '@/store/projects';
import { useProjects } from '../../use-projects';
import { FirstRunState } from '../FirstRunState';

const NEW_PROJECT = { id: 'p1', name: 'mainframe', path: '/r/mf', createdAt: '', lastOpenedAt: '' };

const getProjects = vi.fn();
const createProject = vi.fn();
vi.mock('@/lib/api/projects', () => ({
  getProjects: (...args: unknown[]) => getProjects(...args),
  createProject: (...args: unknown[]) => createProject(...args),
}));

const pickDirectory = vi.fn();
vi.mock('@/features/files/use-directory-picker', () => ({
  useDirectoryPicker: (selector: (s: { pickDirectory: typeof pickDirectory }) => unknown) =>
    selector({ pickDirectory }),
}));

vi.mock('@/lib/toast', () => ({
  mfToast: { success: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

// A sibling call site — a SEPARATE mounted instance of the same real hook,
// standing in for SessionSidebar/ChatSurface/etc.
function SiblingProjectCount() {
  const { projects } = useProjects();
  return <div data-testid="sibling-project-count">{projects.length}</div>;
}

beforeEach(() => {
  vi.clearAllMocks();
  resetProjectsStore();
});

describe('FirstRunState — shared project store', () => {
  it('updates a sibling useProjects() consumer after Add project, without remounting either component', async () => {
    getProjects.mockResolvedValue([]);
    pickDirectory.mockResolvedValue('/r/mf');
    createProject.mockResolvedValue({ project: NEW_PROJECT, alreadyExists: false });

    render(
      <DaemonPortProvider port={31415}>
        <FirstRunState />
        <SiblingProjectCount />
      </DaemonPortProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('sibling-project-count')).toHaveTextContent('0');
    });

    getProjects.mockResolvedValueOnce([NEW_PROJECT]);
    fireEvent.click(screen.getByTestId('sessions-firstrun-add-project'));

    await waitFor(() => {
      expect(screen.getByTestId('sibling-project-count')).toHaveTextContent('1');
    });
  });
});
