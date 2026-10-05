/**
 * AutomationEditor — shell: name, project picker, WhenCard, Recipe, footer
 * summary, Save (ts153 wf2-editor.jsx `WfEditor`). Self-sufficient: reads the
 * nav/store directly; `AutomationsView` only decides WHETHER to mount it.
 *
 * Project scoping (2026-10 redesign): the editor has its own picker now
 * (`AutomationProjectPicker`) — a row of avatar chips, "All projects"
 * included, replacing the old ambient `store.scopeProjectId` gating (saving
 * used to be blocked outright while the library header's scope was "All
 * projects"). A global (unscoped) automation is allowed UNLESS its tree
 * contains an `ask_agent` step (`stepsNeedProject`) — that step's worktree
 * has nowhere else to go, so it is the one case that still needs a project.
 * `projectId` is also mirrored into `store.scopeProjectId` for as long as
 * this editor is open (restored to the ambient scope on close) — the
 * project-scoped field pickers (skills/files/branches) read that store field,
 * and the editor's own choice should win over the ambient one while it's
 * open. `definitionToSave` still runs every `ask_agent` step through
 * `stampAgentProjectId` (bullet 4) so the step's own `projectId` — which the
 * daemon engine actually reads at run time — matches the automation's
 * resolved project, rather than falling back to an arbitrary "first project
 * in the DB". It is skipped for a global automation (no project to stamp
 * with), which is fine because `stepsNeedProject` already blocked Save.
 */
import { Button } from '@/components/ui/button';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Check, ChevronLeft, TriangleAlert, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Hint } from '@/components/ui/hint';
import { mfToast } from '@/lib/toast';
import { useProjects } from '@/features/sessions/use-projects';
import { soleProjectId, useSessionFilters } from '@/store/session-filters';
import type { AutomationCreateInput } from '../contract';
import { useAutomationsNav } from '../data/use-automations-nav';
import { selectAutomationById, useAutomationsStore } from '../data/use-automations-store';
import { builtinTokens, triggerTokens } from '../domain/tokens';
import { validate, type ValidationIssue } from '../domain/validate';
import { applyStepsEdit } from './definition-actions';
import { draftFrom, definitionToSave, EMPTY_DRAFT, type DraftState } from './draft';
import { AutomationProjectPicker, resolveDefaultProjectId } from './AutomationProjectPicker';
import { Recipe } from './Recipe';
import { saveIssuesFrom } from './save-issues';
import { stepsNeedProject } from './stamp-agent-project-id';
import { WhenCard } from './WhenCard';

function errorMessage(err: unknown): string | undefined {
  return err instanceof Error ? err.message : undefined;
}

function EditorSection({
  index,
  label,
  hint,
  children,
}: {
  index: number;
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="mb-[22px]">
      <div className="mb-2.5 flex items-baseline gap-2.5">
        <span className="flex h-[22px] min-w-[22px] items-center justify-center rounded-full bg-foreground text-xs font-bold text-background">
          {index}
        </span>
        <span className="text-base font-semibold tracking-tight text-foreground">{label}</span>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </div>
      <div className="pl-[32px]">{children}</div>
    </div>
  );
}

