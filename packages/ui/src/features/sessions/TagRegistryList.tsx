/**
 * The registry rows, and which one is being renamed.
 *
 * Renaming is a property of the list rather than the popover: only one row can
 * be in it at a time, and nothing outside the list cares which.
 */
import { useState } from 'react';
import type { Tag } from '@qlan-ro/mainframe-types';
import { CommandGroup } from '@/components/ui/command';
import { TagRegistryRow } from './TagRegistryRow';
import type { TagMutations } from './use-tag-mutations';

interface TagRegistryListProps {
  tags: Tag[];
  /** Tags already on the session this popover was opened from. */
  applied: Set<string>;
  mutations: TagMutations;
  onRecolor: (name: string) => void;
  onDelete: (name: string) => void;
}

export function TagRegistryList({ tags, applied, mutations, onRecolor, onDelete }: TagRegistryListProps) {
  const [renaming, setRenaming] = useState<string | null>(null);

  return (
    <CommandGroup>
      {tags.map((tag) => (
        <TagRegistryRow
          key={tag.name}
          tag={tag}
          checked={applied.has(tag.name)}
          renaming={renaming === tag.name}
          onToggle={() => void mutations.toggle(tag.name)}
          onStartRename={() => setRenaming(tag.name)}
          onRecolor={() => onRecolor(tag.name)}
          onDelete={() => onDelete(tag.name)}
          onCommitRename={(to) => {
            setRenaming(null);
            if (to.length > 0) void mutations.rename(tag.name, to);
          }}
          onCancelRename={() => setRenaming(null)}
        />
      ))}
    </CommandGroup>
  );
}
