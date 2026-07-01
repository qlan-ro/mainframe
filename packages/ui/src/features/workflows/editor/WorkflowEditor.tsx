/**
 * WorkflowEditor — header + mode toggle + YAML pane + validation footer + save.
 *
 * Builder and Split modes render WfBuilderPane (Task 15); any builder mutation
 * calls serializeWorkflow(model) → updates the YAML live.
 *
 * Scope note: builder is only available for NEW workflows (target.mode === 'new').
 * For edit mode, YAML→model reparse is reliable only server-side; we keep the
 * loaded YAML text as-is and default to yaml mode. The mode buttons still render
 * for visual consistency, but clicking Builder/Split in edit mode shows an
 * informational placeholder rather than clobbering the loaded YAML.
 *
 * Validation is debounced ~400ms via server. For new workflows, the id is derived
 * from the `name:` line in the YAML.
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import { Zap, SlidersHorizontal, Columns2, Code, Check, TriangleAlert, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import * as wfApi from '@/lib/api/workflows';
import { useWorkflowsModal, type WfEditorTarget } from '../use-workflows-modal';
import { useWorkflowsStore } from '../use-workflows-store';
import { WfYamlPane } from './WfYamlPane';
import { WfBuilderPane } from './WfBuilderPane';
import { serializeWorkflow, blankDraft } from './yaml-serialize';
import type { WfDraft } from './yaml-serialize';

// ── Types ─────────────────────────────────────────────────────────────────────

type EditorMode = 'builder' | 'split' | 'yaml';

interface ValidationResult {
  valid: boolean;
  errors: Array<{ message: string }>;
}

interface WorkflowEditorProps {
  port: number;
  target: WfEditorTarget;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Slugify a workflow name for use as the id segment. */
function slug(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'untitled'
  );
}

