import React, { useState, useCallback, useEffect } from 'react';
import { ClipboardList, ShieldOff, FileEdit, Shield, ChevronDown } from 'lucide-react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { PermissionRequest } from '@mainframe/types';
import { Button } from '../ui/button';
import { useChatsStore } from '../../store/chats';
import { useMainframeRuntime } from './assistant-ui/MainframeRuntimeProvider';
import { useSettingsStore } from '../../store/settings';

interface PlanApprovalCardProps {
  request: PermissionRequest;
  onRespond: (
    behavior: 'allow' | 'deny',
    alwaysAllow?: string[],
    overrideInput?: Record<string, unknown>,
    message?: string,
    executionMode?: string,
    clearContext?: boolean,
  ) => void;
}

interface AllowedPrompt {
  tool: string;
  prompt: string;
}

type ExecutionMode = 'default' | 'acceptEdits' | 'yolo';

const EXEC_MODES: { id: ExecutionMode; label: string; icon: React.ElementType }[] = [
  { id: 'default', label: 'Interactive', icon: Shield },
  { id: 'acceptEdits', label: 'Auto-Edits', icon: FileEdit },
  { id: 'yolo', label: 'Unattended', icon: ShieldOff },
];

export function PlanApprovalCard({ request, onRespond }: PlanApprovalCardProps): React.ReactElement {
  const [revising, setRevising] = useState(false);
  const [feedback, setFeedback] = useState('');

  const { chatId } = useMainframeRuntime();
  const chat = useChatsStore((s) => s.chats.find((c) => c.id === chatId));
  const providerConfig = useSettingsStore((s) => s.providers[chat?.adapterId ?? '']);
  const settingsDefault: ExecutionMode = providerConfig?.planExecutionMode ?? 'default';

  const [execMode, setExecMode] = useState<ExecutionMode>(settingsDefault);
  const [execModeTouched, setExecModeTouched] = useState(false);
  const [clearContext, setClearContext] = useState(false);

  useEffect(() => {
    setExecModeTouched(false);
  }, [request.requestId]);

  useEffect(() => {
    if (!execModeTouched) {
      setExecMode(settingsDefault);
    }
  }, [settingsDefault, execModeTouched]);

  const plan = request.input.plan as string | undefined;
  const allowedPrompts = request.input.allowedPrompts as AllowedPrompt[] | undefined;

  const handleSendFeedback = useCallback(() => {
    if (!feedback.trim()) return;
    onRespond('deny', undefined, undefined, feedback.trim());
  }, [feedback, onRespond]);

  return (
    <div className="border border-mf-accent/30 bg-mf-app-bg rounded-mf-card overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2.5 bg-mf-accent/10">
        <ClipboardList size={16} className="text-mf-accent" />
        <span className="text-mf-body font-semibold text-mf-text-primary">Plan Ready for Review</span>
      </div>

      <div className="px-4 py-3 space-y-3">
        {/* Plan preview */}
        {plan && (
          <div className="max-h-[300px] overflow-y-auto rounded-mf-input bg-mf-input-bg p-3">
            <div className="aui-md text-mf-chat text-mf-text-primary">
              <Markdown remarkPlugins={[remarkGfm]}>{plan}</Markdown>
            </div>
          </div>
        )}

        {/* Allowed prompts */}
        {allowedPrompts && allowedPrompts.length > 0 && (
          <div className="space-y-1.5">
            <span className="text-mf-body text-mf-text-secondary">Requested permissions:</span>
            <ul className="space-y-1 pl-1">
              {allowedPrompts.map((ap, i) => (
                <li key={i} className="text-mf-body text-mf-text-secondary">
                  &bull; {ap.prompt}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Revise textarea */}
        {revising && (
          <textarea
            autoFocus
            rows={3}
            placeholder="What should be changed..."
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && feedback.trim()) {
                handleSendFeedback();
              }
            }}
            className="w-full bg-transparent rounded-mf-input px-3 py-2 text-mf-body text-mf-text-primary border border-mf-border placeholder:text-mf-text-secondary focus:outline-none focus:border-mf-accent/50 resize-none"
          />
        )}

        {/* Execution mode picker + actions */}
        <div className="flex items-center justify-between gap-2">
          {revising ? (
            <>
              <div />
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setRevising(false);
                    setFeedback('');
                  }}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  className="bg-mf-accent text-white hover:bg-mf-accent/90"
                  disabled={!feedback.trim()}
                  onClick={handleSendFeedback}
                >
                  Send Feedback
                </Button>
              </div>
            </>
          ) : (
            <>
              {/* Clear context + execution mode selector */}
              <div className="flex items-center gap-1">
                <label className="flex items-center gap-1.5 text-mf-status text-mf-text-secondary cursor-pointer mr-2">
                  <input
                    type="checkbox"
                    checked={clearContext}
                    onChange={(e) => setClearContext(e.target.checked)}
                    className="accent-mf-accent"
                  />
                  Clear context
                </label>
                <div className="relative">
                  <select
                    value={execMode}
                    onChange={(e) => {
                      setExecModeTouched(true);
                      setExecMode(e.target.value as ExecutionMode);
                    }}
                    className={`appearance-none pl-6 pr-7 py-1 rounded-mf-input text-mf-status bg-transparent border cursor-pointer focus:outline-none ${
                      execMode === 'yolo'
                        ? 'border-mf-destructive/40 text-mf-destructive'
                        : 'border-mf-accent/30 text-mf-text-primary'
                    }`}
                  >
                    {EXEC_MODES.map((mode) => (
                      <option key={mode.id} value={mode.id}>
                        {mode.label}
                      </option>
                    ))}
                  </select>
                  {(() => {
                    const Icon = EXEC_MODES.find((m) => m.id === execMode)!.icon;
                    return (
                      <Icon
                        size={12}
                        className={`absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none ${execMode === 'yolo' ? 'text-mf-destructive' : 'text-mf-accent'}`}
                      />
                    );
                  })()}
                  <ChevronDown
                    size={12}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none text-mf-text-secondary"
                  />
                </div>
              </div>

              {/* Action buttons */}
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={() => onRespond('deny')}>
                  Reject
                </Button>
                <Button variant="outline" size="sm" onClick={() => setRevising(true)}>
                  Revise
                </Button>
                <Button
                  size="sm"
                  className="bg-mf-accent text-white hover:bg-mf-accent/90"
                  onClick={() =>
                    onRespond('allow', undefined, undefined, undefined, execMode, clearContext || undefined)
                  }
                >
                  Approve Plan
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
