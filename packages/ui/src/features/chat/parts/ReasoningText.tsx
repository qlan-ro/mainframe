import { INTERNAL, useAuiState, type ReasoningMessagePartComponent } from '@assistant-ui/react';

const EMPTY_PART: Parameters<typeof INTERNAL.useSmooth>[0] = {
  type: 'reasoning',
  text: '',
  status: { type: 'complete' },
};

export const ReasoningText: ReasoningMessagePartComponent = () => {
  const part = useAuiState((state) => (state.part.type === 'reasoning' ? state.part : EMPTY_PART));
  const { text } = INTERNAL.useSmooth(part, true);
  return <>{text}</>;
};
