import React, { useCallback, useEffect, useRef } from 'react';
import { Plus, X, Minus } from 'lucide-react';
import { Tooltip, TooltipTrigger, TooltipContent } from '../ui/tooltip';
import { useTerminalStore } from '../../store/terminal';
import { useProjectsStore, useUIStore } from '../../store';
import { useActiveProjectId } from '../../hooks/useActiveProjectId.js';
import { useChatsStore } from '../../store/chats';
import { TerminalInstance } from './TerminalInstance';

export function TerminalPanel(): React.ReactElement {
  const terminals = useTerminalStore((s) => s.terminals);
  const activeTerminalId = useTerminalStore((s) => s.activeTerminalId);
  const addTerminal = useTerminalStore((s) => s.addTerminal);
  const removeTerminal = useTerminalStore((s) => s.removeTerminal);
  const setActiveTerminal = useTerminalStore((s) => s.setActiveTerminal);
  const setPanelVisible = useUIStore((s) => s.setPanelVisible);

  const activeProjectId = useActiveProjectId();
  const shellNameRef = useRef('zsh');
  const counterRef = useRef(0);

  const getCwd = useCallback((): string => {
    if (!activeProjectId) return process.env.HOME ?? '/';
    const chat = useChatsStore.getState().chats.find((c) => c.id === useChatsStore.getState().activeChatId);
    const project = useProjectsStore.getState().projects.find((p) => p.id === activeProjectId);
    if (!project) return process.env.HOME ?? '/';
    return chat?.worktreePath ?? project.path;
  }, [activeProjectId]);

  const createTerminal = useCallback(async () => {
    const cwd = getCwd();
    try {
      const { id } = await window.mainframe.terminal.create({ cwd });
      counterRef.current += 1;
      const name = counterRef.current === 1 ? shellNameRef.current : `${shellNameRef.current} (${counterRef.current})`;
      addTerminal({ id, name });
    } catch (err) {
      console.warn('[terminal] failed to create terminal', err);
    }
  }, [getCwd, addTerminal]);

  const closeTerminal = useCallback(
    (id: string) => {
      window.mainframe.terminal.kill(id).catch(() => {});
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
    window.mainframe.terminal.onExit(handleExit);
    return () => {
      window.mainframe.terminal.removeExitListener();
    };
  }, []);

  // Cleanup all IPC listeners on unmount
  useEffect(() => {
    return () => {
      window.mainframe.terminal.removeDataListener();
      window.mainframe.terminal.removeExitListener();
    };
  }, []);

  // Detect shell name from platform
  useEffect(() => {
    if (window.mainframe.platform === 'win32') {
      shellNameRef.current = 'powershell';
    } else {
      shellNameRef.current = 'zsh';
    }
  }, []);

  return (
    <div className="h-full flex flex-col" data-testid="terminal-panel">
      {/* Tab bar */}
      <div className="flex items-center justify-between shrink-0 border-b border-mf-divider">
        <div className="flex items-center h-9 px-2 gap-0.5 overflow-x-auto">
          {terminals.map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveTerminal(t.id)}
              className={[
                'group flex items-center gap-1.5 px-2.5 h-7 rounded text-mf-small transition-colors shrink-0',
                t.id === activeTerminalId
                  ? 'bg-mf-input-bg text-mf-text-primary'
                  : 'text-mf-text-secondary hover:text-mf-text-primary hover:bg-mf-hover',
              ].join(' ')}
            >
              <span>{t.name}</span>
              <span
                role="button"
                onClick={(e) => {
                  e.stopPropagation();
                  closeTerminal(t.id);
                }}
                className="opacity-0 group-hover:opacity-100 hover:text-mf-destructive transition-opacity p-0.5"
              >
                <X size={12} />
              </span>
            </button>
          ))}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => void createTerminal()}
                className="p-1.5 rounded hover:bg-mf-hover text-mf-text-secondary hover:text-mf-text-primary transition-colors"
              >
                <Plus size={14} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">New terminal</TooltipContent>
          </Tooltip>
        </div>
        <div className="flex items-center pr-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => setPanelVisible(false)}
                aria-label="Minimize"
                className="p-1.5 rounded hover:bg-mf-hover text-mf-text-secondary hover:text-mf-text-primary transition-colors"
              >
                <Minus size={14} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Minimize</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Terminal instances — all mounted, only active one visible */}
      <div className="flex-1 min-h-0">
        {terminals.map((t) => (
          <TerminalInstance key={t.id} terminalId={t.id} visible={t.id === activeTerminalId} />
        ))}
      </div>
    </div>
  );
}
