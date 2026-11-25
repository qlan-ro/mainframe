'use client';

/**
 * The branch picker of a new session (K7): search, the branches with a check
 * on the current one, then "Work in a new worktree" and "Temporary session",
 * then the project's worktrees.
 *
 * Picking a branch with a new worktree on sets what it starts from. Without
 * one it checks the branch out, as today's branch menu does, asking first when
 * the checkout has uncommitted changes.
 */
import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, Folder, FolderGit2, FolderPlus, Loader2, Settings2, Timer } from 'lucide-react';
import type { BranchListResult } from '@qlan-ro/mainframe-types';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import { BranchIcon } from '@/components/ui/glyphs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { MENU_DETAIL, MENU_ITEM, MENU_LABEL, MENU_SEPARATOR } from '@/components/ui/menu-item';
import { MenuSearch } from '@/components/ui/menu-search';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { getGitBranches, getProjectWorktrees, type WorktreeEntry } from '@/lib/api/git';
import { useProjectsStore } from '@/store/projects';
import { BranchPopover } from '@/features/git/BranchPopover';
import { useBranchActions } from '@/features/git/use-branch-actions';
import { useDaemonPort } from '@/features/sessions/runtime/daemon-port-context';
import { patchDraftConfig, type DraftCfg } from '@/features/sessions/runtime/draft-config';
import { moveDraft } from '@/features/sessions/new-thread/move-draft';
import { validateBranchName } from '../config-toolbar/WorktreeNewForm';
import { ComposerHint } from '../composer-card-context';
import { draftEnvironment, environmentPatch, suggestBranchName, type DraftEnvironment } from './draft-environment';
import { getActiveDaemon } from '@/lib/daemon/active-daemon';
import { setProjectBranch, useProjectBranch } from './project-branches';

interface BranchData {
  branches: BranchListResult | null;
  worktrees: readonly WorktreeEntry[];
  error: string | null;
}

const NO_BRANCH_DATA: BranchData = { branches: null, worktrees: [], error: null };

/** Branches and worktrees, fetched each time the picker opens. */
function useBranchData(port: number, projectId: string, open: boolean): BranchData {
  const daemonId = getActiveDaemon().id;
  const key = JSON.stringify([daemonId, port, projectId]);
  const [value, setValue] = useState<{ key: string; data: BranchData }>();
  useEffect(() => {
    if (!open) return;
    let stale = false;
    Promise.all([getGitBranches(port, projectId), getProjectWorktrees(port, projectId)]).then(
      ([branches, worktrees]) => {
        if (stale || getActiveDaemon().id !== daemonId) return;
        setValue({ key, data: { branches, worktrees, error: null } });
        // The menu's answer is the newer one: the strip and the empty state say the same.
        setProjectBranch(projectId, branches.current || null);
      },
      (error: unknown) => {
        if (stale || getActiveDaemon().id !== daemonId) return;
        const message = error instanceof Error ? error.message : 'Could not load branches';
        setValue({ key, data: { ...NO_BRANCH_DATA, error: message } });
      },
    );
    return () => {
      stale = true;
    };
  }, [open, port, projectId, daemonId, key]);
  return value?.key === key ? value.data : NO_BRANCH_DATA;
}

function TriggerLabel({ env, branch }: { env: DraftEnvironment; branch: string | null | undefined }) {
  switch (env.kind) {
    case 'temporary':
      return 'Temporary';
    case 'new-worktree':
      return (
        <>
          New worktree <span className="text-muted-foreground">from</span>{' '}
          <span className="font-medium text-foreground">{env.base}</span>
        </>
      );
    case 'worktree':
      return (
        <>
          {env.branch} <span className="text-muted-foreground">worktree</span>
        </>
      );
    case 'local':
      return branch ?? 'Branch';
  }
}

/** A detached worktree has no branch: its folder is the only name it has. */
function worktreeNames({ branch, path }: WorktreeEntry): { name: string; label: string } {
  if (branch) {
    const name = branch.replace('refs/heads/', '');
    return { name, label: name };
  }
  const folder = path.split(/[\\/]/).filter(Boolean).pop() ?? path;
  return { name: 'detached', label: `${folder} (detached)` };
}

const ENV_ICON = { local: BranchIcon, temporary: Timer, 'new-worktree': FolderPlus, worktree: FolderGit2 } as const;

