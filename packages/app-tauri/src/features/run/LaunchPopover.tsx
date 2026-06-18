/**
 * LaunchPopover — lists available launch configurations, shows their status,
 * and lets the user start or stop them.
 *
 * Starting a config that has `preview: true` also opens (or activates) a
 * `kind:'preview'` Run tab via `useLayoutStore.addRunTab`.
 *
 * Scoped testids: run-launch-trigger, run-launch-config-<name>.
 */
import { useState, useCallback } from 'react';
import { Play, Square, Loader2, Rocket } from 'lucide-react';
import { toast } from 'sonner';
import type { LaunchConfiguration } from '@qlan-ro/mainframe-types';
import { startLaunchConfig, stopLaunchConfig } from '@/lib/api/launch';
import { buildLaunchScope } from '@/lib/launch-scope';
import { useSandboxStore } from '@/store/sandbox';
import { useLayoutStore } from '@/store/layout';
import { useDaemonPort } from '@/features/sessions/runtime/daemon-port-context';
import { useActiveIdentity } from '@/features/sessions/use-active-identity';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { MenuRow, MenuEmpty } from '@/components/ui/menu';
import { useLaunchConfigs } from './use-launch-configs';

export function LaunchPopover() {
  const [open, setOpen] = useState(false);
  const port = useDaemonPort();
  const { projectId, chatId } = useActiveIdentity();
  const { configs, statusData, refetch } = useLaunchConfigs();
  const processStatuses = useSandboxStore((s) => s.processStatuses);
  const addRunTab = useLayoutStore((s) => s.addRunTab);

  const scopeKey = projectId && statusData?.effectivePath
    ? buildLaunchScope(projectId, statusData.effectivePath)
    : null;
  const scopeStatuses: Record<string, string> = scopeKey
    ? (processStatuses[scopeKey] ?? {})
    : {};

  const handleOpen = useCallback((next: boolean) => {
    if (next) refetch();
    setOpen(next);
  }, [refetch]);

  const handleLaunch = useCallback(async (config: LaunchConfiguration) => {
    if (!projectId) return;
    setOpen(false);
    try {
      if (config.preview) {
        const tabId = `preview-${config.name}-${crypto.randomUUID().slice(0, 8)}`;
        addRunTab({ id: tabId, kind: 'preview', title: config.name, config: config.name });
      }
      await startLaunchConfig(port, projectId, config.name, chatId ?? undefined);
    } catch (err) {
      toast.error(`Failed to start "${config.name}"`);
      console.warn('[launch] start failed', err);
    }
  }, [port, projectId, chatId, addRunTab]);

  const handleStop = useCallback(async (config: LaunchConfiguration) => {
    if (!projectId) return;
    setOpen(false);
    try {
      await stopLaunchConfig(port, projectId, config.name, chatId ?? undefined);
    } catch (err) {
      toast.error(`Failed to stop "${config.name}"`);
      console.warn('[launch] stop failed', err);
    }
  }, [port, projectId, chatId]);

  return (
    <Popover open={open} onOpenChange={handleOpen}>
      <PopoverTrigger asChild>
        <Button
          data-testid="run-launch-trigger"
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 text-caption text-muted-foreground hover:text-foreground"
          aria-label="Launch a process"
        >
          <Rocket size={12} />
          Launch
        </Button>
      </PopoverTrigger>
      <PopoverContent
        data-testid="run-launch-popover"
        className="w-56"
        align="start"
      >
        {configs.length === 0 ? (
          <MenuEmpty>No launch configs found.</MenuEmpty>
        ) : (
          configs.map((cfg) => (
            <LaunchConfigRow
              key={cfg.name}
              config={cfg}
              status={scopeStatuses[cfg.name] ?? 'stopped'}
              onLaunch={handleLaunch}
              onStop={handleStop}
            />
          ))
        )}
      </PopoverContent>
    </Popover>
  );
}

interface LaunchConfigRowProps {
  config: LaunchConfiguration;
  status: string;
  onLaunch: (cfg: LaunchConfiguration) => void;
  onStop: (cfg: LaunchConfiguration) => void;
}

function LaunchConfigRow({ config, status, onLaunch, onStop }: LaunchConfigRowProps) {
  const isRunning = status === 'running';
  const isStarting = status === 'starting';
  const isActive = isRunning || isStarting;

  return (
    <MenuRow
      data-testid={`run-launch-config-${config.name}`}
      label={config.name}
      trailing={<StatusIcon status={status} />}
      onClick={() => (isActive ? onStop(config) : onLaunch(config))}
    />
  );
}

function StatusIcon({ status }: { status: string }) {
  if (status === 'starting') return <Loader2 size={11} className="animate-spin text-muted-foreground" />;
  if (status === 'running') return <Square size={11} className="text-destructive" />;
  return <Play size={11} className="text-muted-foreground" />;
}
