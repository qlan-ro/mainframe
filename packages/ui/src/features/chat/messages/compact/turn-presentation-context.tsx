import { createContext, useContext } from 'react';
import type { TurnPresentation } from '../../view-model/compact/turn-types';

export interface TurnPresentationContext {
  model: TurnPresentation;
  open(key: string): boolean;
  toggle(key: string): void;
  register(key: string, before: () => void): () => void;
}
const Context = createContext<TurnPresentationContext | null>(null);
export const TurnPresentationProvider = Context.Provider;
export function useTurnPresentation(): TurnPresentationContext {
  const value = useContext(Context);
  if (!value) throw new Error('Compact transcript scope is missing');
  return value;
}
