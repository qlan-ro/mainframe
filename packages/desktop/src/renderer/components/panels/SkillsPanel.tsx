import React, { useEffect, useState, useCallback } from 'react';
import { Zap, MoreHorizontal, Pencil, Trash2, Globe, FolderOpen, Puzzle } from 'lucide-react';
import { useSkillsStore, useProjectsStore } from '../../store';
import { useTabsStore } from '../../store/tabs';
import type { Skill } from '@mainframe/types';

const SCOPE_ICON: Record<string, React.ReactNode> = {
  project: <FolderOpen size={12} />,
  global: <Globe size={12} />,
  plugin: <Puzzle size={12} />,
};

const SCOPE_LABEL: Record<string, string> = {
  project: 'Project',
  global: 'Global',
  plugin: 'Plugin',
};

function SkillItem({
  skill,
  onInvoke,
  onEdit,
  onDelete,
}: {
  skill: Skill;
  onInvoke: (skill: Skill) => void;
  onEdit: (skill: Skill) => void;
  onDelete: (skill: Skill) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div
      className="group w-full px-3 py-2 text-left rounded-mf-input transition-colors hover:bg-mf-hover/50 cursor-pointer flex items-start gap-2"
      onClick={() => onInvoke(skill)}
    >
      <Zap size={14} className="text-mf-accent mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span
            className="text-mf-body text-mf-text-primary truncate font-medium"
            title={skill.invocationName || skill.displayName || skill.name}
          >
            {skill.invocationName || skill.displayName || skill.name}
          </span>
          <span className="flex items-center gap-0.5 px-1.5 py-0 rounded-full bg-mf-hover text-mf-status text-mf-text-secondary shrink-0">
            {SCOPE_ICON[skill.scope]}
            {SCOPE_LABEL[skill.scope]}
          </span>
        </div>
        {skill.description && (
          <div className="text-mf-label text-mf-text-secondary mt-0.5 truncate" title={skill.description}>
            {skill.description}
          </div>
        )}
        <div className="text-mf-status text-mf-text-secondary mt-0.5 font-mono">
          /{skill.invocationName || skill.name}
        </div>
      </div>
      <div className="relative shrink-0">
        <button
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpen(!menuOpen);
          }}
          className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-mf-hover text-mf-text-secondary hover:text-mf-text-primary transition-all"
        >
          <MoreHorizontal size={14} />
        </button>
        {menuOpen && (
          <div
            className="absolute right-0 top-full mt-1 min-w-[120px] bg-mf-panel-bg border border-mf-border rounded-mf-input shadow-lg z-50"
            onMouseLeave={() => setMenuOpen(false)}
          >
            <button
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen(false);
                onEdit(skill);
              }}
              className="w-full text-left px-3 py-1.5 text-mf-small text-mf-text-secondary hover:bg-mf-hover hover:text-mf-text-primary flex items-center gap-2"
            >
              <Pencil size={14} /> Edit
            </button>
            {skill.scope !== 'plugin' && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuOpen(false);
                  onDelete(skill);
                }}
                className="w-full text-left px-3 py-1.5 text-mf-small text-mf-destructive hover:bg-mf-hover flex items-center gap-2"
              >
                <Trash2 size={14} /> Delete
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function SkillsPanel(): React.ReactElement {
  const { skills, loading, fetchSkills, deleteSkill, setPendingInvocation } = useSkillsStore();
  const projects = useProjectsStore((s) => s.projects);
  const activeProjectId = useProjectsStore((s) => s.activeProjectId);
  const activeProject = projects.find((p) => p.id === activeProjectId);

  useEffect(() => {
    if (activeProject) {
      fetchSkills('claude', activeProject.path);
    }
  }, [activeProject?.path, fetchSkills]);

  const handleInvoke = useCallback(
    (skill: Skill) => {
      const command = `/${skill.invocationName || skill.name} `;
      setPendingInvocation(command);
    },
    [setPendingInvocation],
  );

  const handleEdit = useCallback((skill: Skill) => {
    useTabsStore.getState().openSkillEditorTab(skill.id, skill.adapterId, `${skill.displayName || skill.name} (skill)`);
  }, []);

  const handleDelete = useCallback(
    async (skill: Skill) => {
      if (!activeProject) return;
      if (!confirm(`Delete skill "${skill.displayName || skill.name}"?`)) return;
      await deleteSkill('claude', skill.id, activeProject.path);
    },
    [activeProject, deleteSkill],
  );

  const grouped = {
    project: skills.filter((s) => s.scope === 'project'),
    global: skills.filter((s) => s.scope === 'global'),
    plugin: skills.filter((s) => s.scope === 'plugin'),
  };

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 overflow-y-auto px-[10px]">
        {!activeProjectId ? (
          <div className="py-4 text-center text-mf-text-secondary text-mf-label">Select a project to view skills</div>
        ) : loading ? (
          <div className="py-4 text-center text-mf-text-secondary text-mf-label">Loading skills...</div>
        ) : skills.length === 0 ? (
          <div className="py-4 text-center text-mf-text-secondary text-mf-label">No skills found</div>
        ) : (
          <div className="space-y-3 py-1">
            {(['project', 'global', 'plugin'] as const).map((scope) => {
              const items = grouped[scope];
              if (items.length === 0) return null;
              return (
                <div key={scope}>
                  <div className="flex items-center gap-1.5 px-3 py-1 text-mf-status text-mf-text-secondary uppercase tracking-wider font-medium">
                    {SCOPE_ICON[scope]}
                    {SCOPE_LABEL[scope]} ({items.length})
                  </div>
                  <div className="space-y-0.5">
                    {items.map((skill) => (
                      <SkillItem
                        key={skill.id}
                        skill={skill}
                        onInvoke={handleInvoke}
                        onEdit={handleEdit}
                        onDelete={handleDelete}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
