/**
 * The Setup Advisor's Skills section: browse, search, inspect, and delete the
 * active adapter and project's skills. No create, no edit.
 *
 * The selection holds the `Skill` object rather than an id re-derived from the
 * list, because every refetch — including the one a failed delete triggers —
 * empties the list first, and an inspect view that re-derived its skill would
 * render nothing mid-flight. It is dropped when `identityKey` changes: skill
 * ids carry no project, so a selection held across a project switch would
 * delete a same-named skill in the new one.
 */
import { useEffect, useState } from 'react';
import type { Skill } from '@qlan-ro/mainframe-types';
import { Input } from '@/components/ui/input';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { mfToast } from '@/lib/toast';
import { useSkillsSection, type SkillsSectionState } from './use-skills-section';
import { isDeletable, matchesQuery, skillDirectory } from './skill-filters';
import { SkillsSectionList } from './SkillsSectionList';
import { SkillInspect } from './SkillInspect';
import { SkillsCliSuggestion } from './SkillsCliSuggestion';

function Notice({ testid, children }: { testid: string; children: React.ReactNode }) {
  return (
    <p data-testid={testid} className="px-4 py-6 text-center text-body text-muted-foreground">
      {children}
    </p>
  );
}

function ErrorBody({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div data-testid="skills-section-error" className="px-4 py-6 text-center">
      <p className="text-body font-medium text-foreground">Couldn&apos;t load skills.</p>
      <p className="mt-1 text-caption text-muted-foreground">{message}</p>
      <button
        type="button"
        data-testid="skills-section-retry"
        onClick={onRetry}
        className="mt-3 rounded-md bg-primary px-3 py-1.5 text-label font-medium text-primary-foreground transition-opacity hover:opacity-90"
      >
        Try again
      </button>
    </div>
  );
}

interface ListBodyProps {
  state: SkillsSectionState;
  query: string;
  onQueryChange: (value: string) => void;
  onOpen: (skill: Skill) => void;
  onDelete: (skill: Skill) => void;
  onRetry: () => void;
}

function ListBody({ state, query, onQueryChange, onOpen, onDelete, onRetry }: ListBodyProps) {
  if (state.status === 'loading') {
    return (
      <div data-testid="skills-section-loading" className="p-4">
        <div className="mb-2 h-8 animate-pulse rounded-md bg-muted" />
        <div className="h-8 animate-pulse rounded-md bg-muted" />
      </div>
    );
  }
  if (state.status === 'unsupported')
    return <Notice testid="skills-section-unsupported">This adapter has no skills.</Notice>;
  if (state.status === 'error') return <ErrorBody message={state.message} onRetry={onRetry} />;
  if (state.status === 'empty') return <Notice testid="skills-section-empty">No skills for this project yet.</Notice>;

  const filtered = state.skills.filter((skill) => matchesQuery(skill, query));
  return (
    <>
      <div className="shrink-0 px-4 py-2.5">
        <Input
          data-testid="skills-section-search"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Search skills"
          aria-label="Search skills"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          query.trim() === '' ? (
            <Notice testid="skills-section-empty">No skills for this project yet.</Notice>
          ) : (
            <Notice testid="skills-section-no-results">No skills match “{query}”.</Notice>
          )
        ) : (
          <SkillsSectionList skills={filtered} onOpen={onOpen} onDelete={onDelete} />
        )}
      </div>
    </>
  );
}

function DeleteConfirm({ skill, onConfirm, onCancel }: { skill: Skill; onConfirm: () => void; onCancel: () => void }) {
  return (
    <ConfirmDialog
      open
      testid="skills-delete-confirm"
      destructive
      title={`Delete ${skill.displayName || skill.name}?`}
      body={`Deletes ${skillDirectory(skill)} from disk. This cannot be undone.`}
      confirmLabel="Delete"
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}

async function runDelete(skill: Skill, remove: (skillId: string) => Promise<void>): Promise<boolean> {
  try {
    await remove(skill.id);
    mfToast.success(`Deleted ${skill.displayName || skill.name}`);
    return true;
  } catch (err) {
    mfToast.error('Could not delete skill', { description: err instanceof Error ? err.message : String(err) });
    return false;
  }
}

function useSkillSelection(identityKey: string) {
  const [selected, setSelected] = useState<Skill | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Skill | null>(null);

  // A held skill belongs to the identity it was listed under, and nothing else.
  useEffect(() => {
    setSelected(null);
    setPendingDelete(null);
  }, [identityKey]);

  return { selected, setSelected, pendingDelete, setPendingDelete };
}

export function SkillsSection() {
  const { state, identityKey, reload, remove } = useSkillsSection();
  const { selected, setSelected, pendingDelete, setPendingDelete } = useSkillSelection(identityKey);
  const [query, setQuery] = useState('');
  const [cliDismissed, setCliDismissed] = useState(false);

  async function confirmDelete(skill: Skill) {
    const deleted = await runDelete(skill, remove);
    if (deleted) setSelected((current) => (current?.id === skill.id ? null : current));
    setPendingDelete(null);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {!cliDismissed && <SkillsCliSuggestion onDismiss={() => setCliDismissed(true)} />}

      {selected ? (
        <SkillInspect
          skill={selected}
          onBack={() => setSelected(null)}
          onDelete={isDeletable(selected) ? setPendingDelete : undefined}
        />
      ) : (
        <ListBody
          state={state}
          query={query}
          onQueryChange={setQuery}
          onOpen={setSelected}
          onDelete={setPendingDelete}
          onRetry={reload}
        />
      )}

      {pendingDelete && (
        <DeleteConfirm
          skill={pendingDelete}
          onConfirm={() => void confirmDelete(pendingDelete)}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}
