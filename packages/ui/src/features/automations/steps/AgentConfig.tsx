/**
 * AgentConfig — prompt ChipField (slash), model; More options: attachments,
 * worktree, auto-approve, timeout, permission, Expect results (A2),
 * FailureToggle (ts153 wf2-stepconfig.jsx `WfAgentConfig`, ported onto
 * `AskAgentStep`).
 *
 * One deliberate contract-driven deviation from ts153: **Timeout, not a
 * free-text budget cap.** ts153's "$4.00 or 20m" text field is replaced by
 * the real `timeoutMinutes: number` field.
 *
 * Attachments (image/file chips handed to the agent) were dropped in an
 * earlier pass as a deliberate contract-driven omission; the 2026-07-12
 * design-conformance pass reverses that call — see `AttachmentsField`'s doc
 * comment for the contract/schema widening this required.
 *
 * The model list is a curated placeholder (ts153's `WF2_MODELS`) — this
 * phase has no live adapter catalog fetch (that's `lib/model-tuning.ts`'s
 * `AdapterModel` machinery, wired to a real chat's adapter, not an
 * unstarted automation step); Phase 6 replaces it with a live fetch.
 */
import { X } from 'lucide-react';
import type { AskAgentStep } from '../contract';
import { EXECUTION_MODES } from '../contract';
import type { TokenDescriptor } from '../domain/tokens';
import { ChipField } from '../fields/ChipField';
import { MiniSelect } from '../fields/MiniSelect';
import { AttachmentsField } from './AttachmentsField';
import { ExpectResultsBuilder } from './ExpectResultsBuilder';
import { FailureToggle } from './FailureToggle';
import { FieldRow } from './FieldRow';
import { MoreOptions } from './MoreOptions';

const AGENT_MODELS = ['Claude Opus 4.6', 'Claude Sonnet 4.6', 'Codex GPT-5.2', 'Gemini 3 Pro'];
const AUTO_APPROVE_OPTIONS = ['edits', 'pnpm', 'git', 'shell'];

export interface AgentConfigProps {
  step: AskAgentStep;
  onChange: (next: AskAgentStep) => void;
  tokens: TokenDescriptor[];
  testId: string;
}

export function AgentConfig({ step, onChange, tokens, testId }: AgentConfigProps) {
  const worktree = step.worktree;

  function toggleApprove(entry: string) {
    const current = step.autoApprove ?? [];
    onChange({
      ...step,
      autoApprove: current.includes(entry) ? current.filter((a) => a !== entry) : [...current, entry],
    });
  }

  return (
    <div className="flex flex-col gap-2.5">
      <div>
        <span className="mb-1.5 block text-caption font-medium text-muted-foreground">Prompt</span>
        <ChipField
          value={step.prompt}
          onChange={(prompt) => onChange({ ...step, prompt })}
          tokens={tokens}
          placeholder="What should the agent do? Type / for a slash command, ⟨⟩ to insert a result…"
          multiline
          minHeight={62}
          slash
          testId={`${testId}-prompt`}
        />
      </div>

      <FieldRow label="Agent">
        <MiniSelect
          value={step.model ?? AGENT_MODELS[0]!}
          options={AGENT_MODELS}
          onChange={(model) => onChange({ ...step, model })}
          testId={`${testId}-model`}
          width={210}
        />
      </FieldRow>

      <MoreOptions testId={`${testId}-more`}>
        <FieldRow label="Attachments" top>
          <AttachmentsField
            value={step.attachments ?? []}
            onChange={(attachments) => onChange({ ...step, attachments })}
            testId={`${testId}-attachments`}
          />
        </FieldRow>

        <FieldRow label="Worktree" top>
          {worktree ? (
            <div className="flex flex-wrap items-center gap-2">
              <ChipField
                value={worktree.branchName}
                onChange={(branchName) => onChange({ ...step, worktree: { ...worktree, branchName } })}
                tokens={tokens}
                placeholder="branch name"
                testId={`${testId}-worktree-branch`}
              />
              <span className="text-caption text-muted-foreground">from</span>
              <input
                data-testid={`${testId}-worktree-base`}
                value={worktree.baseBranch ?? ''}
                onChange={(e) => onChange({ ...step, worktree: { ...worktree, baseBranch: e.target.value } })}
                placeholder="main"
                className="h-[28px] w-[110px] rounded-md border-[0.5px] border-input bg-card px-2 text-caption text-foreground outline-none placeholder:text-muted-foreground"
              />
              <button
                type="button"
                data-testid={`${testId}-worktree-remove`}
                onClick={() => onChange({ ...step, worktree: undefined })}
                aria-label="Remove worktree"
                className="flex size-[28px] shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted"
              >
                <X size={11} aria-hidden />
              </button>
            </div>
          ) : (
            <button
              type="button"
              data-testid={`${testId}-worktree-add`}
              onClick={() => onChange({ ...step, worktree: { baseBranch: 'main', branchName: [] } })}
              className="h-[28px] rounded-md border border-dashed border-mf-border-hover px-2.5 text-caption font-semibold text-primary hover:bg-accent"
            >
              + Run in a fresh worktree
            </button>
          )}
        </FieldRow>

        <FieldRow label="Auto-approve" top>
          <div className="flex flex-wrap gap-1.5">
            {AUTO_APPROVE_OPTIONS.map((entry) => {
              const on = (step.autoApprove ?? []).includes(entry);
              return (
                <button
                  key={entry}
                  type="button"
                  data-testid={`${testId}-approve-${entry}`}
                  onClick={() => toggleApprove(entry)}
                  className={
                    on
                      ? 'h-[24px] rounded-full border-[0.5px] border-primary/40 bg-primary/10 px-2.5 text-caption font-medium text-primary'
                      : 'h-[24px] rounded-full border-[0.5px] border-border bg-card px-2.5 text-caption font-medium text-muted-foreground hover:bg-accent'
                  }
                >
                  {entry}
                </button>
              );
            })}
          </div>
        </FieldRow>

        <FieldRow label="Timeout">
          <input
            data-testid={`${testId}-timeout`}
            type="number"
            min={0}
            value={step.timeoutMinutes ?? ''}
            onChange={(e) => {
              const raw = e.target.value;
              onChange({ ...step, timeoutMinutes: raw === '' ? undefined : Number(raw) });
            }}
            placeholder="minutes"
            className="h-[28px] w-[110px] rounded-md border-[0.5px] border-input bg-card px-2.5 text-caption text-foreground outline-none placeholder:text-muted-foreground"
          />
        </FieldRow>

        <FieldRow label="Permission">
          <MiniSelect
            value={step.permissionMode ?? EXECUTION_MODES[0]}
            options={[...EXECUTION_MODES]}
            onChange={(permissionMode) => onChange({ ...step, permissionMode })}
            testId={`${testId}-permission`}
            width={160}
          />
        </FieldRow>

        <div>
          <span className="mb-1.5 block text-caption font-medium text-muted-foreground">Expect results</span>
          <ExpectResultsBuilder
            expects={step.expects ?? []}
            onChange={(expects) => onChange({ ...step, expects })}
            testId={`${testId}-expects`}
          />
        </div>

        <FailureToggle
          keepGoing={!!step.keepGoing}
          onChange={(keepGoing) => onChange({ ...step, keepGoing })}
          testId={`${testId}-keepgoing`}
        />
      </MoreOptions>
    </div>
  );
}
