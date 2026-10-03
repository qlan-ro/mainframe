import type { ThreadMessage } from '@assistant-ui/react';
import type { PresentationTimingSchema, TranscriptPresentation } from '@qlan-ro/mainframe-types';
import type { z } from 'zod';
import type { NativePartSource } from '../transcript-presentation';
import type { ActivityGroup, ActivityMember } from './types';

export interface TurnScope {
  rootThreadId: string;
  ancestors: readonly string[];
  pendingToolIds: ReadonlySet<string>;
}
export interface SourceUnit extends ActivityMember {
  readonly key: string;
  readonly source?: NativePartSource;
  readonly turnKey?: string;
  readonly work: boolean;
  readonly final: boolean;
  readonly protected: boolean;
}
export interface DisplayUnit extends SourceUnit {
  readonly activity?: { group: ActivityGroup; members: readonly SourceUnit[] };
}
export type TurnTiming = z.infer<typeof PresentationTimingSchema>;
export interface TurnDisclosure {
  readonly key: string;
  readonly workKeys: readonly string[];
  readonly innerKeys: readonly string[];
  readonly firstWorkKey?: string;
  readonly available: boolean;
  readonly unsafe: boolean;
  readonly invalid: boolean;
  readonly activeAgent: boolean;
  readonly running: boolean;
  readonly timing?: TurnTiming;
}
export interface MessagePresentation {
  readonly messageId: string;
  readonly native: boolean;
  readonly units: readonly DisplayUnit[];
  readonly timingTurnKey?: string;
  readonly footerInDetails: boolean;
}
export interface TurnPresentation {
  readonly messages: readonly MessagePresentation[];
  readonly turns: ReadonlyMap<string, TurnDisclosure>;
}
export function turnKey(scope: TurnScope, presentation: TranscriptPresentation): string {
  return JSON.stringify([
    scope.rootThreadId,
    scope.ancestors,
    presentation.provider,
    presentation.turnId,
    presentation.parentToolUseId,
  ]);
}
export type TranscriptMessages = readonly ThreadMessage[];
