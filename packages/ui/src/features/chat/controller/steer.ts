/**
 * How the composer asks for Steer (C9): a flag on the appended message's
 * `runConfig.custom`, read by `sendChatMessage`. It rides the run config
 * because that is the only per-send field assistant-ui carries through
 * `thread.append` untouched.
 */
import type { AppendMessage } from '@assistant-ui/react';

const STEER_KEY = 'mainframeSteer';

type RunConfig = AppendMessage['runConfig'];

export function withSteer(runConfig: RunConfig): RunConfig {
  return { ...runConfig, custom: { ...runConfig?.custom, [STEER_KEY]: true } };
}

export function wantsSteer(message: Pick<AppendMessage, 'runConfig'>): boolean {
  return message.runConfig?.custom?.[STEER_KEY] === true;
}
