/**
 * A new session's empty state (K11), just above the composer: the project,
 * where the session will run, recent sessions to continue and open tasks to
 * start from. It follows the pickers in the strip below it (K3, K7).
 */
import type { ReactNode } from 'react';
import { getActiveDaemon } from '@/lib/daemon/active-daemon';
import { CornerDownLeft, ListChecks, Loader2, MessageSquare } from 'lucide-react';
import { useAui } from '@assistant-ui/react';
import { useNow } from '@/lib/use-now';
import type { Todo } from '@/lib/api/todos';
import { focusVisibleComposer } from '@/features/chat/composer/focus-composer';
import { readLiveComposerState } from '@/features/chat/composer/read-live-composer-state';
import { draftEnvironment } from '@/features/chat/composer/strips/draft-environment';
import { useProjectBranch } from '@/features/chat/composer/strips/project-branches';
import { useSideAwareThreadId } from '@/features/side-chat/side-chat-scope';
import { formatCompactTime } from '../compact-time';
import { useDaemonPort } from '../runtime/daemon-port-context';
import { useDraftConfig, type DraftCfg } from '../runtime/draft-config';
import { useProjects } from '../use-projects';
import type { SessionItem } from '../view-model/chat-to-thread-custom';
import { sessionStatus } from '../view-model/session-status';
import { useProjectTasks } from './use-project-tasks';
import { useRecentSessions } from './use-recent-sessions';

const Code = ({ children }: { children: string }) => (
  <code className="font-mono text-xs/4.5 text-foreground/80 wrap-anywhere">{children}</code>
);

function detachedFolder(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

/** Where the session will run, as the branch picker has it. */
function Where({ draft, branch }: { draft: DraftCfg; branch: string | null | undefined }) {
  const env = draftEnvironment(draft);
  switch (env.kind) {
    case 'temporary':
      return 'Temporary session, deleted when closed';
    case 'new-worktree':
      return (
        <>
          New worktree from <Code>{env.base}</Code>
        </>
      );
    case 'worktree':
      return (
        <>
          Worktree <Code>{env.branch === 'detached' ? detachedFolder(env.path) : env.branch}</Code>
        </>
      );
    case 'local':
      return branch ? (
        <>
          Local checkout on <Code>{branch}</Code>
        </>
      ) : (
        'Local checkout'
      );
  }
}

function Head({ project, children }: { project?: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span
        aria-hidden
        data-testid="sessions-welcome-tile"
        className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-foreground/7 text-[15px] leading-[22px] font-semibold text-foreground/80 ring-1 ring-border ring-inset"
      >
        {project?.trim().charAt(0).toUpperCase() || '–'}
      </span>
      <div className="min-w-0">
        <h1 className="text-[19px]/6.5 font-semibold tracking-[-0.01em] wrap-anywhere text-foreground">
          {project ? `What’s next for ${project}?` : 'What’s next?'}
        </h1>
        <p data-testid="sessions-welcome-where" className="text-[13px]/4.5 text-muted-foreground">
          {children}
        </p>
      </div>
    </div>
  );
}

function Group({ label, testId, children }: { label: string; testId: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} data-testid={testId} className="flex flex-col">
      <div aria-hidden className="px-2 pb-1.5 text-xs font-medium text-muted-foreground">
        {label}
      </div>
      {children}
    </div>
  );
}

const ROW =
  'group/row flex h-8 min-w-0 items-center gap-2.5 rounded-lg px-2 text-left text-[13.5px] leading-[22px] text-foreground/80 hover:bg-accent hover:text-foreground focus-visible:focus-line-inset';
const ROW_ICON = 'size-4 shrink-0 text-muted-foreground';

/** A list that has nothing to show yet, or could not be read. Empty, it isn't there at all. */
function ListNote({
  state,
  what,
  testId,
  retry,
}: {
  state: 'loading' | 'failed';
  what: string;
  testId: string;
  retry: () => void;
}) {
  return (
    <div role="status" className="flex h-8 items-center gap-2 px-2 text-sm text-muted-foreground">
      {state === 'loading' ? (
        <>
          <Loader2 aria-hidden className="size-3.5 animate-spin motion-reduce:animate-none" />
          Loading {what}…
        </>
      ) : (
        <>
          Couldn’t load {what}.
          <button
            type="button"
            data-testid={testId}
            onClick={retry}
            className="h-6 rounded-md px-1.5 font-medium text-accent-ink hover:bg-accent focus-visible:focus-line"
          >
            Try again
          </button>
        </>
      )}
    </div>
  );
}

