/**
 * The searchable body of the tag popover: find, apply, create, and manage.
 *
 * One field does both jobs — it filters the registry and, when what was typed
 * matches nothing, offers to create it. cmdk's own filter is off because the
 * create row depends on the query itself, not on which rows survived it.
 *
 * State that only matters while the popover is open dies with the panel when
 * Radix unmounts it.
 */
import { useState } from 'react';
import { PlusIcon } from 'lucide-react';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import { tagNameErrorMessage, validateTagName, type TagNameError } from '@/features/sessions/tags/validate-tag-name';
import type { TagRegistry } from '@/features/sessions/tags/use-tag-registry';
import { TagRecolorPanel } from './TagRecolorPanel';
import { TagRegistryList } from './TagRegistryList';
import type { TagMutations } from './use-tag-mutations';

function PanelErrors({ nameError, error }: { nameError: TagNameError | null; error: string | null }) {
  return (
    <>
      {nameError !== null && (
        <p data-testid="sessions-tag-popover-name-error" className="px-2 py-1 text-xs text-destructive">
          {tagNameErrorMessage(nameError)}
        </p>
      )}
      {error !== null && (
        <p data-testid="sessions-tag-popover-error" className="px-2 py-1 text-xs text-destructive">
          {error}
        </p>
      )}
    </>
  );
}

function CreateTagRow({ name, onCreate }: { name: string; onCreate: () => void }) {
  return (
    <>
      <CommandSeparator />
      <CommandGroup>
        <CommandItem data-testid="sessions-tag-popover-create" value={`create-${name}`} onSelect={onCreate}>
          <PlusIcon />
          Create tag “{name}”
        </CommandItem>
      </CommandGroup>
    </>
  );
}

interface TagPopoverPanelProps {
  registry: TagRegistry;
  /** Tags already on the session this popover was opened from. */
  applied: Set<string>;
  mutations: TagMutations;
  /** Delete confirms in the shell, which has to close the popover to ask. */
  onRequestDelete: (name: string) => void;
}

export function TagPopoverPanel({ registry, applied, mutations, onRequestDelete }: TagPopoverPanelProps) {
  const [query, setQuery] = useState('');
  const [recoloring, setRecoloring] = useState<string | null>(null);

  const typed = query.trim().toLowerCase();
  const nameError = typed.length > 0 ? validateTagName(typed) : null;
  const matches = typed ? registry.tags.filter((tag) => tag.name.includes(typed)) : registry.tags;
  const showCreate = typed.length > 0 && nameError === null && !registry.tags.some((tag) => tag.name === typed);

  function create(): void {
    void mutations.createAndApply(typed);
    setQuery('');
  }

  return (
    <>
      <Command shouldFilter={false}>
        <CommandInput
          autoFocus
          data-testid="sessions-tag-popover-search"
          placeholder="Find or create…"
          value={query}
          onValueChange={(value) => {
            setQuery(value);
            mutations.clearError();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && showCreate) create();
          }}
        />
        <PanelErrors nameError={nameError} error={mutations.error} />
        <CommandList>
          {!showCreate && <CommandEmpty>No tags</CommandEmpty>}
          <TagRegistryList
            tags={matches}
            applied={applied}
            mutations={mutations}
            onRecolor={setRecoloring}
            onDelete={onRequestDelete}
          />
          {showCreate && <CreateTagRow name={typed} onCreate={create} />}
        </CommandList>
      </Command>

      {recoloring !== null && (
        <TagRecolorPanel
          tagName={recoloring}
          onPick={(color) => {
            setRecoloring(null);
            void mutations.recolor(recoloring, color);
          }}
          onClose={() => setRecoloring(null)}
        />
      )}
    </>
  );
}
