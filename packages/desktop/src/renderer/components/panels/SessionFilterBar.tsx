import React, { useEffect, useMemo } from 'react';
import { useTagsStore } from '../../store/tags';
import { useChatsStore } from '../../store';
import { TagPill } from '../tags/TagPill';
import { ScrollRow } from '../ui/scroll-row';
import type { TagColor, SyntheticTag } from '@qlan-ro/mainframe-types';

export function SessionFilterBar(): React.ReactElement {
  const chats = useChatsStore((s) => s.chats);
  const detectedPrs = useChatsStore((s) => s.detectedPrs);
  const filterProjectId = useChatsStore((s) => s.filterProjectId);

  const registry = useTagsStore((s) => s.registry);
  const registryLoaded = useTagsStore((s) => s.registryLoaded);
  const refreshRegistry = useTagsStore((s) => s.refreshRegistry);

  const selectedTags = useTagsStore((s) => s.selectedTags);
  const selectedSynthetic = useTagsStore((s) => s.selectedSynthetic);
  const toggleTag = useTagsStore((s) => s.toggleTag);
  const toggleSynthetic = useTagsStore((s) => s.toggleSynthetic);

  useEffect(() => {
    if (!registryLoaded) void refreshRegistry();
  }, [registryLoaded, refreshRegistry]);

  // Tags currently in use across the active project scope.
  const tagsInUse = useMemo(() => {
    const scoped = filterProjectId ? chats.filter((c) => c.projectId === filterProjectId) : chats;
    const set = new Set<string>();
    for (const c of scoped) for (const t of c.tags ?? []) set.add(t);
    return [...set].sort();
  }, [chats, filterProjectId]);

  const hasAnyWorktree = useMemo(() => chats.some((c) => Boolean(c.worktreePath)), [chats]);
  const hasAnyPr = useMemo(() => chats.some((c) => (detectedPrs.get(c.id)?.length ?? 0) > 0), [chats, detectedPrs]);

  const colorByName = useMemo(() => {
    const m = new Map<string, TagColor>();
    for (const t of registry) m.set(t.name, t.color);
    return m;
  }, [registry]);

  const showTagsRow = tagsInUse.length > 0 || hasAnyWorktree || hasAnyPr;

  if (!showTagsRow) return <></>;

  return (
    <div className="flex items-center gap-2 px-3 py-2 border-b border-mf-divider">
      <span className="text-xs text-mf-text-secondary uppercase shrink-0">Tags</span>
      <ScrollRow data-testid="session-filter-tags" className="min-w-0 flex-1">
        {tagsInUse.map((name) => (
          <div key={name} className="shrink-0">
            <TagPill
              label={name}
              color={colorByName.get(name) ?? 'gray'}
              variant="filter"
              active={selectedTags.has(name)}
              onClick={() => toggleTag(name)}
            />
          </div>
        ))}
        {hasAnyPr && (
          <div className="shrink-0">
            <TagPill
              label="has-pr"
              color="gray"
              variant="filter"
              active={selectedSynthetic.has('has-pr')}
              onClick={() => toggleSynthetic('has-pr' as SyntheticTag)}
            />
          </div>
        )}
        {hasAnyWorktree && (
          <div className="shrink-0">
            <TagPill
              label="has-worktree"
              color="gray"
              variant="filter"
              active={selectedSynthetic.has('has-worktree')}
              onClick={() => toggleSynthetic('has-worktree' as SyntheticTag)}
            />
          </div>
        )}
      </ScrollRow>
    </div>
  );
}
