import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { Plus } from 'lucide-react';
import { Tooltip, TooltipTrigger, TooltipContent } from '../ui/tooltip';
import { useTerminalStore } from '../../store/terminal';
import { useProjectsStore } from '../../store';
import { useActiveProjectId } from '../../hooks/useActiveProjectId.js';
import { useChatsStore } from '../../store/chats';
import { TerminalInstance } from './TerminalInstance';
import { useZoneHeaderTabs, useZoneHeaderActions } from '../zone/ZoneHeaderSlot.js';
import type { InternalTab } from '../zone/ZoneHeaderSlot.js';

export function TerminalPanel(): React.ReactElement {
  const terminals = useTerminalStore((s) => s.terminals);
  const activeTerminalId = useTerminalStore((s) => s.activeTerminalId);
  const addTerminal = useTerminalStore((s) => s.addTerminal);
  const removeTerminal = useTerminalStore((s) => s.removeTerminal);
  const setActiveTerminal = useTerminalStore((s) => s.setActiveTerminal);
  const activeProjectId = useActiveProjectId();
  const shellNameRef = useRef('zsh');
  const counterRef = useRef(0);

  const getCwd = useCallback((): string => {
    if (!activeProjectId) return '/';
    const chat = useChatsStore.getState().chats.find((c) => c.id === useChatsStore.getState().activeChatId);
    const project = useProjectsStore.getState().projects.find((p) => p.id === activeProjectId);
    if (!project) return '/';
    return chat?.worktreePath ?? project.path;
  }, [activeProjectId]);

  const containerRef = useRef<HTMLDivElement>(null);

  const createTerminal = useCallback(async () => {
    const cwd = getCwd();
    try {
      // Estimate initial cols/rows from container so the PTY starts at the
      // correct size — avoids prompt misalignment on first render.
      const rect = containerRef.current?.getBoundingClientRect();
      const initCols = rect ? Math.max(2, Math.floor(rect.width / 7.8)) : undefined;
      const initRows = rect ? Math.max(1, Math.floor(rect.height / 17)) : undefined;
      const { id } = await window.mainframe.terminal.create({ cwd, cols: initCols, rows: initRows });
      counterRef.current += 1;
      const name = counterRef.current === 1 ? shellNameRef.current : `${shellNameRef.current} (${counterRef.current})`;
      addTerminal({ id, name });
    } catch (err) {
      console.warn('[terminal] failed to create terminal', err);
    }
  }, [getCwd, addTerminal]);

  const closeTerminal = useCallback(
    (id: string) => {
      window.mainframe.terminal.kill(id).catch((err) => {
        console.warn('[terminal] failed to kill terminal', id, err);
      });
      removeTerminal(id);
    },
    [removeTerminal],
  );

  // Auto-create first terminal on mount if none exist
  const didAutoCreate = useRef(false);
  useEffect(() => {
    if (terminals.length === 0 && !didAutoCreate.current) {
      didAutoCreate.current = true;
      void createTerminal();
    }
  }, [terminals.length, createTerminal]);

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

  const handleTabChange = useCallback((tabId: string) => setActiveTerminal(tabId), [setActiveTerminal]);

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