const GROUP =
  'p-0 **:[[cmdk-group-heading]]:px-2.5 **:[[cmdk-group-heading]]:pt-2 **:[[cmdk-group-heading]]:pb-[3px] **:[[cmdk-group-heading]]:text-caption/[1.45] **:[[cmdk-group-heading]]:font-semibold';

/** A command row that looks like a menu's. The check the row carries sits on its first line. */
const ITEM = cn(
  MENU_ITEM,
  'data-selected:bg-sidebar-accent data-selected:**:[svg]:text-muted-foreground [&>svg:last-child]:text-ink-secondary data-selected:[&>svg:last-child]:text-ink-secondary',
);

function TwoLine({ title, detail }: { title: string; detail: string }) {
  return (
    <span className="flex min-w-0 flex-1 flex-col">
      <span className="truncate">{title}</span>
      <span className={cn(MENU_DETAIL, 'truncate')}>{detail}</span>
    </span>
  );
}

function NewBranchName({ name, onChange }: { name: string; onChange: (name: string) => void }) {
  const [text, setText] = useState(name);
  const invalid = validateBranchName(text);
  return (
    <div className="flex flex-col gap-1 border-t border-border px-2 py-2" onKeyDown={(e) => e.stopPropagation()}>
      <Label htmlFor="composer-new-branch-name" className="text-xs text-muted-foreground">
        New branch
      </Label>
      <Input
        id="composer-new-branch-name"
        data-testid="composer-worktree-branch-name"
        value={text}
        aria-invalid={invalid != null}
        onChange={(e) => {
          setText(e.target.value);
          if (validateBranchName(e.target.value) == null) onChange(e.target.value);
        }}
        className="h-7 text-sm"
      />
      {invalid && <span className="text-xs text-fail">{invalid}</span>}
    </div>
  );
}

