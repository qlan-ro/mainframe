import React, { useEffect, useRef, useState } from 'react';
import type { LaunchConfiguration } from '@mainframe/types';
import { useSandboxStore } from '../../store/sandbox';
import { useProjectsStore } from '../../store/projects';
import { startLaunchConfig, stopLaunchConfig } from '../../lib/launch';

export function LogsTab(): React.ReactElement {
  const { processStatuses, logsOutput } = useSandboxStore();
  const activeProject = useProjectsStore((s) =>
    s.activeProjectId ? (s.projects.find((p) => p.id === s.activeProjectId) ?? null) : null,
  );
  const [configs, setConfigs] = useState<LaunchConfiguration[]>([]);
  const [selectedProcess, setSelectedProcess] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  // Load launch.json configurations
  useEffect(() => {
    if (!activeProject) return;
    void window.mainframe
      .readFile(`${activeProject.path}/.mainframe/launch.json`)
      .then((content) => {
        if (!content) return;
        const config = JSON.parse(content) as { configurations: LaunchConfiguration[] };
        setConfigs(config.configurations);
        if (config.configurations[0]) setSelectedProcess(config.configurations[0].name);
      })
      .catch(() => {
        /* file absent or invalid — expected */
      });
  }, [activeProject?.id]);

  // Auto-scroll logs
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logsOutput]);

  const filteredLogs = selectedProcess ? logsOutput.filter((l) => l.name === selectedProcess) : logsOutput;

  const handleStart = async (config: LaunchConfiguration) => {
    if (!activeProject) return;
    await startLaunchConfig(activeProject.id, config);
  };

  const handleStop = async (name: string) => {
    if (!activeProject) return;
    await stopLaunchConfig(activeProject.id, name);
  };

  const handleStartAll = () => {
    configs.forEach((c) => void handleStart(c));
  };

  const handleStopAll = () => {
    configs.forEach((c) => void handleStop(c.name));
  };

  if (!activeProject) {
    return (
      <div className="flex items-center justify-center h-full text-mf-text-secondary text-sm">No project selected.</div>
    );
  }

  if (configs.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-mf-text-secondary text-sm">
        No <code className="mx-1">.mainframe/launch.json</code> found in this project.
      </div>
    );
  }

  return (
    <div className="h-full flex overflow-hidden">
      {/* Process list */}
      <div className="w-48 border-r border-mf-divider flex flex-col shrink-0">
        <div className="flex gap-1 p-2 border-b border-mf-divider">
          <button
            onClick={handleStartAll}
            className="flex-1 text-xs bg-green-700 hover:bg-green-600 text-white rounded py-1"
          >
            All ▶
          </button>
          <button
            onClick={handleStopAll}
            className="flex-1 text-xs bg-red-800 hover:bg-red-700 text-white rounded py-1"
          >
            All ■
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {configs.map((c) => {
            const status = processStatuses[c.name] ?? 'stopped';
            return (
              <div
                key={c.name}
                onClick={() => setSelectedProcess(c.name)}
                className={[
                  'flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-mf-hover',
                  selectedProcess === c.name ? 'bg-mf-selected' : '',
                ].join(' ')}
              >
                <span
                  className={[
                    'w-1.5 h-1.5 rounded-full',
                    status === 'running'
                      ? 'bg-green-400'
                      : status === 'starting'
                        ? 'bg-yellow-400'
                        : status === 'failed'
                          ? 'bg-red-400'
                          : 'bg-mf-text-secondary',
                  ].join(' ')}
                />
                <span className="flex-1 text-xs truncate text-mf-text-primary">{c.name}</span>
                {status === 'running' || status === 'starting' ? (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleStop(c.name);
                    }}
                    className="text-mf-text-secondary hover:text-red-400 text-xs"
                  >
                    ■
                  </button>
                ) : (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleStart(c);
                    }}
                    className="text-mf-text-secondary hover:text-green-400 text-xs"
                  >
                    ▶
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Log output */}
      <div ref={logRef} className="flex-1 overflow-y-auto p-2 font-mono text-xs text-mf-text-secondary bg-mf-app-bg">
        {filteredLogs.length === 0 ? (
          <span className="text-mf-text-secondary">No output yet.</span>
        ) : (
          filteredLogs.map((l, i) => (
            <div key={i} className={l.stream === 'stderr' ? 'text-red-400' : ''}>
              {l.data}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
