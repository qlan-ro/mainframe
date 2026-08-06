/**
 * One row of the tag registry: a checkable tag, or the input renaming it.
 *
 * Renaming swaps the row for an input rather than opening a second layer — the
 * name is edited where it is read. The input stops its own keys from reaching
 * cmdk, which would otherwise read typing as list navigation.
 */
import { useState } from 'react';
import type { Tag } from '@qlan-ro/mainframe-types';
import { CommandItem } from '@v2/components/ui/command';
import { Input } from '@v2/components/ui/input';
import { TAG_DOT_STYLE } from '@/features/sessions/tags/tag-colors';
import { TagRegistryItemMenu } from './TagRegistryItemMenu';

interface RenameInputProps {
  initial: string;
  onCommit: (to: string) => void;
  onCancel: () => void;
}

function RenameInput({ initial, onCommit, onCancel }: RenameInputProps) {
  const [value, setValue] = useState(initial);

  return (
    <Input
      autoFocus
      data-testid="sessions-tag-rename-input"
      className="my-0.5 h-8"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => onCommit(value.trim().toLowerCase())}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') {
          e.preventDefault();
          onCommit(value.trim().toLowerCase());
        } else if (e.key === 'Escape') {
          e.preventDefault();
          onCancel();
        }
      }}
    />
  );
}

interface TagRegistryRowProps {
  tag: Tag;
  /** Applied to the session this popover was opened from. */
  checked: boolean;
  renaming: boolean;
  onToggle: () => void;
  onStartRename: () => void;
  onRecolor: () => void;
  onDelete: () => void;
  onCommitRename: (to: string) => void;
  onCancelRename: () => void;
}

export function TagRegistryRow({
  tag,
  checked,
  renaming,
  onToggle,
  onStartRename,
  onRecolor,
  onDelete,
  onCommitRename,
  onCancelRename,
}: TagRegistryRowProps) {
  if (renaming) {
    return <RenameInput initial={tag.name} onCommit={onCommitRename} onCancel={onCancelRename} />;
  }

  return (
    <TagRegistryItemMenu tagName={tag.name} onRename={onStartRename} onRecolor={onRecolor} onDelete={onDelete}>
      <CommandItem
        data-testid={`sessions-tag-toggle-${tag.name}`}
        data-checked={checked}
        value={tag.name}
        onSelect={onToggle}
      >
        <span aria-hidden className="size-2 shrink-0 rounded-full" style={TAG_DOT_STYLE(tag.color)} />
        <span data-testid={`sessions-tag-registry-row-${tag.name}`}>{tag.name}</span>
      </CommandItem>
    </TagRegistryItemMenu>
  );
}
