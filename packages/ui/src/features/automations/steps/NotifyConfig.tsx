/**
 * NotifyConfig — message ChipField + auto-links note (ts153
 * wf2-stepconfig.jsx `WfNotifyConfig`, ported onto `NotifyStep.message`).
 * The note is a UX reminder only — `automation.notification`'s
 * `links:{runId, chatIds}` is populated by the engine (contract §4), never
 * authored here.
 */
import type { NotifyStep } from '../contract';
import type { TokenDescriptor } from '../domain/tokens';
import { ChipField } from '../fields/ChipField';
import { FailureToggle } from './FailureToggle';
import { MoreOptions } from './MoreOptions';

export interface NotifyConfigProps {
  step: NotifyStep;
  onChange: (next: NotifyStep) => void;
  tokens: TokenDescriptor[];
  testId: string;
}

export function NotifyConfig({ step, onChange, tokens, testId }: NotifyConfigProps) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-caption font-medium text-muted-foreground">Message</span>
      <ChipField
        value={step.message}
        onChange={(message) => onChange({ ...step, message })}
        tokens={tokens}
        placeholder="What should the notification say?"
        multiline
        minHeight={48}
        testId={`${testId}-message`}
      />
      <span className="text-caption text-muted-foreground">
        Links to the run and any chat it created are added automatically.
      </span>
      <MoreOptions testId={`${testId}-more`}>
        <FailureToggle
          keepGoing={!!step.keepGoing}
          onChange={(keepGoing) => onChange({ ...step, keepGoing })}
          testId={`${testId}-keepgoing`}
        />
      </MoreOptions>
    </div>
  );
}
