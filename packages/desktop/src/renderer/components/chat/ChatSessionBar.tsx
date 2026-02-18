import React from 'react';
import { GitBranch, Loader2, CircleDot, AlertTriangle } from 'lucide-react';
import { useChatsStore } from '../../store/chats';
import { useAdaptersStore } from '../../store/adapters';
import { cn } from '../../lib/utils';
import { getAdapterLabel, getModelContextWindow, getModelLabel } from '../../lib/adapters';

const ADAPTER_ACCENT: Record<string, string> = {
  claude: 'bg-mf-accent-claude',
  codex: 'bg-mf-accent-codex',
  gemini: 'bg-mf-accent-gemini',
  opencode: 'bg-mf-accent-opencode',
};

const PROGRESS_SEGMENTS = 8;

function getProgressColor(pct: number): string {
  if (pct >= 90) return 'bg-mf-chat-progress-critical';
  if (pct >= 75) return 'bg-mf-warning';
  if (pct >= 50) return 'bg-mf-warning opacity-60';
  return 'bg-mf-text-secondary opacity-60';
}

function Divider() {
  return <div className="w-px h-3 bg-mf-divider shrink-0" />;
}

function StatusIndicator({ chatId }: { chatId: string }) {
  const chat = useChatsStore((s) => s.chats.find((c) => c.id === chatId));
  const process = useChatsStore((s) => s.processes.get(chatId));
  const hasPendingPermission = useChatsStore((s) => s.pendingPermissions.has(chatId));

  if (!chat) return null;

  if (hasPendingPermission) {
    return (
      <div className="flex items-center gap-1.5 text-mf-text-secondary">
        <CircleDot size={12} className="animate-pulse motion-reduce:animate-none shrink-0" />
        <span>Awaiting</span>
      </div>
    );
  }

  if (chat.processState === 'working') {
    return (
      <div className="flex items-center gap-1.5 text-mf-text-secondary">
        <Loader2 size={12} className="animate-spin motion-reduce:animate-none shrink-0" />
        <span>Thinking</span>
      </div>
    );
  }

  if (process?.status === 'starting') {
    return (
      <div className="flex items-center gap-1.5 text-mf-text-secondary">
        <Loader2 size={12} className="animate-spin motion-reduce:animate-none shrink-0" />
        <span>Starting</span>
      </div>
    );
  }

  if (process?.status === 'error') {
    return (
      <div className="flex items-center gap-1.5 text-mf-destructive">
        <AlertTriangle size={12} className="shrink-0" />
        <span>Error</span>
      </div>
    );
  }

  return null;
}

interface ChatSessionBarProps {
  chatId: string;
}

export function ChatSessionBar({ chatId }: ChatSessionBarProps): React.ReactElement {
  const chat = useChatsStore((s) => s.chats.find((c) => c.id === chatId));
  const adapters = useAdaptersStore((s) => s.adapters);

  if (!chat) {
    return <div className="h-7 bg-mf-panel-bg" />;
  }

  const adapterLabel = getAdapterLabel(chat.adapterId, adapters);
  const modelLabel = getModelLabel(chat.model, adapters);
  const accentClass = ADAPTER_ACCENT[chat.adapterId] ?? 'bg-mf-text-secondary';
  const contextWindow = getModelContextWindow(chat.model, adapters);
  const usagePct = Math.min(100, Math.round(((chat.lastContextTokensInput ?? 0) / contextWindow) * 100));
  const filledSegments = Math.round((usagePct / 100) * PROGRESS_SEGMENTS);
  const progressColor = getProgressColor(usagePct);

  return (
    <div className="h-7 flex items-center px-3 text-mf-status bg-mf-panel-bg shrink-0">
      {/* Left: identity */}
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <div className={cn('w-[6px] h-[6px] rounded-full shrink-0', accentClass)} />
          <span className="text-mf-text-secondary">{adapterLabel}</span>
          {modelLabel && <span className="text-mf-text-secondary opacity-60">{modelLabel}</span>}
        </div>

        {chat.branchName && (
          <>
            <Divider />
            <div className="flex items-center gap-1 text-mf-text-secondary min-w-0">
              <GitBranch size={11} className="shrink-0" />
              <span className="font-mono truncate max-w-[120px]" title={chat.branchName}>
                {chat.branchName}
              </span>
            </div>
          </>
        )}
      </div>

      {/* Center: status */}
      <div className="flex items-center justify-center px-3">
        <StatusIndicator chatId={chatId} />
      </div>

      {/* Right: token progress */}
      <div className="flex items-center gap-1.5 flex-1 justify-end min-w-0">
        <div className="flex gap-px">
          {Array.from({ length: PROGRESS_SEGMENTS }, (_, i) => (
            <div
              key={i}
              className={cn(
                'w-1 h-2 rounded-[1px]',
                i < filledSegments ? progressColor : 'bg-mf-text-secondary opacity-15',
              )}
            />
          ))}
        </div>
        {usagePct > 0 && <span className="text-mf-text-secondary tabular-nums">{usagePct}%</span>}
      </div>
    </div>
  );
}
