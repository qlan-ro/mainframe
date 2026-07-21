/**
 * TasksSidebarSection — the left-sidebar "Tasks" section.
 *
 * Per HIG, Tasks are a navigable collection of work items (like Sessions),
 * not contextual detail about the current selection — so this section
 * replaced the right-inspector TasksDrawer and mirrors the Sessions
 * section's own structure: a group header (label + expand-to-modal button) →
 * a full-width "+ New task" row (SessionsNewButton's ROW_BTN treatment) →
 * task rows.
 *
 * Self-contained like SessionSidebar/BottomPanel: scopes itself to the
 * active project via useActiveIdentity and renders nothing without one
 * (matches the old `{projectId && <TasksDrawer .../>}` guard).
 *
 * No internal scroll region: TasksSidebarList caps itself at a few rows and
 * ends with a "View all N tasks" row into the full Tasks view, so a long
 * backlog can't crowd the Sessions list off the visible sidebar.
 *
 * data-testid="tasks-sidebar-section".
 */
import { useState } from 'react';
import { ExternalLink, Plus } from 'lucide-react';
import { Hint } from '@/components/ui/hint';
import { useActiveIdentity } from '@/features/sessions/use-active-identity';
import { useDaemonPort } from '@/features/sessions/runtime/daemon-port-context';
import { useUiPrefs, isSidebarSectionCollapsed } from '@/store/ui-prefs';
import { SidebarSectionChevron } from '@/layout/SidebarSectionChevron';
import { useTodosStore } from './use-todos-store';
import { useTasksModal } from './use-tasks-modal';
import { useStartTodoSession } from './use-start-todo-session';
import { TaskEditModal } from './TaskEditModal';
import { TasksSidebarList } from './TasksSidebarList';
import { extractAllLabels } from './todos-filters';
import { sidebarIndentPx, SIDEBAR_INDENT_STEP_PX } from '@/layout/sidebar-indent';

// Matches SessionsNewButton's ROW_BTN exactly. px-[12px] (not px-2/4px): matches
// SIDEBAR_BASE_INSET_PX, so the wrapping SIDEBAR_INDENT_STEP_PX margin below
// lands this row's content at the same Level-1 position as its task-row children.
const ROW_BTN =
  'flex h-[28px] w-full items-center gap-[8px] rounded-md px-[12px] text-label font-medium tracking-normal text-muted-foreground transition-colors hover:bg-accent hover:text-foreground';

/** Matches SessionsMoreMenu's ICON_BTN, for a consistent header icon-button look. */
const ICON_BTN =
  'inline-flex size-[22px] items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground';

export function TasksSidebarSection() {
  const { projectId } = useActiveIdentity();
  const port = useDaemonPort();
  const { todos } = useTodosStore();
  const openModal = useTasksModal((s) => s.openModal);
  const startTodoSession = useStartTodoSession(port, projectId);
  const [createOpen, setCreateOpen] = useState(false);
  const collapsedSections = useUiPrefs((s) => s.collapsedSidebarSections);
  const toggleSidebarSection = useUiPrefs((s) => s.toggleSidebarSection);
  const sectionOpen = !isSidebarSectionCollapsed(collapsedSections, 'tasks');

  if (!projectId) return null;

  const allLabels = extractAllLabels(todos);

  return (
    <div data-testid="tasks-sidebar-section" className="flex flex-col shrink-0">
      <div
        style={{ paddingLeft: sidebarIndentPx(0), paddingRight: sidebarIndentPx(0) }}
        className="flex items-center gap-[4px] pb-1 pt-[8px]"
      >
        <button
          type="button"
          data-testid="tasks-sidebar-section-toggle"
          aria-expanded={sectionOpen}
          onClick={() => toggleSidebarSection('tasks')}
          className="flex items-center gap-[4px]"
        >
          <SidebarSectionChevron open={sectionOpen} />
          <span className="text-caption font-medium text-muted-foreground">Tasks</span>
        </button>
        <div className="flex-1" />
        <Hint label="Open full Tasks view">
          <button
            data-testid="tasks-sidebar-expand"
            type="button"
            onClick={openModal}
            className={ICON_BTN}
            aria-label="Open full Tasks view"
          >
            <ExternalLink className="size-3.5" />
          </button>
        </Hint>
      </div>

      {sectionOpen && (
        <>
          <div className="pr-2" style={{ paddingLeft: SIDEBAR_INDENT_STEP_PX }}>
            <button
              data-testid="tasks-sidebar-new"
              type="button"
              onClick={() => setCreateOpen(true)}
              className={ROW_BTN}
            >
              <Plus className="size-[13px] flex-shrink-0" />
              <span>New task</span>
            </button>
          </div>

          <TasksSidebarList port={port} projectId={projectId} onStartSession={(t) => void startTodoSession(t.id)} />
        </>
      )}

      {/* Create modal */}
      {createOpen && (
        <TaskEditModal
          port={port}
          projectId={projectId}
          todo={null}
          allTodos={todos}
          allLabels={allLabels}
          onClose={() => setCreateOpen(false)}
        />
      )}
    </div>
  );
}
