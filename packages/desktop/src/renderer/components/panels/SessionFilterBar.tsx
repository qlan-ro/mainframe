import React, { useEffect, useMemo } from 'react';
import { useTagsStore } from '../../store/tags';
import { useChatsStore, useProjectsStore } from '../../store';
import { TagPill } from '../tags/TagPill';
import type { TagColor, SyntheticTag } from '@qlan-ro/mainframe-types';

export function SessionFilterBar(): React.ReactElement {
  const projects = useProjectsStore((s) => s.projects);
  const chats = useChatsStore((s) => s.chats);
  const detectedPrs = useChatsStore((s) => s.detectedPrs);

  const registry = useTagsStore((s) => s.registry);
  const registryLoaded = useTagsStore((s) => s.registryLoaded);
  const refreshRegistry = useTagsStore((s) => s.refreshRegistry);

  const selectedProject = useTagsStore((s) => s.selectedProject);
  const selectedTags = useTagsStore((s) => s.selectedTags);
  const selectedSynthetic = useTagsStore((s) => s.selectedSynthetic);
  const setSelectedProject = useTagsStore((s) => s.setSelectedProject);
  const toggleTag = useTagsStore((s) => s.toggleTag);
  const toggleSynthetic = useTagsStore((s) => s.toggleSynthetic);

  useEffect(() => {
    if (!registryLoaded) void refreshRegistry();
  }, [registryLoaded, refreshRegistry]);

  // Tags currently in use across the active project scope.
  const tagsInUse = useMemo(() => {
    const scoped = selectedProject ? chats.filter((c) => c.projectId === selectedProject) : chats;
    const set = new Set<string>();
    for (const c of scoped) for (const t of c.tags ?? []) set.add(t);
    return [...set].sort();
  }, [chats, selectedProject]);

  const hasAnyWorktree = useMemo(() => chats.some((c) => Boolean(c.worktreePath)), [chats]);
  const hasAnyPr = useMemo(() => chats.some((c) => (detectedPrs.get(c.id)?.length ?? 0) > 0), [chats, detectedPrs]);

  const colorByName = useMemo(() => {
    const m = new Map<string, TagColor>();
    for (const t of registry) m.set(t.name, t.color);
    return m;
  }, [registry]);

  const showTagsRow = tagsInUse.length > 0 || hasAnyWorktree || hasAnyPr;

  return (
    <div className="flex flex-col gap-1 px-3 py-2 border-b border-mf-divider">
      <div className="flex items-center gap-1 overflow-x-auto">
        <span className="text-xs text-mf-text-secondary uppercase mr-1">Project</span>
        <button
          type="button"
          onClick={() => setSelectedProject(null)}
          className={
            selectedProject === null
              ? 'px-2 py-0.5 rounded-full text-xs bg-mf-accent text-white'
              : 'px-2 py-0.5 rounded-full text-xs border border-mf-border text-mf-text-secondary hover:bg-mf-hover'
          }
        >
          All
        </button>
        {projects.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setSelectedProject(p.id)}
            className={
              selectedProject === p.id
                ? 'px-2 py-0.5 rounded-full text-xs bg-mf-accent text-white whitespace-nowrap'
                : 'px-2 py-0.5 rounded-full text-xs border border-mf-border text-mf-text-secondary hover:bg-mf-hover whitespace-nowrap'
            }
          >
            {p.name}
          </button>
        ))}
      </div>
      {showTagsRow && (
        <div className="flex items-center gap-1 flex-wrap">
          <span className="text-xs text-mf-text-secondary uppercase mr-1">Tags</span>
          {tagsInUse.map((name) => (
            <TagPill
              key={name}
              label={name}
              color={colorByName.get(name) ?? 'gray'}
              variant="filter"
              active={selectedTags.has(name)}
              onClick={() => toggleTag(name)}
            />
          ))}
          {hasAnyPr && (
            <TagPill
              label="has-pr"
              color="gray"
              variant="filter"
              active={selectedSynthetic.has('has-pr')}
              onClick={() => toggleSynthetic('has-pr' as SyntheticTag)}
            />
          )}
          {hasAnyWorktree && (
            <TagPill
              label="has-worktree"
              color="gray"
              variant="filter"
              active={selectedSynthetic.has('has-worktree')}
              onClick={() => toggleSynthetic('has-worktree' as SyntheticTag)}
            />
          )}
        </div>
      )}
    </div>
  );
}