export function DraftBranchPicker({
  localId,
  projectId,
  draft,
}: {
  localId: string;
  projectId: string;
  draft: DraftCfg;
}) {
  const port = useDaemonPort();
  const projectName = useProjectsStore((state) => state.projects.find((project) => project.id === projectId)?.name);
  const [open, setOpen] = useState(false);
  const [managing, setManaging] = useState(false);
  const data = useBranchData(port, projectId, open);
  const { branch: current, reload } = useProjectBranch(port, projectId);
  const { handleCheckout } = useBranchActions({ port, projectId });
  const env = draftEnvironment(draft);
  const Icon = ENV_ICON[env.kind];

  const set = (next: DraftEnvironment) => {
    const patch = environmentPatch(next);
    moveDraft(localId, draft, { ...draft, ...patch }, () => patchDraftConfig(localId, patch));
  };
  const local = useMemo(() => data.branches?.local.map((b) => b.name) ?? [], [data.branches]);
  // The project's own checkout is the "local" choice, not a worktree to attach.
  const worktrees = useMemo(() => data.worktrees.slice(1), [data.worktrees]);
  const checked = env.kind === 'new-worktree' ? env.base : env.kind === 'local' ? current : null;

  const pickBranch = (name: string) => {
    if (env.kind === 'new-worktree') set({ ...env, base: name });
    else {
      if (env.kind === 'worktree') set({ kind: 'local' });
      if (name !== current) void handleCheckout(name).then(reload);
    }
    setOpen(false);
  };
  const openManager = () => {
    setOpen(false);
    setManaging(true);
  };
  const toggleNewWorktree = () => {
    if (env.kind === 'new-worktree') set({ kind: 'local' });
    else set({ kind: 'new-worktree', base: current ?? 'main', branchName: suggestBranchName(local) });
  };
  const toggleTemporary = () => {
    set({ kind: env.kind === 'temporary' ? 'local' : 'temporary' });
    setOpen(false);
  };

  return (
    <>
      {/* Today's branch manager, for the project's own checkout. It opens from the
        picker's menu and hangs off the same spot. */}
      <BranchPopover
        port={port}
        projectId={projectId}
        open={managing}
        onOpenChange={setManaging}
        onBranchChanged={reload}
      >
        <button type="button" tabIndex={-1} aria-hidden className="pointer-events-none -mr-1 h-7 w-0" />
      </BranchPopover>
      <Popover open={open} onOpenChange={setOpen}>
        <ComposerHint label="Branch and worktree">
          <PopoverTrigger asChild>
            <button
              type="button"
              data-testid="composer-branch-picker"
              data-env={env.kind}
              aria-label="Branch and where it runs"
              className={cn(
                'inline-flex h-7 min-w-0 items-center gap-1.5 rounded-md px-2 text-body text-ink-secondary hover:bg-sidebar-accent focus-visible:focus-line',
                open && 'bg-sidebar-accent',
              )}
            >
              <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0 truncate">
                <TriggerLabel env={env} branch={current} />
              </span>
              <ChevronDown className="size-3 shrink-0 text-muted-foreground" aria-hidden />
            </button>
          </PopoverTrigger>
        </ComposerHint>
        <PopoverContent
          data-testid="composer-branch-menu"
          align="start"
          side="top"
          sideOffset={6}
          className="w-75 gap-0 p-1"
        >
          <Command className="rounded-none bg-transparent p-0">
            <MenuSearch data-testid="composer-branch-search" placeholder="Search branches..." autoFocus />
            <div className={cn(MENU_LABEL, 'flex items-center gap-[7px]')}>
              <Folder className="size-3.5 shrink-0" aria-hidden />
              <span className="truncate" title={projectName}>
                {projectName ?? 'Project'}
              </span>
            </div>
            <CommandList className="max-h-[calc(100vh-8rem)]">
              {data.branches == null && !data.error && (
                <div className="flex justify-center py-4">
                  <Loader2 className="size-3.5 animate-spin text-muted-foreground motion-reduce:animate-none" />
                </div>
              )}
              {data.error && <p className="px-2 py-2 text-xs text-fail">{data.error}</p>}
              {data.branches && <CommandEmpty>No branch matches.</CommandEmpty>}
              <CommandGroup className={GROUP}>
                {local.map((name) => (
                  <CommandItem
                    key={name}
                    className={ITEM}
                    value={`branch:${name}`}
                    data-testid={`composer-branch-option-${name}`}
                    data-checked={name === checked}
                    onSelect={() => pickBranch(name)}
                  >
                    <BranchIcon className="text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">{name}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
              <CommandSeparator className={MENU_SEPARATOR} />
              <CommandGroup className={GROUP}>
                <CommandItem
                  className={ITEM}
                  value="Work in a new worktree"
                  data-testid="composer-branch-new-worktree"
                  data-checked={env.kind === 'new-worktree'}
                  onSelect={toggleNewWorktree}
                >
                  <FolderPlus className="text-muted-foreground" />
                  <TwoLine title="Work in a new worktree" detail="Keeps your checkout untouched" />
                </CommandItem>
                <CommandItem
                  className={ITEM}
                  value="Temporary session"
                  data-testid="composer-temporary-toggle"
                  data-checked={env.kind === 'temporary'}
                  onSelect={toggleTemporary}
                >
                  <Timer className="text-muted-foreground" />
                  <TwoLine title="Temporary session" detail="Deleted when closed; no worktree" />
                </CommandItem>
              </CommandGroup>
              {worktrees.length > 0 && <CommandSeparator className={MENU_SEPARATOR} />}
              {worktrees.length > 0 && (
                <CommandGroup heading="Previous worktrees" className={GROUP}>
                  {worktrees.map((worktree) => {
                    const { name, label } = worktreeNames(worktree);
                    return (
                      <CommandItem
                        key={worktree.path}
                        className={ITEM}
                        value={`worktree:${name}:${worktree.path}`}
                        data-testid={`composer-branch-worktree-${label}`}
                        data-checked={env.kind === 'worktree' && env.path === worktree.path}
                        onSelect={() => {
                          set({ kind: 'worktree', branch: name, path: worktree.path });
                          setOpen(false);
                        }}
                      >
                        <FolderGit2 className="text-muted-foreground" />
                        <span
                          className="min-w-0 flex-1 truncate font-mono text-small/[20px] font-normal"
                          title={worktree.path}
                        >
                          {label}
                        </span>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              )}
              <CommandSeparator className={MENU_SEPARATOR} />
              <CommandGroup className={GROUP}>
                <CommandItem
                  className={ITEM}
                  value="Manage branches"
                  data-testid="composer-branch-manage"
                  onSelect={openManager}
                >
                  <Settings2 className="text-muted-foreground" />
                  <TwoLine title="Manage branches…" detail="Fetch, push, create, rename and more" />
                </CommandItem>
              </CommandGroup>
            </CommandList>
          </Command>
          {env.kind === 'new-worktree' && (
            <NewBranchName name={env.branchName} onChange={(branchName) => set({ ...env, branchName })} />
          )}
        </PopoverContent>
      </Popover>
    </>
  );
}
