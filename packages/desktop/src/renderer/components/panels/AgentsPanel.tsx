import React, { useEffect, useCallback, useState } from 'react';
import { Bot, MoreHorizontal, Pencil, Trash2, Globe, FolderOpen } from 'lucide-react';
import { useSkillsStore, useProjectsStore } from '../../store';
import { useTabsStore } from '../../store/tabs';
import type { AgentConfig } from '@mainframe/types';

const SCOPE_ICON: Record<string, React.ReactNode> = {
  project: <FolderOpen size={12} />,
  global: <Globe size={12} />,
};

function AgentItem({
  agent,
  onEdit,
  onDelete,
}: {
  agent: AgentConfig;
  onEdit: (agent: AgentConfig) => void;
  onDelete: (agent: AgentConfig) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="group w-full px-3 py-2 text-left rounded-mf-input transition-colors hover:bg-mf-hover/50 flex items-start gap-2">
      <Bot size={14} className="text-mf-accent mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-mf-body text-mf-text-primary truncate font-medium" title={agent.name}>
            {agent.name}
          </span>
          <span className="flex items-center gap-0.5 px-1.5 py-0 rounded-full bg-mf-hover text-mf-status text-mf-text-secondary shrink-0">
            {SCOPE_ICON[agent.scope]}
            {agent.scope === 'project' ? 'Project' : 'Global'}
          </span>
        </div>
        {agent.description && (
          <div className="text-mf-label text-mf-text-secondary mt-0.5 truncate" title={agent.description}>
            {agent.description}
          </div>
        )}
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
                onEdit(agent);
              }}
              className="w-full text-left px-3 py-1.5 text-mf-small text-mf-text-secondary hover:bg-mf-hover hover:text-mf-text-primary flex items-center gap-2"
            >
              <Pencil size={14} /> Edit
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen(false);
                onDelete(agent);
              }}
              className="w-full text-left px-3 py-1.5 text-mf-small text-mf-destructive hover:bg-mf-hover flex items-center gap-2"
            >
              <Trash2 size={14} /> Delete
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export function AgentsPanel(): React.ReactElement {
  const { agents, loading, fetchAgents, deleteAgent } = useSkillsStore();
  const projects = useProjectsStore((s) => s.projects);
  const activeProjectId = useProjectsStore((s) => s.activeProjectId);
  const activeProject = projects.find((p) => p.id === activeProjectId);

  useEffect(() => {
    if (activeProject) {
      fetchAgents('claude', activeProject.path);
    }
  }, [activeProject?.path, fetchAgents]);

  const handleEdit = useCallback((agent: AgentConfig) => {
    useTabsStore.getState().openEditorTab(agent.filePath);
  }, []);

  const handleDelete = useCallback(
    async (agent: AgentConfig) => {
      if (!activeProject) return;
      if (!confirm(`Delete agent "${agent.name}"?`)) return;
      await deleteAgent('claude', agent.id, activeProject.path);
    },
    [activeProject, deleteAgent],
  );

  if (!activeProjectId) {
    return (
      <div className="h-full flex flex-col items-center justify-center px-[10px]">
        <Bot size={24} className="text-mf-text-secondary mb-2" />
        <div className="text-mf-body text-mf-text-secondary text-center">Select a project to view agents</div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="h-full flex flex-col items-center justify-center px-[10px]">
        <div className="text-mf-body text-mf-text-secondary text-center">Loading agents...</div>
      </div>
    );
  }

  if (agents.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center px-[10px]">
        <Bot size={24} className="text-mf-text-secondary mb-2" />
        <div className="text-mf-body text-mf-text-secondary text-center">No agent configs found</div>
        <div className="text-mf-label text-mf-text-secondary text-center mt-1">
          Add .md files to .claude/agents/ to define agent configurations
        </div>
      </div>
    );
  }

  const projectAgents = agents.filter((a) => a.scope === 'project');
  const globalAgents = agents.filter((a) => a.scope === 'global');

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 overflow-y-auto px-[10px]">
        <div className="space-y-3 py-1">
          {projectAgents.length > 0 && (
            <div>
              <div className="flex items-center gap-1.5 px-3 py-1 text-mf-status text-mf-text-secondary uppercase tracking-wider font-medium">
                <FolderOpen size={12} />
                Project ({projectAgents.length})
              </div>
              <div className="space-y-0.5">
                {projectAgents.map((agent) => (
                  <AgentItem key={agent.id} agent={agent} onEdit={handleEdit} onDelete={handleDelete} />
                ))}
              </div>
            </div>
          )}
          {globalAgents.length > 0 && (
            <div>
              <div className="flex items-center gap-1.5 px-3 py-1 text-mf-status text-mf-text-secondary uppercase tracking-wider font-medium">
                <Globe size={12} />
                Global ({globalAgents.length})
              </div>
              <div className="space-y-0.5">
                {globalAgents.map((agent) => (
                  <AgentItem key={agent.id} agent={agent} onEdit={handleEdit} onDelete={handleDelete} />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
