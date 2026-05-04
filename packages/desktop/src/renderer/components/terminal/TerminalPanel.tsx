import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { Tooltip, TooltipTrigger, TooltipContent } from '../ui/tooltip';
import { useTerminalStore } from '../../store/terminal';
import { useProjectsStore } from '../../store';
import { useActiveProjectId } from '../../hooks/useActiveProjectId.js';
import { useChatsStore } from '../../store/chats';
import { TerminalInstance } from './TerminalInstance';
import { useZoneHeaderTabs, useZoneHeaderActions } from '../zone/ZoneHeaderSlot.js';
import type { InternalTab } from '../zone/ZoneHeaderSlot.js';
import { resolveCwd } from './terminal-cwd.js';

export function TerminalPanel(): React.ReactElement {
  const activeProjectId = useActiveProjectId();

  const terminals = useTerminalStore((s) => (activeProjectId ? s.getTerminals(activeProjectId) : []));
  const activeTerminalId = useTerminalStore((s) => (activeProjectId ? s.getActiveTerminalId(activeProjectId) : null));
  const addTerminal = useTerminalStore((s) => s.addTerminal);
  const removeTerminal = useTerminalStore((s) => s.removeTerminal);
  const setActiveTerminal = useTerminalStore((s) => s.setActiveTerminal);

  const shellNameRef = useRef('zsh');
  const counterRef = useRef(0);

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
    const chat = useChatsStore.getState().chats.find((c) => c.id === useChatsStore.getState().activeChatId);
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
      // homedir not yet loaded — silently bail; auto-create will retry
      return;
    }
    if (!activeProjectId) {
      console.warn('[terminal] createTerminal called without activeProjectId — using homedir');
    }
    try {
      const rect = containerRef.current?.getBoundingClientRect();
      const initCols = rect ? Math.max(2, Math.floor(rect.width / 7.8)) : undefined;
      const initRows = rect ? Math.max(1, Math.floor(rect.height / 17)) : undefined;
      const { id } = await window.mainframe.terminal.create({ cwd, cols: initCols, rows: initRows });
      counterRef.current += 1;
      const name = counterRef.current === 1 ? shellNameRef.current : `${shellNameRef.current} (${counterRef.current})`;
      const projectId = activeProjectId ?? '__no_project__';
      addTerminal(projectId, { id, name });
    } catch (err) {
      console.warn('[terminal] failed to create terminal', err);
    }
  }, [getCwd, addTerminal, activeProjectId]);

  const closeTerminal = useCallback(
    (id: string) => {
      window.mainframe.terminal.kill(id).catch((err) => {
        console.warn('[terminal] failed to kill terminal', id, err);
      });
      if (activeProjectId) {
        removeTerminal(activeProjectId, id);
      }
    },
    [removeTerminal, activeProjectId],
  );

  // Auto-create first terminal when both homedir is ready and we have a project
  const didAutoCreate = useRef(false);
  useEffect(() => {
    if (terminals.length === 0 && !didAutoCreate.current && homedir !== null) {
      didAutoCreate.current = true;
      void createTerminal();
    }
  }, [terminals.length, createTerminal, homedir]);

  // Reset auto-create flag when project changes so the first terminal for a
  // new project is created automatically.
  useEffect(() => {
    didAutoCreate.current = false;
  }, [activeProjectId]);

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
      if (activeProjectId) setActiveTerminal(activeProjectId, tabId);
    },
    [setActiveTerminal, activeProjectId],
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
      {/* Terminal instances — all mounted, only active one visible */}
      <div ref={containerRef} className="flex-1 min-h-0 relative">
        {terminals.map((t) => (
          <TerminalInstance key={t.id} terminalId={t.id} visible={t.id === activeTerminalId} />
        ))}
      </div>
    </div>
  );
}
