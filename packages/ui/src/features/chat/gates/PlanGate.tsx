import { useState } from 'react';
import { SquareCheckIcon } from 'lucide-react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import type { ExecutionMode } from '@qlan-ro/mainframe-types';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import type { ChatPermissionEntry } from '../controller/chat-thread-state';
import type { ReplyFn } from './gate-types';
import { GateCardShell, GateHead } from './shared/GateShell';
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
}

// ---------------------------------------------------------------------------
// Plan body — scrollable pre-formatted plan text
// ---------------------------------------------------------------------------

function PlanBody({ plan }: { plan: string }) {
  return (
    <div className="aui-md max-h-[300px] overflow-auto border-t border-border px-4 py-3 text-sm text-foreground">
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
    <div className="mx-4 my-3 flex flex-wrap items-center gap-3 rounded-md border border-border bg-muted px-3 py-2.5">
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
  onApprove,
  onKeepPlanning,
  onReject,
}: {
  onApprove: () => void;
  onKeepPlanning: () => void;
  onReject: () => void;
}) {
  return (
    <div className="flex items-center gap-2 px-4 pb-3">
      <Button size="sm" data-testid="chat-plan-approve" onClick={onApprove} className="flex-1">
        Approve &amp; run
      </Button>
      <Button variant="outline" size="sm" data-testid="chat-plan-keep-planning" onClick={onKeepPlanning}>
        Keep planning
      </Button>
      <Button variant="outline" size="sm" data-testid="chat-plan-reject" onClick={onReject}>
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
        className="resize-none"
      />
      <div className="flex items-center justify-end gap-2">
        <Button variant="outline" size="sm" data-testid="chat-plan-revise-cancel" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" data-testid="chat-plan-send-feedback" disabled={feedback.trim() === ''} onClick={onSend}>
          Send feedback
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PlanGate
// ---------------------------------------------------------------------------

export function PlanGate({ entry, reply, autoAllowed }: PlanGateProps) {
  const [execMode, setExecMode] = useState<ExecutionMode>('default');
  const [clearContext, setClearContext] = useState(false);
  const [revising, setRevising] = useState(false);
  const [feedback, setFeedback] = useState('');

  const plan = (entry.request.input.plan as string | undefined) ?? '';

  const handleApprove = () => {
    void reply(buildPlanResponse(entry, { kind: 'approve', executionMode: execMode, clearContext }));
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
          tileClassName="bg-primary/10 text-primary"
          eyebrow="Plan"
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
          <ActionRow onApprove={handleApprove} onKeepPlanning={() => setRevising(true)} onReject={handleReject} />
        )}
      </GateCardShell>
    </div>
  );
}
