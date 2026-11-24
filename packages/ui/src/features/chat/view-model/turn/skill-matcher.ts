/**
 * The CLI loads a skill's text as a message of its own right after the `Skill`
 * call. The call's marker shows that text, so the message is absorbed into it.
 */
import { displayText, record } from './values';
import type { LoadedSkill, TurnUnit } from './types';

const bare = (name: string) => name.replace(/^\//, '').replace(/^.*:/, '');

export class SkillMatcher {
  readonly absorbed = new Set<string>();
  readonly byCall = new Map<string, LoadedSkill>();

  claim(messageId: string, skill: LoadedSkill, units: readonly TurnUnit[]): void {
    const call = [...units]
      .reverse()
      .find(
        ({ part }) =>
          part.type === 'tool-call' &&
          part.toolName === 'Skill' &&
          !this.byCall.has(part.toolCallId) &&
          bare(displayText(record(part.args)?.skill)) === bare(skill.skillName),
      );
    if (call?.part.type !== 'tool-call') return;
    this.byCall.set(call.part.toolCallId, skill);
    this.absorbed.add(messageId);
  }
}
