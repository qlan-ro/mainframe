import { useState } from 'react';
import { SquareCheckIcon } from 'lucide-react';
import Markdown from 'react-markdown';
import type { Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ChatPermissionEntry } from '../controller/chat-thread-state';
import type { ReplyFn } from './gate-types';
import { GateCardShell, GateHead } from './shared/GateShell';
import { GateButton } from './shared/GateButton';
import { Textarea } from '@/components/ui/textarea';
import { buildPlanResponse } from './build-control-response';
import { PlanExecModeControl } from './PlanExecModeControl';
import type { ExecutionMode } from '@qlan-ro/mainframe-types';
import { PlanClearContextCheck } from './PlanClearContextCheck';

// ---------------------------------------------------------------------------
// Stable module-level markdown components map (warm-chrome typography)
// ---------------------------------------------------------------------------

const PLAN_MD_COMPONENTS: Components = {
  p: ({ children }) => <p className="mb-2 text-body leading-relaxed">{children}</p>,
  ul: ({ children }) => <ul className="mb-2 list-disc pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="mb-2 list-decimal pl-5">{children}</ol>,
  li: ({ children }) => <li className="mb-1">{children}</li>,
  h1: ({ children }) => <h1 className="mb-1 mt-3 text-heading font-semibold text-foreground">{children}</h1>,
  h2: ({ children }) => <h2 className="mb-1 mt-3 text-body font-semibold text-foreground">{children}</h2>,
  h3: ({ children }) => <h3 className="mb-1 mt-3 text-body font-semibold text-foreground">{children}</h3>,
  code: ({ children }) => <code className="rounded bg-mf-raised px-1 py-0.5 font-mono text-label">{children}</code>,
  pre: ({ children }) => (
    <pre className="mb-2 overflow-auto rounded-md bg-mf-raised p-3 font-mono text-label">{children}</pre>
  ),
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  a: ({ href, children }) => (
    <a href={href} className="text-primary underline">
      {children}
    </a>
  ),
};

export interface PlanGateProps {
  entry: ChatPermissionEntry;
  reply: ReplyFn;
  /**
   * Notifies the caller that Approve was clicked, BEFORE `reply()` optimistically
   * drops this entry from the permission queue — lets `ChatGateMount` retain the
   * entry and keep the running footer mounted across that drop (see its own doc
   * comment). No-op if omitted (e.g. in isolated component tests).
   */
  onApprove?: () => void;
}

// ---------------------------------------------------------------------------
// Plan body — scrollable pre-formatted plan text
// ---------------------------------------------------------------------------

function PlanBody({ plan }: { plan: string }) {
  return (
    <div className="px-3.5 pb-3">
      <div className="max-h-[300px] overflow-auto rounded-md bg-card px-3 py-2.5 text-body text-foreground">
        <Markdown remarkPlugins={[remarkGfm]} components={PLAN_MD_COMPONENTS}>
          {plan}
        </Markdown>
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
  execMode: ExecutionMode;
  setExecMode: (m: ExecutionMode) => void;
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
    <div className="flex items-center gap-2 px-3.5 pb-3">
      <GateButton kind="primary" data-testid="chat-plan-approve" onClick={onApprove} className="flex-1">
        Approve &amp; run
      </GateButton>
      <GateButton kind="ghost" data-testid="chat-plan-keep-planning" onClick={onKeepPlanning}>
        Keep planning
      </GateButton>
      <GateButton kind="ghost" data-testid="chat-plan-reject" onClick={onReject}>
        Reject
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
  onCancel,
}: {
  feedback: string;
  setFeedback: (v: string) => void;
  onSend: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="flex animate-in fade-in-0 slide-in-from-top-1 duration-150 flex-col gap-2 px-3.5 pb-3">
      <Textarea
        data-testid="chat-plan-feedback-input"
        rows={3}
        placeholder="What should be changed..."
        value={feedback}
        onChange={(e) => setFeedback(e.target.value)}
        className="resize-none"
      />
      <div className="flex items-center justify-end gap-2">
        <GateButton kind="ghost" data-testid="chat-plan-revise-cancel" onClick={onCancel}>
          Cancel
        </GateButton>
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

export function PlanGate({ entry, reply, onApprove }: PlanGateProps) {
  const [execMode, setExecMode] = useState<ExecutionMode>('default');
  const [clearContext, setClearContext] = useState(false);
  const [revising, setRevising] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [approved, setApproved] = useState(false);

  const plan = (entry.request.input.plan as string | undefined) ?? '';

  const handleApprove = () => {
    setApproved(true);
    onApprove?.();
    void reply(buildPlanResponse(entry, { kind: 'approve', executionMode: execMode, clearContext }));
  };

  const handleSendFeedback = () => {
    if (!feedback.trim()) return;
    void reply(buildPlanResponse(entry, { kind: 'revise', feedback }));
  };

  const handleReject = () => {
    void reply(buildPlanResponse(entry, { kind: 'reject' }));
  };

  const EXEC_MODE_LABELS: Record<ExecutionMode, string> = {
    default: 'Interactive',
    acceptEdits: 'Auto-edits',
    yolo: 'Unattended',
  };

  return (
    <div data-testid="chat-plan-gate">
      <GateCardShell>
        <GateHead
          icon={<SquareCheckIcon className="size-[15px]" />}
          tileClassName="bg-mf-selection text-primary"
          eyebrow="Plan"
          title="Ready to implement"
        />
        {plan && <PlanBody plan={plan} />}
        {!approved && (
          <ControlsPanel
            execMode={execMode}
            setExecMode={setExecMode}
            clearContext={clearContext}
            setClearContext={setClearContext}
          />
        )}
        {approved ? (
          <div
            data-testid="chat-plan-running-footer"
            className="flex items-center gap-2 border-t border-border px-3.5 py-2.5"
          >
            <span
              className={`inline-block h-1.5 w-1.5 shrink-0 animate-pulse rounded-full ${execMode === 'yolo' ? 'bg-destructive' : 'bg-primary'}`}
            />
            <span className="text-body text-muted-foreground">
              Executing in{' '}
              <b className={execMode === 'yolo' ? 'font-semibold text-destructive' : 'font-semibold text-foreground'}>
                {EXEC_MODE_LABELS[execMode]}
              </b>{' '}
              mode{clearContext ? ' · context cleared' : ''} — starting step 1.
            </span>
          </div>
        ) : revising ? (
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
