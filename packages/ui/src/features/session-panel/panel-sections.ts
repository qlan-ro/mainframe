import { SESSION_PANEL_SECTION_KEYS, type SessionPanelSectionKey } from '@/store/ui-prefs';

export const SECTION_LABEL: Record<SessionPanelSectionKey, string> = {
  prs: 'Pull requests',
  plan: 'Plan',
  activity: 'Activity',
  launch: 'Launch',
  memory: 'Memory files',
  mentions: 'Mentioned files',
  skills: 'Skills',
  attachments: 'Attachments',
  tasks: 'Project tasks',
};

/** What belongs to the project rather than to a session, so it shows before the first message too. */
const PROJECT_SECTIONS: ReadonlySet<SessionPanelSectionKey> = new Set(['memory', 'skills', 'tasks']);

/** The sections the panel may draw, in order. `started` is false until the first message creates the chat. */
export function visibleSections(hidden: readonly SessionPanelSectionKey[], started: boolean): SessionPanelSectionKey[] {
  return SESSION_PANEL_SECTION_KEYS.filter((key) => !hidden.includes(key) && (started || PROJECT_SECTIONS.has(key)));
}
