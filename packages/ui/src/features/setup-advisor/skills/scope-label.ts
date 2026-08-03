/**
 * Where an install lands, in the user's terms rather than the CLI's. "Global"
 * is the CLI's word for the home directory; what it means to the person
 * choosing is that every project gets the skill.
 */
import type { SkillsCliScope } from '@qlan-ro/mainframe-types';

export const SCOPE_LABEL: Record<SkillsCliScope, string> = {
  project: 'This project',
  global: 'All projects',
};
