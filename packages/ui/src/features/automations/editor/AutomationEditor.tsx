/**
 * AutomationEditor — shell: name, WhenCard, Recipe, footer summary, Save
 * (ts153 wf2-editor.jsx `WfEditor`). Reads `use-automations-nav`'s
 * `editorTarget`/`use-automations-store`'s `definitions`/`catalog`/`gateway`
 * directly (mirrors `LibraryRow`'s self-sufficient pattern) rather than
 * taking props — `AutomationsView` only decides WHETHER to mount this, not
 * what to pass it.
 *
 * Project scoping (todo #234 bullet 1): there is no scope picker. Every
 * automation saves non-configurably to `store.activeProjectId` — the
 * session's current project, resolved once at `AutomationsHost`'s mount
 * boundary via `useActiveIdentity()` and mirrored into the store — exactly
 * like Todos (`TasksModalHost`'s `useActiveIdentity()`). Saving is blocked
 * until a project has resolved. `handleSave` also runs every `ask_agent`
 * step through `stampAgentProjectId` (bullet 4) so the step's own
 * `projectId` — which the daemon engine actually reads at run time — always
 * matches, rather than falling back to an arbitrary "first project in the
 * DB".
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Check, ChevronLeft, TriangleAlert, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Hint } from '@/components/ui/hint';
import { mfToast } from '@/lib/toast';
import type { AutomationCreateInput, AutomationDefinition } from '../contract';
import { useAutomationsNav } from '../data/use-automations-nav';
import { useAutomationsStore } from '../data/use-automations-store';
import { builtinTokens, triggerTokens } from '../domain/tokens';
import { validate } from '../domain/validate';
import { Recipe } from './Recipe';
import { stampAgentProjectId } from './stamp-agent-project-id';
import { WhenCard } from './WhenCard';

interface DraftState {
  name: string;
  description: string;
  definition: AutomationDefinition;
}

const EMPTY_DRAFT: DraftState = {
  name: '',
  description: '',
  definition: { triggers: [], steps: [] },
};

function draftFrom(input: { name: string; description?: string; definition: AutomationDefinition }): DraftState {
  return { name: input.name, description: input.description ?? '', definition: input.definition };
}

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
        <span className="flex h-[22px] min-w-[22px] items-center justify-center rounded-full bg-foreground text-caption font-bold text-background">
          {index}
        </span>
        <span className="text-heading font-bold tracking-tight text-foreground">{label}</span>
        {hint && <span className="text-caption text-muted-foreground">{hint}</span>}
      </div>
      <div className="pl-[32px]">{children}</div>
    </div>
  );
}

export function AutomationEditor() {
  const editorTarget = useAutomationsNav((s) => s.editorTarget);
  const closeEditor = useAutomationsNav((s) => s.closeEditor);
  const definitions = useAutomationsStore((s) => s.definitions);
  const catalog = useAutomationsStore((s) => s.catalog);
  const gateway = useAutomationsStore((s) => s.gateway);
  const patchDefinition = useAutomationsStore((s) => s.patchDefinition);
  const activeProjectId = useAutomationsStore((s) => s.activeProjectId);

  const existing =
    editorTarget?.mode === 'edit' ? definitions.find((d) => d.id === editorTarget.automationId) : undefined;
  const isNew = editorTarget?.mode !== 'edit';
  const editKey = editorTarget?.mode === 'edit' ? editorTarget.automationId : null;
  const newDraft = editorTarget?.mode === 'new' ? editorTarget.draft : undefined;

  const [draft, setDraft] = useState<DraftState>(() =>
    existing ? draftFrom(existing) : newDraft ? draftFrom(newDraft) : EMPTY_DRAFT,
  );
  const [saving, setSaving] = useState(false);

  // Re-seed only when the target identity changes (`editKey`), not on every store
  // tick — mirrors the initializer above so the mount-time run is a harmless no-op
  // re-render with the same values; real re-seeds happen when `editorTarget`
  // switches between two `edit` targets (or `edit` ↔ `new`) without this component
  // unmounting in between.
  useEffect(() => {
    setDraft(existing ? draftFrom(existing) : newDraft ? draftFrom(newDraft) : EMPTY_DRAFT);
  }, [editKey]);

  const issues = useMemo(() => {
    const base = validate(draft.name, draft.definition, catalog);
    return activeProjectId
      ? base
      : [{ stepId: null, level: 'error' as const, msg: 'Pick an active project first.' }, ...base];
  }, [draft.name, draft.definition, catalog, activeProjectId]);
  const errors = issues.filter((i) => i.level === 'error');
  const ok = errors.length === 0;

  const scopeTokens = useMemo(
    () => builtinTokens().concat(triggerTokens(draft.definition.triggers)),
    [draft.definition.triggers],
  );

  async function handleSave() {
    if (!ok || saving || !activeProjectId) return;
    setSaving(true);
    try {
      const input: AutomationCreateInput = {
        name: draft.name,
        description: draft.description || undefined,
        scope: 'project',
        projectId: activeProjectId,
        definition: {
          ...draft.definition,
          steps: stampAgentProjectId(draft.definition.steps, activeProjectId),
        },
      };
      const result =
        editorTarget?.mode === 'edit'
          ? await gateway.updateAutomation(editorTarget.automationId, input)
          : await gateway.createAutomation(input);
      patchDefinition(result);
      closeEditor();
    } catch (err) {
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
        <span className="text-heading font-bold tracking-tight text-foreground">
          {isNew ? 'New automation' : draft.name || 'Automation'}
        </span>
        <span className="flex-1" />
        <button
          type="button"
          data-testid="automations-editor-cancel"
          onClick={closeEditor}
          className="h-[30px] rounded-md border border-border px-3.5 text-label font-medium text-muted-foreground hover:bg-accent"
        >
          Cancel
        </button>
        <button
          type="button"
          data-testid="automations-editor-save"
          disabled={!ok || saving}
          onClick={() => void handleSave()}
          className="inline-flex h-[30px] items-center gap-1.5 rounded-md bg-primary px-3.5 text-label font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-45"
        >
          <Check size={12} aria-hidden />
          {isNew ? 'Create' : 'Save'}
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[620px] px-[24px] pt-[22px] pb-[32px]">
          <div className="mb-[24px] flex flex-col gap-[8px]">
            <input
              data-testid="automations-editor-name"
              value={draft.name}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              placeholder="Name this automation"
              className="border-none bg-transparent p-0 text-title font-bold tracking-tight text-foreground outline-none placeholder:text-muted-foreground"
            />
            <input
              data-testid="automations-editor-description"
              value={draft.description}
              onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
              placeholder="What does it do? (optional)"
              className="border-none bg-transparent p-0 text-body text-muted-foreground outline-none placeholder:text-muted-foreground"
            />
          </div>

          <EditorSection
            index={1}
            label="When"
            hint={draft.definition.triggers.length === 0 ? 'What kicks it off' : undefined}
          >
            <WhenCard
              triggers={draft.definition.triggers}
              onChange={(triggers) => setDraft((d) => ({ ...d, definition: { ...d.definition, triggers } }))}
            />
          </EditorSection>

          <EditorSection index={2} label="Do" hint="Step by step, top to bottom">
            <Recipe
              steps={draft.definition.steps}
              onChange={(steps) => setDraft((d) => ({ ...d, definition: { ...d.definition, steps } }))}
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
          <span className="inline-flex items-center gap-1.5 text-label font-semibold text-foreground">
            <span className="flex size-[16px] items-center justify-center rounded-full bg-mf-success">
              <Check size={12} className="text-primary-foreground" aria-hidden />
            </span>
            {`Looks good · ready to ${isNew ? 'create' : 'save'}`}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-label font-semibold text-foreground">
            <TriangleAlert size={13} className="text-destructive" aria-hidden />
            {errors.length} to fix
          </span>
        )}
        <div className="h-4 w-px bg-border" />
        <div data-testid="automations-editor-issues" className="flex flex-1 items-center gap-3.5 overflow-x-auto">
          {issues.length === 0 ? (
            <span className="text-caption text-muted-foreground">Every step’s inputs are available when it runs.</span>
          ) : (
            issues.map((issue, i) => (
              <span key={i} className="inline-flex shrink-0 items-center gap-1.5 text-caption text-muted-foreground">
                <span
                  className={cn('size-1.5 rounded-full', issue.level === 'error' ? 'bg-destructive' : 'bg-mf-warning')}
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
