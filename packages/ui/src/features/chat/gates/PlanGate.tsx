import { useRef, useState, type RefObject } from 'react';
import { SquareCheckIcon } from 'lucide-react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import type { ExecutionMode } from '@qlan-ro/mainframe-types';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import type { ChatPermissionEntry } from '../controller/chat-thread-state';
import { gateEyebrow, type GateContext, type ReplyFn } from './gate-types';
import { cn } from '@/lib/utils';
import { UnattendedConfirmDialog } from '../composer/config-toolbar/UnattendedConfirmDialog';
import { useUnattendedGuard } from '../composer/config-toolbar/use-unattended-confirm';
import { GateCardShell, GateHead, GATE_BUTTON, GATE_OUTLINE, GATE_PRIMARY } from './shared/GateShell';
import { markdownComponents } from '../parts/markdown-text';
import { urlTransform, remarkAppLinks } from '../parts/markdown-url-transform';
import { buildPlanResponse } from './build-control-response';
import { PlanExecModeControl } from './PlanExecModeControl';
import { PlanClearContextCheck } from './PlanClearContextCheck';

// The gate's preview and the durable PlanBubble record are the same plan, so
// they render through the same markdown map and plugin set — the gate used to
// carry a near-duplicate map of its own.
const REMARK_PLUGINS = [remarkGfm, remarkAppLinks, remarkBreaks];

export interface PlanGateProps {
  entry: ChatPermissionEntry;
  reply: ReplyFn;
  /** Resolved by the mount from the chat's adapter; omitted means no Auto segment. */
  autoAllowed?: boolean;
  /** The asking chat: approving into Unattended asks once per session (C13). */
  chatId?: string;
  /** The mode the composer's permissions control names ("then Auto-Edits"), preselected (G3). */
  composerMode?: ExecutionMode;
  context?: GateContext;
}

// ---------------------------------------------------------------------------
// Plan body — scrollable pre-formatted plan text
// ---------------------------------------------------------------------------

