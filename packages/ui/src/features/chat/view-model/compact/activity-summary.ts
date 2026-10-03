import { isExploration } from './activity-label';
import { toolKind } from './tool-kind';
import { normalizedPath } from './file-summary';
import { displayText, record } from './values';
import type { ActivityMember } from './types';

export function activitySummary(members: readonly ActivityMember[]): string {
  const integrations = new Set<string>();
  const paths = new Set<string>();
  let calls = 0,
    unknownFiles = 0,
    commands = 0,
    web = false,
    exploration = false,
    tools = 0;
  for (const { part } of members) {
    if (part.type !== 'tool-call') continue;
    tools++;
    const kind = toolKind(part.toolName);
    if (kind === 'mcp') {
      const name = displayText(part.toolName.split('__')[1]);
      if (name) integrations.add(name);
      else calls++;
    } else if (kind === 'edit' || kind === 'write') {
      const path = normalizedPath(record(part.args)?.file_path);
      if (path) paths.add(path);
      else unknownFiles++;
    } else if (isExploration(part)) exploration = true;
    else if (kind === 'shell') commands++;
    else if (kind === 'web-search' || kind === 'fetch') web = true;
  }
  const files = paths.size + unknownFiles;
  const summaries = [
    ...[...integrations].sort().map((name) => `Used ${name}`),
    ...(calls ? [calls === 1 ? 'Called a tool' : 'Called tools'] : []),
    ...(files ? [files === 1 ? 'Edited a file' : 'Edited files'] : []),
    ...(exploration ? ['Read files'] : []),
    ...(commands ? [commands === 1 ? 'Ran a command' : 'Ran commands'] : []),
    ...(web ? ['Searched the web'] : []),
  ];
  return (
    summaries.map((text, index) => (index === 0 ? text : text.charAt(0).toLowerCase() + text.slice(1))).join(', ') ||
    (members.length && !tools ? 'Thought' : 'Worked')
  );
}