function SessionValue({ item }: { item: SessionItem }) {
  const now = useNow();
  switch (sessionStatus(item.custom)) {
    case 'running':
      return (
        <>
          <Loader2 aria-hidden className="size-3.5 animate-spin text-primary motion-reduce:animate-none" />
          <span className="sr-only">running</span>
        </>
      );
    case 'needs-you':
      return <span className="font-medium text-warning">needs you</span>;
    case 'idle':
      return <span className="text-muted-foreground">{formatCompactTime(item.custom.updatedAt, now)}</span>;
  }
}

function Continue({ projectId, project }: { projectId: string; project?: string }) {
  const aui = useAui();
  const { sessions, state } = useRecentSessions(projectId);
  if (sessions.length === 0 && state === 'ready') return null;
  return (
    <Group label={project ? `Continue in ${project}` : 'Continue'} testId="sessions-welcome-recent">
      {state !== 'ready' && (
        <ListNote
          state={state}
          what="recent sessions"
          testId="sessions-welcome-recent-retry"
          retry={() => void aui.threads.reload()}
        />
      )}
      {sessions.map((item) => (
        <button
          key={item.id}
          type="button"
          data-testid={`sessions-welcome-session-${item.id}`}
          className={ROW}
          onClick={() => void aui.threads.switchToThread(item.id)}
        >
          <MessageSquare aria-hidden className={ROW_ICON} />
          <span className="min-w-0 flex-1 truncate">{item.title ?? 'Untitled session'}</span>
          <span className="flex shrink-0 items-center text-xs/[22px] tabular-nums">
            <SessionValue item={item} />
          </span>
        </button>
      ))}
    </Group>
  );
}

/** What was typed stays; the task goes under it, once. */
export function withTask(text: string, todo: Pick<Todo, 'number' | 'title'>): string {
  const line = `Work on task #${todo.number}: ${todo.title}`;
  if (text.split('\n').includes(line)) return text;
  return text.trim() === '' ? line : `${text.trimEnd()}\n\n${line}`;
}

function StartFromTask({ projectId }: { projectId: string }) {
  const aui = useAui();
  const { tasks, state, reload } = useProjectTasks(useDaemonPort(), projectId);
  if (tasks.length === 0 && state === 'ready') return null;

  const daemonId = getActiveDaemon().id;
  const start = (todo: Todo) => {
    if (getActiveDaemon().id !== daemonId) return;
    const text = readLiveComposerState(aui.composer).text;
    const next = withTask(text, todo);
    if (next !== text) aui.composer.setText(next);
    focusVisibleComposer();
  };
  return (
    <Group label="Start from a project task" testId="sessions-welcome-tasks">
      {state !== 'ready' && (
        <ListNote state={state} what="project tasks" testId="sessions-welcome-tasks-retry" retry={reload} />
      )}
      {tasks.map((todo) => (
        <button
          key={todo.id}
          type="button"
          data-testid={`sessions-welcome-task-${todo.number}`}
          className={ROW}
          onClick={() => start(todo)}
        >
          <ListChecks aria-hidden className={ROW_ICON} />
          <span className="min-w-0 flex-1 truncate">{todo.title}</span>
          <span className="shrink-0 text-xs/[22px] text-muted-foreground tabular-nums">#{todo.number}</span>
          <CornerDownLeft
            aria-hidden
            className="size-3.5 shrink-0 text-muted-foreground opacity-0 group-hover/row:opacity-100 group-focus-visible/row:opacity-100"
          />
        </button>
      ))}
    </Group>
  );
}

function ProjectState({ projectId, draft }: { projectId: string; draft: DraftCfg }) {
  const { projects } = useProjects();
  const project = projects.find((p) => p.id === projectId)?.name;
  const { branch } = useProjectBranch(useDaemonPort(), projectId);
  return (
    <>
      <Head project={project}>
        <Where draft={draft} branch={branch} />
      </Head>
      <Continue projectId={projectId} project={project} />
      <StartFromTask projectId={projectId} />
    </>
  );
}

function NoProjectState({ draft }: { draft: DraftCfg | undefined }) {
  return (
    <>
      <Head>
        {draft == null
          ? 'Choose a project to get started.'
          : draft.temporary
            ? 'No project: a temporary session without a repository, deleted when closed'
            : 'No project: the agent works without a repository'}
      </Head>
      <p className="px-2 text-sm text-muted-foreground">
        Pick a project below to see its recent sessions and open tasks.
      </p>
    </>
  );
}

export function NewSessionState() {
  const draft = useDraftConfig(useSideAwareThreadId());
  return (
    <div data-testid="sessions-welcome" className="flex min-h-full flex-col justify-end">
      <div className="flex flex-col gap-[22px] px-1 pb-3">
        {draft?.projectId != null ? (
          <ProjectState projectId={draft.projectId} draft={draft} />
        ) : (
          <NoProjectState draft={draft} />
        )}
      </div>
    </div>
  );
}
