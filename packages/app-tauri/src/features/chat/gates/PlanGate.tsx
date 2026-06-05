import { useState } from 'react';
import { ClipboardListIcon } from 'lucide-react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ChatPermissionEntry } from '../controller/chat-thread-state';
import type { ReplyFn } from './gate-types';
import { GateCardShell, GateHead } from './shared/GateShell';
import { GateButton } from './shared/GateButton';
import { Textarea } from '@/components/ui/textarea';
import { buildPlanResponse } from './build-control-response';
import { PlanExecModeControl, type ExecMode } from './PlanExecModeControl';
import { PlanClearContextCheck } from './PlanClearContextCheck';

export interface PlanGateProps {
  entry: ChatPermissionEntry;
  reply: ReplyFn;
}

// ---------------------------------------------------------------------------
// Plan body — scrollable pre-formatted plan text
// ---------------------------------------------------------------------------

function PlanBody({ plan }: { plan: string }) {
  return (
    <div className="px-3.5 pb-3">
      <div className="aui-md max-h-[300px] overflow-auto rounded-md bg-card px-3 py-2.5 text-body text-foreground">
        <Markdown remarkPlugins={[remarkGfm]}>{plan}</Markdown>
      </div>
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
}: {
  execMode: ExecMode;
  setExecMode: (m: ExecMode) => void;
  clearContext: boolean;
  setClearContext: (v: boolean) => void;
}) {
  return (
    <div className="mx-3.5 mb-3 flex flex-wrap items-center gap-3 rounded-md border border-border bg-card px-3 py-2.5">
      <PlanExecModeControl value={execMode} onChange={setExecMode} />
      <div className="flex-1" />
      <PlanClearContextCheck checked={clearContext} onChange={setClearContext} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Action row — approve / keep-planning
// ---------------------------------------------------------------------------

function ActionRow({ onApprove, onKeepPlanning }: { onApprove: () => void; onKeepPlanning: () => void }) {
  return (
    <div className="flex items-center gap-2 px-3.5 pb-3">
      <GateButton kind="primary" data-testid="chat-plan-approve" onClick={onApprove} className="flex-1">
        Approve &amp; run
      </GateButton>
      <GateButton kind="ghost" data-testid="chat-plan-keep-planning" onClick={onKeepPlanning}>
        Keep planning
      </GateButton>
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
}: {
  feedback: string;
  setFeedback: (v: string) => void;
  onSend: () => void;
}) {
  return (
    <div className="flex flex-col gap-2 px-3.5 pb-3">
      <Textarea
        data-testid="chat-plan-feedback-input"
        rows={3}
        placeholder="What should be changed..."
        value={feedback}
        onChange={(e) => setFeedback(e.target.value)}
        className="resize-none"
      />
      <div className="flex justify-end">
        <GateButton
          kind="primary"
          data-testid="chat-plan-send-feedback"
          disabled={feedback.trim() === ''}
          onClick={onSend}
        >
          Send feedback
        </GateButton>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PlanGate
// ---------------------------------------------------------------------------

export function PlanGate({ entry, reply }: PlanGateProps) {
  const [execMode, setExecMode] = useState<ExecMode>('default');
  const [clearContext, setClearContext] = useState(false);
  const [revising, setRevising] = useState(false);
  const [feedback, setFeedback] = useState('');

  const plan = (entry.request.input.plan as string | undefined) ?? '';

  const handleApprove = () => {
    void reply(entry.requestId, buildPlanResponse(entry, { kind: 'approve', executionMode: execMode, clearContext }));
  };

  const handleSendFeedback = () => {
    if (!feedback.trim()) return;
    void reply(entry.requestId, buildPlanResponse(entry, { kind: 'revise', feedback }));
  };

  return (
    <div data-testid="chat-plan-gate">
      <GateCardShell>
        <GateHead
          icon={<ClipboardListIcon className="size-4" />}
          tileClassName="bg-mf-selection text-primary"
          eyebrow="Plan"
          title="Ready to implement"
        />
        {plan && <PlanBody plan={plan} />}
        <ControlsPanel
          execMode={execMode}
          setExecMode={setExecMode}
          clearContext={clearContext}
          setClearContext={setClearContext}
        />
        {revising ? (
          <ReviseRow feedback={feedback} setFeedback={setFeedback} onSend={handleSendFeedback} />
        ) : (
          <ActionRow onApprove={handleApprove} onKeepPlanning={() => setRevising(true)} />
        )}
      </GateCardShell>
    </div>
  );
}
