import { useTurnSelector } from './turn-context';

/** When the background command or monitor this call started began, while it still runs. */
export function useBackgroundStart(toolCallId: string): number | undefined {
  return useTurnSelector(({ children }) => children.background.get(toolCallId), undefined);
}
