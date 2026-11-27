import { useAui, useAuiState, type ReasoningMessagePartComponent } from '@assistant-ui/react';
import { useSmoothText } from './use-smooth-text';

export const ReasoningText: ReasoningMessagePartComponent = () => {
  // Native scoped reasoning ranges use text-part providers.
  const text = useAuiState((s) => (s.part.type === 'reasoning' || s.part.type === 'text' ? s.part.text : ''));
  const running = useAuiState((s) => s.part.status.type === 'running');
  const aui = useAui();
  const part = useAuiState(() => aui.part);
  return <>{useSmoothText(text, running, { part })}</>;
};