/** Derive an id from a new workflow's YAML by reading the `name:` line. */
function deriveIdFromYaml(yaml: string): string {
  const m = yaml.match(/^name:\s*(.+)$/m);
  const raw = m?.[1] ?? '';
  const name = raw.trim().replace(/^["']|["']$/g, '');
  return `global:${slug(name)}`;
}

const DEBOUNCE_MS = 400;

// ── Mode toggle bar ───────────────────────────────────────────────────────────

const MODES: Array<{ id: EditorMode; label: string; Icon: typeof SlidersHorizontal }> = [
  { id: 'builder', label: 'Builder', Icon: SlidersHorizontal },
  { id: 'split', label: 'Split', Icon: Columns2 },
  { id: 'yaml', label: 'YAML', Icon: Code },
];

function ModeToggle({ mode, setMode }: { mode: EditorMode; setMode: (m: EditorMode) => void }) {
  return (
    <div className="inline-flex gap-0.5 rounded-md bg-muted p-0.5">
      {MODES.map(({ id, label, Icon }) => {
        const on = mode === id;
        return (
          <button
            key={id}
            data-testid={`workflows-editor-mode-${id}`}
            type="button"
            onClick={() => setMode(id)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-sm px-2.5 py-1.5 text-label font-medium',
              on ? 'bg-card font-semibold text-foreground shadow-sm' : 'text-mf-text-3 hover:text-foreground',
            )}
          >
            <Icon size={12} className={on ? 'text-primary' : 'text-mf-text-3'} aria-hidden />
            {label}
          </button>
        );
      })}
    </div>
  );
}

// ── Validation footer ─────────────────────────────────────────────────────────

function ValidationFooter({ validation, isNew }: { validation: ValidationResult | null; isNew: boolean }) {
  if (!validation) {
    return (
      <div className="flex min-h-[40px] flex-shrink-0 items-center gap-2.5 border-t border-border bg-card px-4 py-2">
        <span className="text-caption text-muted-foreground">Validating…</span>
      </div>
    );
  }
  const { valid, errors } = validation;
  return (
    <div className="flex min-h-[40px] flex-shrink-0 items-center gap-2.5 border-t border-border bg-card px-4 py-2">
      {valid ? (
        <span className="inline-flex items-center gap-1.5 text-label font-semibold text-mf-success">
          <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-mf-success">
            <Check size={10} className="text-white" aria-hidden />
          </span>
          Valid · ready to {isNew ? 'create' : 'save'}
        </span>
      ) : (
        <span className="inline-flex items-center gap-1.5 text-label font-semibold text-destructive">
          <TriangleAlert size={14} aria-hidden />
          {errors.length} {errors.length === 1 ? 'issue' : 'issues'} to fix
        </span>
      )}
      {errors.length > 0 && (
        <>
          <div className="mx-1 h-4 w-px bg-border" />
          <div className="flex flex-1 items-center gap-3.5 overflow-x-auto">
            {errors.map((err, i) => (
              <span key={i} className="inline-flex flex-shrink-0 items-center gap-1.5 text-caption text-destructive">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-destructive" aria-hidden />
                {err.message}
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function WorkflowEditor({ port, target }: WorkflowEditorProps): React.ReactElement {
  const isNew = target.mode === 'new';

  const [model, setModel] = useState<WfDraft>(blankDraft);
  const [yaml, setYaml] = useState('');
  // Builder is only meaningful for new workflows; edit mode stays YAML-only.
  const [mode, setMode] = useState<EditorMode>(isNew ? 'yaml' : 'yaml');
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [saving, setSaving] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { closeEditor } = useWorkflowsModal();
  const loadAll = useWorkflowsStore((s) => s.loadAll);

  // Load YAML from server for edit mode
  useEffect(() => {
    if (target.mode !== 'edit') return;
    let cancelled = false;
    wfApi
      .getWorkflowSource(port, target.workflowId)
      .then((res) => {
        if (!cancelled) setYaml(res.yaml);
      })
      .catch((err: unknown) => {
        console.warn('[WorkflowEditor] failed to load source:', err);
      });
    return () => {
      cancelled = true;
    };
  }, [port, target]);

  // Debounced validation
  const scheduleValidation = useCallback(
    (value: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        void wfApi
          .validateYaml(port, value)
          .then((result) => {
            setValidation(result);
          })
          .catch((err: unknown) => {
            console.warn('[WorkflowEditor] validateYaml error:', err);
          });
      }, DEBOUNCE_MS);
    },
    [port],
  );

  const handleYamlChange = useCallback(
    (value: string) => {
      setYaml(value);
      setValidation(null); // reset until new validation arrives
      scheduleValidation(value);
    },
    [scheduleValidation],
  );

  /** Builder mutation: re-serialize the model to YAML and validate. */
  const handleModelChange = useCallback(
    (nextModel: WfDraft) => {
      setModel(nextModel);
      const nextYaml = serializeWorkflow(nextModel);
      setYaml(nextYaml);
      setValidation(null);
      scheduleValidation(nextYaml);
    },
    [scheduleValidation],
  );

  const handleSave = useCallback(async () => {
    if (!validation?.valid || saving) return;
    const id = target.mode === 'edit' ? target.workflowId : deriveIdFromYaml(yaml);
    setSaving(true);
    try {
      await wfApi.putWorkflow(port, id, yaml);
      closeEditor();
      void loadAll(port);
    } catch (err: unknown) {
      console.warn('[WorkflowEditor] save failed:', err);
    } finally {
      setSaving(false);
    }
  }, [validation, saving, target, yaml, port, closeEditor, loadAll]);

  return (
    <div data-testid="workflows-editor" className="flex h-full min-h-0 flex-col bg-mf-window font-sans">
      {/* header */}
      <div className="flex h-[52px] flex-shrink-0 items-center gap-3 border-b border-border bg-card px-3.5">
        <button
          type="button"
          data-testid="workflows-editor-cancel"
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
        <ModeToggle mode={mode} setMode={setMode} />
        <button
          type="button"
          data-testid="workflows-editor-save"
          disabled={!validation?.valid || saving}
          onClick={() => {
            void handleSave();
          }}
          className={cn(
            'inline-flex h-[30px] items-center gap-1.5 rounded-md px-3.5 text-label font-semibold text-white',
            validation?.valid && !saving ? 'cursor-pointer bg-primary' : 'cursor-default bg-primary opacity-45',
          )}
        >
          <Check size={12} aria-hidden />
          {isNew ? 'Create' : 'Save'}
        </button>
      </div>

      {/* panes */}
      <div className="flex min-h-0 flex-1">
        {(mode === 'builder' || mode === 'split') && (
          <div className={cn('min-w-0 flex-1', mode === 'split' ? 'border-r border-border' : '')}>
            {isNew ? (
              <WfBuilderPane model={model} onChange={handleModelChange} />
            ) : (
              // Edit mode: reliable YAML→model reparse is deferred to a future task.
              // The builder shows an informational message rather than clobbering the YAML.
              <div className="flex h-full items-center justify-center p-8 text-body text-muted-foreground">
                Visual builder is available for new workflows. Edit mode uses YAML only.
              </div>
            )}
          </div>
        )}
        {(mode === 'yaml' || mode === 'split') && (
          <div className="min-w-0 flex-1">
            <WfYamlPane yaml={yaml} onChange={handleYamlChange} validation={validation} />
          </div>
        )}
      </div>

      {/* validation footer */}
      <ValidationFooter validation={validation} isNew={isNew} />
    </div>
  );
}
