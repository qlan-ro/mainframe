import { Globe, FolderOpen, MessageSquare } from 'lucide-react';
import { useSessionContext } from './use-session-context';
import { deriveSessionItems } from './derive-session-items';
import { ContextSection } from './ContextSection';
import { ContextFileItem } from './ContextFileItem';
import { SessionAttachmentsGrid } from './SessionAttachmentsGrid';

function Muted({ text }: { text: string }) {
  return <div className="py-4 text-center text-caption text-mf-text-3">{text}</div>;
}

/** Context tab body: Global / Project / Session file groups (Tasks live elsewhere). */
export function ContextInspector() {
  const { context, chatId } = useSessionContext();
  if (!chatId) return <Muted text="No active chat" />;
  if (!context) return <Muted text="Loading context…" />;

  const sessionItems = deriveSessionItems(context);
  const sessionCount = sessionItems.length + context.attachments.length;

  return (
    <div className="space-y-1 py-1">
      <ContextSection icon={Globe} title="Global" count={context.globalFiles.length} defaultOpen>
        {context.globalFiles.map((f) => (
          <ContextFileItem key={f.path} path={f.path} />
        ))}
      </ContextSection>

      <ContextSection icon={FolderOpen} title="Project" count={context.projectFiles.length} defaultOpen>
        {context.projectFiles.map((f) => (
          <ContextFileItem key={f.path} path={f.path} />
        ))}
      </ContextSection>

      <ContextSection icon={MessageSquare} title="Session" count={sessionCount} defaultOpen>
        {sessionItems.map((it) => (
          <ContextFileItem key={it.path} path={it.path} displayName={it.displayName} badge={it.badge} />
        ))}
        {context.attachments.length > 0 && (
          <div className="mt-1 px-[12px]">
            <div className="mb-1 text-micro uppercase tracking-wide text-mf-text-3">Attachments</div>
            <SessionAttachmentsGrid chatId={chatId} attachments={context.attachments} />
          </div>
        )}
      </ContextSection>
    </div>
  );
}
