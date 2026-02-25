import React, { useEffect, useState, useCallback } from 'react';
import { Save } from 'lucide-react';
import { createLogger } from '../../lib/logger';

const log = createLogger('renderer:skills');
import { useSkillsStore, useProjectsStore } from '../../store';
import { Button } from '../ui/button';

export function SkillEditorTab({ skillId, adapterId }: { skillId: string; adapterId: string }): React.ReactElement {
  const { skills, updateSkill } = useSkillsStore();
  const projects = useProjectsStore((s) => s.projects);
  const activeProjectId = useProjectsStore((s) => s.activeProjectId);
  const activeProject = projects.find((p) => p.id === activeProjectId);

  const skill = skills.find((s) => s.id === skillId);
  const [content, setContent] = useState('');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (skill) {
      setContent(skill.content);
      setDirty(false);
    }
  }, [skill?.id]);

  const handleSave = useCallback(async () => {
    if (!activeProject || !skill) return;
    setSaving(true);
    try {
      await updateSkill(adapterId, skillId, activeProject.path, content);
      setDirty(false);
    } catch (err) {
      log.error('save failed', { err: String(err) });
    } finally {
      setSaving(false);
    }
  }, [activeProject, skill, adapterId, skillId, content, updateSkill]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        if (dirty) handleSave();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [dirty, handleSave]);

  if (!skill) {
    return (
      <div className="h-full flex items-center justify-center text-mf-text-secondary text-mf-body">Skill not found</div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-4 py-2 border-b border-mf-divider shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-mf-body text-mf-text-primary font-medium">{skill.displayName || skill.name}</span>
          <span className="text-mf-label text-mf-text-secondary">{skill.scope} skill</span>
          {dirty && <span className="text-mf-label text-mf-warning">Modified</span>}
        </div>
        <Button
          variant="ghost"
          size="sm"
          disabled={!dirty || saving || skill.scope === 'plugin'}
          onClick={handleSave}
          className="h-7 px-2 text-mf-small"
        >
          <Save size={14} className="mr-1" />
          {saving ? 'Saving...' : 'Save'}
        </Button>
      </div>
      <textarea
        value={content}
        onChange={(e) => {
          setContent(e.target.value);
          setDirty(true);
        }}
        readOnly={skill.scope === 'plugin'}
        className="flex-1 w-full bg-transparent text-mf-chat text-mf-text-primary font-mono p-4 resize-none focus:outline-none"
        spellCheck={false}
      />
    </div>
  );
}
