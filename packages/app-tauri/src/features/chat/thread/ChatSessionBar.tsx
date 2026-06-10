/**
 * ChatSessionBar — the 28px session strip under the chat-card header
 * (design `03-content.jsx` ChatSessionBar; desktop `ChatSessionBar.tsx`).
 *
 * Left: adapter dot + name · model. Center: live status (Awaiting / Compacting /
 * Thinking / Error / Worktree Missing — idle shows nothing). Right: 8-segment
 * context meter + percentage (CLI-reported via `chat.contextUsage`, token-estimate
 * fallback when the model's window is known).
 *
 * Per the design: branch lives in the MainToolbar breadcrumb and the PR pill in
 * the ChatCardHeader — neither is duplicated here. The background-tasks pill is
 * deferred (no task feed in app-tauri yet). Renders nothing until the chat
 * config is loaded (drafts / blank surface).
 */
import { AlertTriangle, CircleDot, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useChatExtras } from '../runtime/use-chat-thread-runtime';
import { useAdapters } from '../composer/config-toolbar/use-composer-tuning';
import { providerDot } from '../composer/config-toolbar/ProviderModelSelect';
import { deriveContextPct, deriveSessionBarStatus, type SessionBarStatus } from './session-bar-status';

const SEGMENTS = 8;

function segmentColor(pct: number): string {
  if (pct >= 90) return 'bg-destructive';
  if (pct >= 75) return 'bg-mf-warning';
  if (pct >= 50) return 'bg-mf-warning opacity-60';
  return 'bg-mf-text-3 opacity-60';
}

const STATUS_VIEW: Record<NonNullable<SessionBarStatus>, { label: string; icon: 'spin' | 'pulse' | 'alert' }> = {
  'worktree-missing': { label: 'Worktree Missing', icon: 'alert' },
  awaiting: { label: 'Awaiting', icon: 'pulse' },
  compacting: { label: 'Compacting', icon: 'spin' },
  thinking: { label: 'Thinking', icon: 'spin' },
  error: { label: 'Error', icon: 'alert' },
};

function StatusIndicator({ status }: { status: SessionBarStatus }) {
  if (status == null) return null;
  const view = STATUS_VIEW[status];
  const isAlert = view.icon === 'alert';
  return (
    <div className={cn('flex items-center gap-1.5', isAlert ? 'text-destructive' : 'text-muted-foreground')}>
      {view.icon === 'spin' && <Loader2 size={12} className="flex-shrink-0 animate-spin motion-reduce:animate-none" />}
      {view.icon === 'pulse' && (
        <CircleDot size={12} className="flex-shrink-0 animate-pulse motion-reduce:animate-none" />
      )}
      {isAlert && <AlertTriangle size={12} className="flex-shrink-0" />}
      <span>{view.label}</span>
    </div>
  );
}

export function ChatSessionBar() {
  const extras = useChatExtras();
  const adapters = useAdapters();

  const state = extras?.state;
  const chat = state?.chatConfig;
  if (state == null || chat == null) return null;

  const adapter = adapters.find((a) => a.id === chat.adapterId) ?? null;
  const model = adapter?.models.find((m) => m.id === chat.model) ?? null;
  const adapterLabel = adapter?.name ?? chat.adapterId;
  const modelLabel = model?.label ?? chat.model ?? null;

  const status = deriveSessionBarStatus(state);
  const pct = deriveContextPct(state, model?.contextWindow);
  const filled = pct == null ? 0 : Math.round((pct / 100) * SEGMENTS);
  const fillClass = segmentColor(pct ?? 0);

  return (
    <div
      data-testid="chat-session-bar"
      className="flex h-7 flex-shrink-0 items-center gap-2.5 bg-mf-content2 px-3 text-caption text-muted-foreground [border-bottom:0.5px_solid_var(--border)]"
    >
      {/* Left: adapter identity */}
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        <span className={cn('size-1.5 flex-shrink-0 rounded-full', providerDot(chat.adapterId))} />
        <span data-testid="chat-session-bar-adapter" className="flex-shrink-0 font-semibold text-foreground">
          {adapterLabel}
        </span>
        {modelLabel && (
          <>
            <span className="flex-shrink-0 text-mf-text-4">·</span>
            <span data-testid="chat-session-bar-model" className="truncate font-medium">
              {modelLabel}
            </span>
          </>
        )}
      </div>

      {/* Center: status */}
      <div data-testid="chat-session-bar-status" className="flex flex-shrink-0 items-center justify-center px-3">
        <StatusIndicator status={status} />
      </div>

      {/* Right: context meter */}
      <div className="flex min-w-0 flex-1 items-center justify-end gap-1.5">
        {pct != null && (
          <>
            <div className="flex gap-[1.5px]" title={`Context: ${pct}% used`}>
              {Array.from({ length: SEGMENTS }, (_, i) => (
                <div
                  key={i}
                  className={cn('h-[9px] w-[3px] rounded-[1.5px]', i < filled ? fillClass : 'bg-mf-text-3 opacity-15')}
                />
              ))}
            </div>
            <span
              data-testid="chat-session-bar-context-pct"
              className="font-mono text-micro tabular-nums text-mf-text-3"
            >
              {pct}%
            </span>
          </>
        )}
      </div>
    </div>
  );
}
