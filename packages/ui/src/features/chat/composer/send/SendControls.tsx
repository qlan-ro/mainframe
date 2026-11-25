'use client';

/**
 * The composer's right end (C8, C9): Send when idle; Stop while anything runs;
 * Stop plus the Queue / Steer split once there is something to send into a
 * running turn. Stop stays its own button, so it is always one click.
 *
 * `useCanSubmit` is subscribed HERE, not in `Composer`: it reads the live
 * draft text, so hoisting it would re-render the whole composer on every
 * keystroke.
 */
import { useRef, useState } from 'react';
import { useAuiState } from '@assistant-ui/react';
import { ArrowUpIcon, ChevronDown, Clock, CornerDownLeft, Loader2Icon, type LucideIcon } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import type { EnterWhileRunning } from '@/store/ui-prefs';
import { useActiveThreadId } from '../../runtime/use-active-thread-id';
import { ComposerHint } from '../composer-card-context';
import { useDraftItems } from '../draft-content/draft-content-store';
import { useCanSubmit, type SubmitComposition } from '../segments/use-submit-composition';
import { useCanSteer, useEnterMode } from './use-enter-mode';
import { useComposerStop, type ComposerStop } from './use-stop';
import { useStopShortcut } from './use-stop-shortcut';

const ROUND = 'grid size-7 shrink-0 place-items-center rounded-full border transition-colors focus-visible:focus-line';

function StopButton({ stop }: { stop: ComposerStop }) {
  const label = stop.stopping ? 'Stopping' : `Stop ${stop.target}`;
  return (
    <ComposerHint label={stop.stopping ? 'Stopping…' : `${label} ⌘.`}>
      <button
        type="button"
        data-testid="chat-composer-cancel"
        data-stopping={stop.stopping || undefined}
        aria-label={label}
        disabled={stop.stopping}
        onClick={(event) => stop.stop(event.currentTarget)}
        className={cn(
          ROUND,
          stop.stopping
            ? 'border-input text-muted-foreground'
            : 'border-foreground bg-foreground text-card hover:opacity-86',
        )}
      >
        {stop.stopping ? (
          <Loader2Icon className="size-4 animate-spin motion-reduce:animate-none" />
        ) : (
          <svg viewBox="0 0 16 16" className="size-4" fill="currentColor" aria-hidden>
            <rect x="3.5" y="3.5" width="9" height="9" rx="2" />
          </svg>
        )}
      </button>
    </ComposerHint>
  );
}

function SendButton({ ready }: { ready: boolean }) {
  return (
    <ComposerHint label="Send ↵">
      <button
        type="submit"
        data-testid="chat-composer-send"
        aria-label="Send"
        disabled={!ready}
        className={cn(
          ROUND,
          ready
            ? 'border-primary bg-accent-fill text-primary-foreground hover:brightness-95'
            : 'border-input text-faint',
        )}
      >
        <ArrowUpIcon className="size-4" />
      </button>
    </ComposerHint>
  );
}

const MODES: readonly { id: EnterWhileRunning; label: string; description?: string; Icon: LucideIcon }[] = [
  { id: 'queue', label: 'Queue', description: 'Send when the agent finishes', Icon: Clock },
  { id: 'steer', label: 'Steer', Icon: CornerDownLeft },
];

function steerNote(canSteer: boolean, hasFiles: boolean): string {
  if (!canSteer) return 'This agent can’t take messages mid-turn, so it will queue';
  if (hasFiles) return 'A message with files queues';
  return 'Add to the running turn without stopping it';
}

function QueueSplit({ submit }: { submit: SubmitComposition }) {
  const preferred = useEnterMode();
  const canSteer = useCanSteer();
  const hasAttachments = useAuiState((s) => (s.composer?.attachments?.length ?? 0) > 0);
  // A capture is sent as a file; a code annotation is text.
  const hasCaptures = useDraftItems(useActiveThreadId()).some((item) => item.kind === 'capture');
  const hasFiles = hasAttachments || hasCaptures;
  const [open, setOpen] = useState(false);
  // White, not the focus blue: the line sits on a blue fill.
  const half =
    'inline-flex h-7 items-center text-body font-semibold hover:bg-white/14 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-white';

  return (
    <div className="inline-flex h-7 shrink-0 overflow-hidden rounded-[14px] bg-accent-fill text-white">
      <ComposerHint
        label={preferred === 'steer' ? 'Steer: add to the running turn ↵' : 'Queue for when the agent finishes ↵'}
      >
        <button
          type="button"
          data-testid="chat-composer-send-running"
          data-mode={preferred}
          aria-label={preferred === 'steer' ? 'Steer: add to the running turn' : 'Queue message'}
          onClick={() => submit(preferred)}
          className={cn(
            half,
            'gap-1.5 rounded-l-[14px] pr-2 pl-3 @max-[400px]/composer:pr-1.5 @max-[400px]/composer:pl-2.5',
          )}
        >
          <span className="@max-[400px]/composer:hidden">{preferred === 'steer' ? 'Steer' : 'Queue'}</span>
          <CornerDownLeft className="size-4" aria-hidden />
        </button>
      </ComposerHint>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <ComposerHint label="Queue or steer">
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              data-testid="chat-composer-send-options"
              aria-label="Queue or steer"
              className={cn(half, 'w-[26px] justify-center rounded-r-[14px] shadow-split')}
            >
              <ChevronDown className="size-3" aria-hidden />
            </button>
          </DropdownMenuTrigger>
        </ComposerHint>
        <DropdownMenuContent align="end" side="top" sideOffset={6} className="w-auto min-w-72.5">
          {MODES.map((mode) => (
            <DropdownMenuItem
              key={mode.id}
              data-testid={`chat-composer-send-${mode.id}`}
              className="items-start"
              onSelect={() => submit(mode.id)}
            >
              <span className="flex h-5 shrink-0 items-center">
                <mode.Icon className="size-4 text-muted-foreground" />
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="font-medium">{mode.label}</span>
                <span className="text-meta/[1.35] font-normal text-muted-foreground">
                  {mode.id === 'steer' ? steerNote(canSteer, hasFiles) : mode.description}
                </span>
              </span>
              <span className="flex h-5 shrink-0 items-center">
                <DropdownMenuShortcut>{mode.id === preferred ? '↵' : '⌥↵'}</DropdownMenuShortcut>
              </span>
            </DropdownMenuItem>
          ))}
          {canSteer && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="pt-1.5 pb-1 text-meta/[1.45] font-normal">
                Choose what Enter does in Settings › Chat
              </DropdownMenuLabel>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/** Stop and its shortcut, wherever the composer shows them. */
export function StopControl() {
  const stop = useComposerStop();
  const anchor = useRef<HTMLSpanElement>(null);
  useStopShortcut(anchor, () => stop.stop(anchor.current), stop.running);
  return (
    <>
      <span ref={anchor} hidden />
      {stop.available && <StopButton stop={stop} />}
    </>
  );
}

export function SendControls({ submit }: { submit: SubmitComposition }) {
  const isRunning = useAuiState((s) => s.thread.isRunning);
  const canSubmit = useCanSubmit();
  const { available, stopping } = useComposerStop();

  // A split appears only while the turn runs: with sub-agents alone, a new
  // message starts a turn, so plain Send sits beside Stop.
  const split = isRunning && !stopping && canSubmit;
  return (
    <>
      <StopControl />
      {split && <QueueSplit submit={submit} />}
      {!isRunning && (canSubmit || !available) && <SendButton ready={canSubmit} />}
    </>
  );
}
