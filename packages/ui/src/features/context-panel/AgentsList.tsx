import { Sparkles } from 'lucide-react';
import { useSidebarSkills } from './use-sidebar-skills';
import { ScopedListRow } from './ScopedListRow';

export function AgentsList() {
  const { agents, loading } = useSidebarSkills();
  if (loading) return <div className="py-4 text-center text-caption text-muted-foreground">Loading…</div>;
  if (agents.length === 0) return <div className="py-4 text-center text-caption text-muted-foreground">No agents</div>;
  return (
    <div className="py-1">
      {agents.map((a) => (
        <ScopedListRow
          key={a.id}
          testId={`sidebar-agent-item-${a.id}`}
          icon={Sparkles}
          name={a.name}
          description={a.description}
          scope={a.scope}
          filePath={a.filePath}
        />
      ))}
    </div>
  );
}