function PlanBody({ plan }: { plan: string }) {
  return (
    <div className="aui-md max-h-[300px] overflow-auto border-t border-border px-4 py-3 text-transcript text-foreground [&_:is(h1,h2,h3,h4)]:mt-0! [&_:is(h1,h2,h3,h4)]:mb-1.5! [&_:is(h1,h2,h3,h4)]:text-transcript! [&_:is(h1,h2,h3,h4)]:font-semibold! [&_:is(h1,h2,h3,h4)]:text-foreground! [&_li]:my-0! [&_li+li]:mt-0.5! [&_ol]:my-0! [&_ol]:pl-5!">
      <Markdown remarkPlugins={REMARK_PLUGINS} urlTransform={urlTransform} components={markdownComponents}>
        {plan}
      </Markdown>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Controls panel — exec-mode selector + clear-context checkbox
// ---------------------------------------------------------------------------

function ControlsPanel({
  execMode,
  setExecMode,
  clearContext,
  setClearContext,
  autoAllowed,
}: {
  execMode: ExecutionMode;
  setExecMode: (m: ExecutionMode) => void;
  clearContext: boolean;
  setClearContext: (v: boolean) => void;
  autoAllowed?: boolean;
}) {
  return (
    <div className="mx-4 my-3 flex flex-wrap items-center gap-3 rounded-md border border-border bg-queue-well px-3 py-2.5">
      <PlanExecModeControl value={execMode} onChange={setExecMode} autoAllowed={autoAllowed} />
      <div className="flex-1" />
      <PlanClearContextCheck checked={clearContext} onChange={setClearContext} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Action row — approve / keep-planning
// ---------------------------------------------------------------------------

function ActionRow({
  approveRef,
  onApprove,
  onKeepPlanning,
  onReject,
}: {
  approveRef: RefObject<HTMLButtonElement | null>;
  onApprove: () => void;
  onKeepPlanning: () => void;
  onReject: () => void;
}) {
  return (
    <div className="flex items-center gap-2 px-4 pt-1 pb-3">
      <Button
        size="sm"
        ref={approveRef}
        data-testid="chat-plan-approve"
        onClick={onApprove}
        className={cn('flex-1', GATE_BUTTON, GATE_PRIMARY)}
      >
        Approve &amp; run
      </Button>
      <Button
        variant="outline"
        size="sm"
        className={cn(GATE_BUTTON, GATE_OUTLINE)}
        data-testid="chat-plan-keep-planning"
        onClick={onKeepPlanning}
      >
        Keep planning
      </Button>
      <Button
        variant="outline"
        size="sm"
        className={cn(GATE_BUTTON, GATE_OUTLINE)}
        data-testid="chat-plan-reject"
        onClick={onReject}
      >
        Reject
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Revise row — feedback textarea + send button
// ---------------------------------------------------------------------------

function ReviseRow({
  feedback,
  setFeedback,
  onSend,
  onCancel,
}: {
  feedback: string;
  setFeedback: (v: string) => void;
  onSend: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="flex animate-in flex-col gap-2 px-4 pb-3 duration-150 fade-in-0 slide-in-from-top-1">
      <Textarea
        data-testid="chat-plan-feedback-input"
        rows={3}
        placeholder="What should be changed..."
        value={feedback}
        onChange={(e) => setFeedback(e.target.value)}
        className="min-h-[77px] resize-none rounded-md border-input bg-card px-2.5 py-2 text-row md:text-row shadow-none dark:bg-card"
      />
      <div className="flex items-center justify-end gap-2">
        <Button
          variant="outline"
          size="sm"
          className={cn(GATE_BUTTON, GATE_OUTLINE)}
          data-testid="chat-plan-revise-cancel"
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button
          size="sm"
          className={cn(GATE_BUTTON, GATE_PRIMARY)}
          data-testid="chat-plan-send-feedback"
          disabled={feedback.trim() === ''}
          onClick={onSend}
        >
          Send feedback
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PlanGate
// ---------------------------------------------------------------------------

export function PlanGate({ entry, reply, autoAllowed, chatId, composerMode, context }: PlanGateProps) {
  const offered = composerMode !== 'auto' || autoAllowed === true;
  const [execMode, setExecMode] = useState<ExecutionMode>((offered && composerMode) || 'default');
  const [clearContext, setClearContext] = useState(false);
  const [revising, setRevising] = useState(false);
  const [feedback, setFeedback] = useState('');

  const plan = (entry.request.input.plan as string | undefined) ?? '';

  const unattended = useUnattendedGuard(chatId ?? null);
  const approveButton = useRef<HTMLButtonElement>(null);

  const handleApprove = () => {
    const approve = () =>
      void reply(buildPlanResponse(entry, { kind: 'approve', executionMode: execMode, clearContext }));
    unattended.run(execMode, composerMode ?? 'default', approve);
  };

  const handleSendFeedback = () => {
    if (!feedback.trim()) return;
    void reply(buildPlanResponse(entry, { kind: 'revise', feedback }));
  };

  const handleReject = () => {
    void reply(buildPlanResponse(entry, { kind: 'reject' }));
  };

  return (
    <div data-testid="chat-plan-gate">
      <GateCardShell>
        <GateHead
          icon={<SquareCheckIcon className="size-3.5" />}
          tileClassName="bg-primary/12 text-accent-ink"
          eyebrow={gateEyebrow('Plan', context, { withTitle: true })}
          title="Ready to implement"
        />
        {plan && <PlanBody plan={plan} />}
        <ControlsPanel
          execMode={execMode}
          setExecMode={setExecMode}
          clearContext={clearContext}
          setClearContext={setClearContext}
          autoAllowed={autoAllowed}
        />
        {revising ? (
          <ReviseRow
            feedback={feedback}
            setFeedback={setFeedback}
            onSend={handleSendFeedback}
            onCancel={() => setRevising(false)}
          />
        ) : (
          <ActionRow
            approveRef={approveButton}
            onApprove={handleApprove}
            onKeepPlanning={() => setRevising(true)}
            onReject={handleReject}
          />
        )}
      </GateCardShell>
      <UnattendedConfirmDialog confirm={unattended} returnFocus={() => approveButton.current?.focus()} />
    </div>
  );
}
