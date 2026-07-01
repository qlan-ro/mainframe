/**
 * WfAnswerForm — renders a pending workflow interaction form.
 *
 * Props:
 *   port          — daemon port (passed to wfApi)
 *   interaction   — the WorkflowInteractionSummary to answer
 *   onDone?       — called after a successful submit or on already-answered
 *
 * Behaviour:
 * - Fields with a `when: {key, equals}` guard are only rendered when the
 *   referenced key's current value matches `equals`.
 * - Required fields with no value gate the submit button (disabled).
 * - On success, replaces the form with a confirmation message.
 * - If the API rejects with a message containing "already", shows a
 *   different already-answered message.
 */
import React, { useState } from 'react';
import { CornerDownLeft, CheckCircle, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { respondInteraction } from '@/lib/api/workflows';
import type { WorkflowInteractionSummary } from '@qlan-ro/mainframe-types';
import { WfField } from './WfField';

// ── Types ─────────────────────────────────────────────────────────────────────

interface WfAnswerFormProps {
  port: number;
  interaction: WorkflowInteractionSummary;
  onDone?: () => void;
}

type SubmitState = 'idle' | 'submitting' | 'done' | 'already-answered';

// ── Helpers ───────────────────────────────────────────────────────────────────

function isAlreadyError(err: unknown): boolean {
  return err instanceof Error && err.message.toLowerCase().includes('already');
}

// ── WfAnswerForm ──────────────────────────────────────────────────────────────

export function WfAnswerForm({ port, interaction, onDone }: WfAnswerFormProps): React.ReactElement {
  const [vals, setVals] = useState<Record<string, unknown>>({});
  const [state, setState] = useState<SubmitState>('idle');

  function set(key: string, value: unknown): void {
    setVals((prev) => ({ ...prev, [key]: value }));
  }

  // Fields whose `when` guard is not satisfied are hidden.
  // Guard against missing formSchema (e.g. store seeds used in tests).
  const schema = interaction.formSchema ?? [];
  const visible = schema.filter((f) => !f.when || vals[f.when.key] === f.when.equals);

  // Collect only visible-field keys into the response payload.
  const payload = Object.fromEntries(visible.map((f) => [f.key, vals[f.key]]).filter(([, v]) => v !== undefined));

  // Submit is disabled when any visible required field is empty.
  const missing = visible.some((f) => {
    if (!f.required) return false;
    const v = vals[f.key];
    if (v === undefined || v === null || v === '') return true;
    if (Array.isArray(v) && v.length === 0) return true;
    return false;
  });

  async function handleSubmit(): Promise<void> {
    setState('submitting');
    try {
      await respondInteraction(port, interaction.id, payload);
      setState('done');
      onDone?.();
    } catch (err) {
      if (isAlreadyError(err)) {
        setState('already-answered');
        onDone?.();
      } else {
        // Unexpected error — return to idle so the user can retry.
        console.warn('[WfAnswerForm] respondInteraction failed', err);
        setState('idle');
      }
    }
  }

  // ── Done state ─────────────────────────────────────────────────────────────

  if (state === 'done') {
    return (
      <div
        className={cn(
          'flex items-center gap-2.5 px-3.5 py-3 rounded-md',
          'bg-mf-success/10 ring-1 ring-inset ring-mf-success/25',
        )}
      >
        <CheckCircle size={16} className="text-mf-success shrink-0" aria-hidden />
        <span className="text-label font-semibold text-foreground">Answer submitted — the run will continue.</span>
      </div>
    );
  }

  // ── Already-answered state ─────────────────────────────────────────────────

  if (state === 'already-answered') {
    return (
      <div className={cn('flex items-center gap-2.5 px-3.5 py-3 rounded-md', 'bg-muted ring-1 ring-inset ring-border')}>
        <AlertCircle size={16} className="text-muted-foreground shrink-0" aria-hidden />
        <span className="text-label font-semibold text-foreground">Already answered on another device.</span>
      </div>
    );
  }

  // ── Form state ─────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-3">
      {visible.map((f) => (
        <div key={f.key} className="flex flex-col gap-1.5">
          <label className="text-label font-semibold text-foreground">
            {f.label ?? f.key}
            {f.required && <span className="text-destructive"> *</span>}
          </label>
          <WfField field={f} value={vals[f.key]} onChange={set} />
        </div>
      ))}

      <div className="flex items-center gap-2.5 mt-0.5">
        <button
          type="button"
          data-testid="workflows-answer-submit"
          disabled={missing || state === 'submitting'}
          onClick={() => void handleSubmit()}
          className={cn(
            'inline-flex items-center gap-1.5 h-[34px] px-4 rounded-md',
            'text-label font-semibold text-white bg-primary',
            'transition-opacity',
            (missing || state === 'submitting') && 'opacity-45 cursor-default',
          )}
        >
          <CornerDownLeft size={13} aria-hidden />
          Submit answer
        </button>
        <span className="text-micro text-muted-foreground">First answer wins · also answerable on mobile</span>
      </div>
    </div>
  );
}
