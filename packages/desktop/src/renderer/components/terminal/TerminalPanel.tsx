import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { Tooltip, TooltipTrigger, TooltipContent } from '../ui/tooltip';
import { useTerminalStore, type TerminalTab } from '../../store/terminal';
import { useProjectsStore } from '../../store';
import { useActiveProjectId } from '../../hooks/useActiveProjectId.js';
import { useChatsStore } from '../../store/chats';
import { TerminalInstance, disposeCachedTerminal } from './TerminalInstance';
import { useZoneHeaderTabs, useZoneHeaderActions } from '../zone/ZoneHeaderSlot.js';
import type { InternalTab } from '../zone/ZoneHeaderSlot.js';
import { resolveCwd } from './terminal-cwd.js';

// Stable reference for the no-scope case — see store/terminal.ts.
const EMPTY_TERMINALS: TerminalTab[] = [];

export function TerminalPanel(): React.ReactElement {
  const activeProjectId = useActiveProjectId();
  const activeChatId = useChatsStore((s) => s.activeChatId);

  // Terminals follow the active chat (so each session's terminals stay tied
  // to its worktree). When no chat is selected, fall back to the project so
  // we still have a valid scope.
  const scopeId = activeChatId ?? activeProjectId ?? null;

  const terminals = useTerminalStore((s) => (scopeId ? s.getTerminals(scopeId) : EMPTY_TERMINALS));
  const activeTerminalId = useTerminalStore((s) => (scopeId ? s.getActiveTerminalId(scopeId) : null));
  const addTerminal = useTerminalStore((s) => s.addTerminal);
  const removeTerminal = useTerminalStore((s) => s.removeTerminal);
  const setActiveTerminal = useTerminalStore((s) => s.setActiveTerminal);

  const shellNameRef = useRef('zsh');
  // Per-scope tab counter so numbering restarts at 1 in each session/project
  // and survives across scope switches.
  const counterByScopeRef = useRef<Map<string, number>>(new Map());

  // Resolved homedir — fetched once via IPC on mount.
  const [homedir, setHomedir] = useState<string | null>(null);

  useEffect(() => {
    window.mainframe
      .getHomedir()
      .then(setHomedir)
      .catch((err: unknown) => {
        console.warn('[terminal] failed to get homedir, will retry on next terminal creation', err);
      });
  }, []);

  const getCwd = useCallback((): string | null => {
    // Defer until homedir is known — avoids spawning with cwd="/"
    if (!homedir) return null;
    if (!activeProjectId) {
      console.warn('[terminal] getCwd: no activeProjectId, deferring to homedir');
      return homedir;
    }
    const chatsState = useChatsStore.getState();
    const chat = chatsState.chats.find((c) => c.id === chatsState.activeChatId);
    const project = useProjectsStore.getState().projects.find((p) => p.id === activeProjectId);
    const cwd = resolveCwd({
      worktreePath: chat?.worktreePath,
      projectPath: project?.path,
      homedir,
    });
    if (cwd === homedir) {
      console.warn('[terminal] getCwd: resolved to homedir (no project/worktree path available)', {
        activeProjectId,
        projectFound: !!project,
        worktreePath: chat?.worktreePath,
      });
    }
    return cwd;
  }, [activeProjectId, homedir]);

  const containerRef = useRef<HTMLDivElement>(null);

  const createTerminal = useCallback(async () => {
    const cwd = getCwd();
    if (!cwd) {
      // homedir not yet loaded — silently bail; user can retry by clicking +
      return;
    }
    if (!scopeId) {
      console.warn('[terminal] createTerminal called without a scope — using homedir');
    }
    try {
      const rect = containerRef.current?.getBoundingClientRect();
      const initCols = rect ? Math.max(2, Math.floor(rect.width / 7.8)) : undefined;
      const initRows = rect ? Math.max(1, Math.floor(rect.height / 17)) : undefined;
      const { id } = await window.mainframe.terminal.create({ cwd, cols: initCols, rows: initRows });
      const scope = scopeId ?? '__no_scope__';
      const next = (counterByScopeRef.current.get(scope) ?? 0) + 1;
      counterByScopeRef.current.set(scope, next);
      const name = next === 1 ? shellNameRef.current : `${shellNameRef.current} (${next})`;
      addTerminal(scope, { id, name });
    } catch (err) {
      console.warn('[terminal] failed to create terminal', err);
    }
  }, [getCwd, addTerminal, scopeId]);

  const closeTerminal = useCallback(
    (id: string) => {
      window.mainframe.terminal.kill(id).catch((err) => {
        console.warn('[terminal] failed to kill terminal', id, err);
      });
      // Tear down the cached xterm instance — output is no longer needed.
      disposeCachedTerminal(id);
      if (scopeId) {
        removeTerminal(scopeId, id);
      }
    },
    [removeTerminal, scopeId],
  );

  // Handle terminal exit events
  useEffect(() => {
    const handleExit = (id: string, _exitCode: number): void => {
      console.warn('[terminal] process exited', { id, _exitCode });
    };
    const removeExitListener = window.mainframe.terminal.onExit(handleExit);
    return removeExitListener;
  }, []);

  // Detect shell name from platform
  useEffect(() => {
    if (window.mainframe.platform === 'win32') {
      shellNameRef.current = 'powershell';
    } else {
      shellNameRef.current = 'zsh';
    }
  }, []);

  // Register internal tabs with ZoneHeader
  const internalTabs: InternalTab[] = useMemo(
    () =>
      terminals.map((t) => ({
        id: t.id,
        label: t.name,
        onClose: () => closeTerminal(t.id),
      })),
    [terminals, closeTerminal],
  );

  const handleTabChange = useCallback(
    (tabId: string) => {
      if (scopeId) setActiveTerminal(scopeId, tabId);
    },
    [setActiveTerminal, scopeId],
  );

  useZoneHeaderTabs(internalTabs, activeTerminalId, handleTabChange);

  const headerActions = useMemo(
    () => (
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={() => void createTerminal()}
            className="p-1 rounded hover:bg-mf-hover text-mf-text-secondary hover:text-mf-text-primary transition-colors"
          >
            <Plus size={12} />
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">New terminal</TooltipContent>
      </Tooltip>
    ),
    [createTerminal],
  );

  useZoneHeaderActions(headerActions);

  return (
    <div className="h-full flex flex-col" data-testid="terminal-panel">
      {/* Terminal instances — all mounted, only active one visible. */}
      <div ref={containerRef} className="flex-1 min-h-0 relative">
        {terminals.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-mf-text-secondary select-none">
            Click the + icon to start a new terminal session
          </div>
        ) : (
          terminals.map((t) => <TerminalInstance key={t.id} terminalId={t.id} visible={t.id === activeTerminalId} />)
        )}
      </div>
    </div>
  );
}