export function AutomationEditor() {
  const editorTarget = useAutomationsNav((s) => s.editorTarget);
  const closeEditor = useAutomationsNav((s) => s.closeEditor);
  const catalog = useAutomationsStore((s) => s.catalog);
  const gateway = useAutomationsStore((s) => s.gateway);
  const patchDefinition = useAutomationsStore((s) => s.patchDefinition);
  const setScopeProjectId = useAutomationsStore((s) => s.setScopeProjectId);

  const { projects } = useProjects();
  const sessionScope = useSessionFilters((s) => s.filterProjectIds);
  const scopedProjects = sessionScope.size > 0 ? projects.filter((p) => sessionScope.has(p.id)) : projects;
  const ambientProjectId = soleProjectId(sessionScope);
  const ambientProjectIdRef = useRef(ambientProjectId);
  ambientProjectIdRef.current = ambientProjectId;

  const existing = useAutomationsStore(
    selectAutomationById(editorTarget?.mode === 'edit' ? editorTarget.automationId : null),
  );
  const isNew = editorTarget?.mode !== 'edit';
  const editKey = editorTarget?.mode === 'edit' ? editorTarget.automationId : null;
  const newDraft = editorTarget?.mode === 'new' ? editorTarget.draft : undefined;

  const [draft, setDraft] = useState<DraftState>(() =>
    existing ? draftFrom(existing, catalog) : newDraft ? draftFrom(newDraft, catalog) : EMPTY_DRAFT,
  );
  const [projectId, setProjectId] = useState<string | null>(() =>
    existing ? existing.projectId : resolveDefaultProjectId(scopedProjects, ambientProjectId),
  );
  const [saving, setSaving] = useState(false);
  const [saveIssues, setSaveIssues] = useState<ValidationIssue[]>([]);

  /** Any edit retires the daemon's verdict — it judged a draft that no longer exists. */
  function updateDraft(patch: (d: DraftState) => DraftState) {
    setSaveIssues([]);
    setDraft(patch);
  }

  // Re-seed only when the target identity changes (`editKey`), not on every
  // store tick — mirrors the initializer above so the mount-time run is a
  // harmless no-op re-render with the same values; real re-seeds happen when
  // `editorTarget` switches between two `edit` targets (or `edit` ↔ `new`)
  // without this component unmounting in between.
  useEffect(() => {
    setSaveIssues([]);
    setDraft(existing ? draftFrom(existing, catalog) : newDraft ? draftFrom(newDraft, catalog) : EMPTY_DRAFT);
    setProjectId(existing ? existing.projectId : resolveDefaultProjectId(scopedProjects, ambientProjectId));
  }, [editKey]);

  // The project-scoped field pickers (skills/files/branches) read
  // `store.scopeProjectId` — this editor's own choice wins over the ambient
  // session scope for as long as it's open, and the ambient value comes back
  // once it closes (not necessarily the one captured at mount: the ref tracks
  // the latest).
  useEffect(() => {
    setScopeProjectId(projectId);
  }, [projectId, setScopeProjectId]);
  useEffect(() => {
    return () => setScopeProjectId(ambientProjectIdRef.current);
  }, []);

  const needsProject = projectId == null && stepsNeedProject(draft.definition.steps);

  const issues = useMemo(() => {
    const base = validate(draft.name, draft.definition, catalog);
    const withProject = needsProject
      ? [
          {
            stepId: null,
            level: 'error' as const,
            msg: 'An agent step needs a project — pick one above, or remove the step.',
          },
          ...base,
        ]
      : base;
    return [...withProject, ...saveIssues];
  }, [draft.name, draft.definition, catalog, needsProject, saveIssues]);
  const errors = issues.filter((i) => i.level === 'error');
  const ok = errors.length === 0;

  const scopeTokens = useMemo(
    () => builtinTokens().concat(triggerTokens(draft.definition.triggers)),
    [draft.definition.triggers],
  );

  async function handleSave() {
    if (!ok || saving) return;
    setSaving(true);
    try {
      const input: AutomationCreateInput = {
        name: draft.name,
        description: draft.description || undefined,
        scope: projectId ? 'project' : 'global',
        projectId,
        definition: definitionToSave(draft.definition, catalog, projectId),
      };
      const result =
        editorTarget?.mode === 'edit'
          ? await gateway.updateAutomation(editorTarget.automationId, input)
          : await gateway.createAutomation(input);
      patchDefinition(result);
      closeEditor();
    } catch (err) {
      setSaveIssues(saveIssuesFrom(err));
      mfToast.error('Could not save the automation', { description: errorMessage(err) });
    } finally {
      setSaving(false);
    }
  }

  if (!editorTarget) return null;

  return (
    <div data-testid="automations-editor" className="flex h-full min-h-0 flex-col">
      <div className="flex h-[52px] shrink-0 items-center gap-[12px] border-b border-border px-3.5">
        <Hint label="Back">
          <button
            type="button"
            data-testid="automations-editor-back"
            onClick={closeEditor}
            className="flex size-[30px] items-center justify-center rounded-md text-muted-foreground hover:bg-accent"
          >
            <ChevronLeft size={15} aria-hidden />
          </button>
        </Hint>
        <Zap size={15} className="text-primary" aria-hidden />
        <span className="text-base font-semibold tracking-tight text-foreground">
          {isNew ? 'New automation' : draft.name || 'Automation'}
        </span>
        <span className="flex-1" />
        <Button size="sm" variant="outline" data-testid="automations-editor-cancel" onClick={closeEditor}>
          Cancel
        </Button>
        <Button
          size="sm"
          data-testid="automations-editor-save"
          disabled={!ok || saving}
          onClick={() => void handleSave()}
        >
          <Check aria-hidden />
          {isNew ? 'Create' : 'Save'}
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[620px] px-[24px] pt-[22px] pb-[32px]">
          <div className="mb-[24px] flex flex-col gap-[8px]">
            <input
              data-testid="automations-editor-name"
              value={draft.name}
              onChange={(e) => updateDraft((d) => ({ ...d, name: e.target.value }))}
              placeholder="Name this automation"
              className="border-none bg-transparent p-0 text-lg font-semibold tracking-tight text-foreground outline-none placeholder:text-muted-foreground"
            />
            <input
              data-testid="automations-editor-description"
              value={draft.description}
              onChange={(e) => updateDraft((d) => ({ ...d, description: e.target.value }))}
              placeholder="What does it do? (optional)"
              className="border-none bg-transparent p-0 text-sm text-muted-foreground outline-none placeholder:text-muted-foreground"
            />
          </div>

          <div className="mb-[24px]">
            <AutomationProjectPicker projects={scopedProjects} value={projectId} onChange={setProjectId} />
          </div>

          <EditorSection
            index={1}
            label="When"
            hint={draft.definition.triggers.length === 0 ? 'What kicks it off' : undefined}
          >
            <WhenCard
              triggers={draft.definition.triggers}
              onChange={(triggers) => updateDraft((d) => ({ ...d, definition: { ...d.definition, triggers } }))}
              automationId={existing?.id}
            />
          </EditorSection>

          <EditorSection index={2} label="Do" hint="Step by step, top to bottom">
            <Recipe
              steps={draft.definition.steps}
              onChange={(steps) =>
                updateDraft((d) => ({ ...d, definition: applyStepsEdit(d.definition, steps, catalog) }))
              }
              tokens={scopeTokens}
              catalog={catalog}
              issues={issues}
              testId="automations-recipe-root"
            />
          </EditorSection>
        </div>
      </div>

      <div className="flex min-h-[40px] shrink-0 items-center gap-2.5 border-t border-border bg-muted/40 px-4 py-2">
        {ok ? (
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-foreground">
            <span className="flex size-[16px] items-center justify-center rounded-full bg-success">
              <Check size={12} className="text-primary-foreground" aria-hidden />
            </span>
            {`Looks good · ready to ${isNew ? 'create' : 'save'}`}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-foreground">
            <TriangleAlert size={13} className="text-destructive" aria-hidden />
            {errors.length} to fix
          </span>
        )}
        <div className="h-4 w-px bg-border" />
        <div data-testid="automations-editor-issues" className="flex flex-1 items-center gap-3.5 overflow-x-auto">
          {issues.length === 0 ? (
            <span className="text-xs text-muted-foreground">Every step’s inputs are available when it runs.</span>
          ) : (
            issues.map((issue, i) => (
              <span key={i} className="inline-flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                <span
                  className={cn('size-1.5 rounded-full', issue.level === 'error' ? 'bg-destructive' : 'bg-warning')}
                />
                {issue.msg}
              </span>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
