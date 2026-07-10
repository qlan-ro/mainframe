/**
 * WorkflowEditor — header + builder/YAML panes + validation footer + save.
 *
 * The builder is the single source of truth for both new and edit targets
 * (Task 21 — the mode toggle and the "new workflows only" split are gone).
 * Every builder mutation calls serializeWorkflow(model) to keep the
 * read-only YAML pane live. Edit mode hydrates via useWorkflowHydration
 * (Task 20); a malformed/comment-bearing file renders HydrationBanner
 * instead of the panes.
 *
 * Validation is debounced ~400ms via server. Validate/save error messages
 * are mapped to the step rows they describe (wf-validate-map.ts); anything
 * that maps to neither a zod index path nor a `step '<id>'` substring
 * surfaces as a toast instead. For new workflows, the id is derived from
 * the `name:` line in the YAML.
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import { Zap, Check, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import * as wfApi from '@/lib/api/workflows';
import { mfToast } from '@/lib/toast';
import { useActiveIdentity } from '@/features/sessions/use-active-identity';
import { useWorkflowsModal, type WfEditorTarget } from '../use-workflows-modal';
import { useWorkflowsStore } from '../use-workflows-store';
import { WfYamlPane } from './WfYamlPane';
import { WfBuilderPane } from './WfBuilderPane';
import { HydrationBanner } from './HydrationBanner';
import { useWorkflowHydration } from './use-workflow-hydration';
import { serializeWorkflow } from './yaml-serialize';
import { blankDraft } from './wf-stubs';
import type { WfDraft } from './wf-draft-types';
import { slug, deriveWorkflowId } from './wf-slug';
import { mapValidationErrorsToSteps, splitJoinedErrorMessage } from './wf-validate-map';
import { ValidationFooter, type ValidationResult } from './WfEditorChrome';

// ── Types ─────────────────────────────────────────────────────────────────────

interface WorkflowEditorProps {
  port: number;
  target: WfEditorTarget;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const DEBOUNCE_MS = 400;

// ── Main component ────────────────────────────────────────────────────────────

export function WorkflowEditor({ port, target }: WorkflowEditorProps): React.ReactElement {
  const isNew = target.mode === 'new';

  const [model, setModel] = useState<WfDraft>(blankDraft);
  // New drafts start from the builder's blank model, serialized up front —
  // otherwise the YAML pane renders empty until the user makes a builder
  // edit, which leaves "New workflow" unsavable (no valid YAML). Edit mode
  // has no model yet (server YAML hydrates async — see
  // use-workflow-hydration.ts), so it starts blank.
  const [yaml, setYaml] = useState(() => (isNew ? serializeWorkflow(blankDraft()) : ''));
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [stepErrors, setStepErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { closeEditor } = useWorkflowsModal();
  const loadAll = useWorkflowsStore((s) => s.loadAll);
  // "This project" scope has no project picker in the builder — it resolves
  // to the active session's project (see deriveWorkflowId in wf-slug.ts).
  const { projectId: activeProjectId } = useActiveIdentity();

  const filename = `${slug(model.name) || 'workflow'}.yaml`;

  // Debounced validation. `draftForErrors` is the model this validation run
  // was scheduled against — passed explicitly rather than read from state,
  // since state could have moved on by the time the debounce fires.
  const scheduleValidation = useCallback(
    (value: string, draftForErrors: WfDraft) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        void wfApi
          .validateYaml(port, value)
          .then((result) => {
            setValidation(result);
            setValidationError(null);
            setStepErrors(
              mapValidationErrorsToSteps(
                result.errors.map((e) => e.message),
                draftForErrors,
              ).stepErrors,
            );
          })
          .catch((err: unknown) => {
            // The request itself failed (network error, or the daemon rejected
            // it outright — e.g. a 400 for a malformed document). Surface it
            // instead of leaving `validation` null forever (stuck "Validating…").
            const message = err instanceof Error ? err.message : String(err);
            console.warn('[WorkflowEditor] validateYaml error:', err);
            setValidation(null);
            setValidationError(message);
            setStepErrors(mapValidationErrorsToSteps(splitJoinedErrorMessage(message), draftForErrors).stepErrors);
          });
      }, DEBOUNCE_MS);
    },
    [port],
  );

  // New drafts: validate the initial serialized blank draft immediately, so
  // "Create" isn't stuck disabled ("Validating…" forever) until the user
  // edits the builder. Edit mode hydrates (and validates) asynchronously via
  // useWorkflowHydration below and doesn't need this.
  // Mount-only: run once against the initializer's value. Every later edit
  // already reschedules validation via handleModelChange, so this
  // intentionally does not depend on `yaml`/`model`/`scheduleValidation`.
  useEffect(() => {
    if (isNew) scheduleValidation(yaml, model);
  }, []);

  /** Builder mutation (and hydration): re-serialize the model to YAML and validate. */
  const handleModelChange = useCallback(
    (nextModel: WfDraft) => {
      setModel(nextModel);
      const nextYaml = serializeWorkflow(nextModel);
      setYaml(nextYaml);
      setValidation(null);
      setValidationError(null);
      scheduleValidation(nextYaml, nextModel);
    },
    [scheduleValidation],
  );

  // Edit mode: load the daemon's YAML and hydrate it into the draft model
  // (Task 20). A malformed/comment-bearing file renders a banner instead —
  // see HydrationBanner and use-workflow-hydration.ts.
  const { banner } = useWorkflowHydration(port, target, handleModelChange);

  const handleSave = useCallback(async () => {
    if (!validation?.valid || saving) return;
    const id = target.mode === 'edit' ? target.workflowId : deriveWorkflowId(yaml, model.scope, activeProjectId);
    setSaving(true);
    try {
      await wfApi.putWorkflow(port, id, yaml);
      closeEditor();
      void loadAll(port);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn('[WorkflowEditor] save failed:', err);
      const { stepErrors: mapped, unmapped } = mapValidationErrorsToSteps(splitJoinedErrorMessage(message), model);
      if (Object.keys(mapped).length > 0) setStepErrors((prev) => ({ ...prev, ...mapped }));
      mfToast.error('Workflow save failed', { description: unmapped.length > 0 ? unmapped.join('\n') : message });
    } finally {
      setSaving(false);
    }
  }, [validation, saving, target, yaml, model, activeProjectId, port, closeEditor, loadAll]);

  return (
    <div data-testid="workflows-editor" className="flex h-full min-h-0 flex-col bg-mf-window font-sans">
      {/* header */}
      <div className="flex h-[52px] flex-shrink-0 items-center gap-3 border-b border-border bg-card px-3.5">
        <button
          type="button"
          data-testid="workflows-editor-close"
          onClick={closeEditor}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent"
        >
          <X size={15} aria-hidden />
        </button>
        <Zap size={15} className="text-primary" aria-hidden />
        <span className="text-heading font-bold tracking-tight text-foreground">
          {isNew ? 'New workflow' : 'Edit workflow'}
        </span>
        <span className="flex-1" />
        <button
          type="button"
          data-testid="workflows-editor-cancel"
          onClick={closeEditor}
          className="inline-flex h-[30px] items-center rounded-md border border-border px-[13px] text-label font-medium text-muted-foreground hover:bg-accent"
        >
          Cancel
        </button>
        <button
          type="button"
          data-testid="workflows-editor-save"
          disabled={!validation?.valid || saving}
          onClick={() => {
            void handleSave();
          }}
          className={cn(
            'inline-flex h-[30px] items-center gap-1.5 rounded-md px-[14px] text-label font-semibold text-white',
            validation?.valid && !saving ? 'cursor-pointer bg-primary' : 'cursor-default bg-primary opacity-45',
          )}
        >
          <Check size={12} aria-hidden />
          {isNew ? 'Create' : 'Save'}
        </button>
      </div>

      {/* panes */}
      <div className="flex min-h-0 flex-1">
        {banner ? (
          <HydrationBanner reason={banner.reason} rawYaml={banner.rawYaml} onConvert={banner.onConvert} />
        ) : (
          <>
            <div className="min-w-0 flex-1 border-r border-border">
              <WfBuilderPane model={model} onChange={handleModelChange} errors={stepErrors} />
            </div>
            <div className="min-w-0 flex-1">
              <WfYamlPane yaml={yaml} validation={validation} validationError={validationError} filename={filename} />
            </div>
          </>
        )}
      </div>

      {/* validation footer */}
      <ValidationFooter validation={validation} validationError={validationError} isNew={isNew} />
    </div>
  );
}
