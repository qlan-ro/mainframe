/**
 * The fixture strings are trimmed copies of real Claude CLI 2.1.318/2.1.326
 * bundle text, so a pattern change that stops matching the real minified
 * shapes fails here rather than silently emptying a report section.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  changeCount,
  citedIn,
  diffSurfaces,
  emptySurfaceSets,
  extractSurfaces,
  renderBinaryDiff,
} from './surface-extract.mjs';

const OLD_BUNDLE = [
  'var K4o={type:"local",name:"project",description:"Set the claude.ai Project for this session\'s usage reports",isEnabled:()=>wls()};',
  'var LQe={type:"local-jsx",name:"usage",aliases:["cost","stats"]};',
  '.option("--include-partial-messages","Include partial message chunks",()=>!0)',
  '.addOption(new vs("--resume-session-at <message id>","When resuming").argParser(String).hideHelp())',
  'h.sendControlRequest({type:"control_request",request_id:O,request:{subtype:"can_use_tool",tool_name:H}})',
  'isEnabled:()=>!De(process.env.DISABLE_COMPACT),x=process.env["CLAUDE_CODE_TMPDIR"];',
  'autoAllowBashIfSandboxed:I().optional(),allowUnsandboxedCommands:I().optional().describe(`Allow commands`)',
].join('\n');

const NEW_BUNDLE = [
  'var K4o={type:"local",name:"project",description:"Set the claude.ai Project",isEnabled:()=>wls()};',
  '.option("--include-partial-messages","Include partial message chunks",()=>!0)',
  '.option("--trusted-folder <path>","Trust a folder")',
  'h.sendControlRequest({type:"control_request",request:{subtype:"can_use_tool"}});n.request({subtype:"ui_notify"})',
  'isEnabled:()=>!De(process.env.DISABLE_COMPACT),x=process.env["CLAUDE_CODE_TMPDIR"];',
  'set "CLAUDE_CODE_ATTRIBUTION_PROJECT" to override',
  'sandbox:u({autoAllowBashIfSandboxed:I().optional().describe(`Run sandboxed Bash without asking`)',
].join('\n');

function extract(text) {
  return extractSurfaces(text, emptySurfaceSets());
}

test('extracts each surface kind from real minified shapes', () => {
  const sets = extract(OLD_BUNDLE);
  assert.deepEqual([...sets.commands].sort(), ['project', 'usage']);
  assert.deepEqual([...sets.flags].sort(), ['--include-partial-messages', '--resume-session-at']);
  assert.deepEqual([...sets.subtypes], ['can_use_tool']);
  assert.deepEqual([...sets.env].sort(), ['CLAUDE_CODE_TMPDIR', 'DISABLE_COMPACT']);
  assert.deepEqual([...sets.schemaKeys], ['allowUnsandboxedCommands']);
});

test('a bare env name glued to the next string-table entry is not recorded', () => {
  // Bun packs string-table entries back to back; the "6" is the next entry's
  // length byte, not part of the name.
  const sets = extract('\u0001CLAUDE_CODE_ARTIFACT_MCP6\u0002 `CLAUDE_CODE_CLIENT_${e}` "CLAUDE_CODE_ARTIFACT"');
  assert.deepEqual([...sets.env], ['CLAUDE_CODE_ARTIFACT']);
});

test('matches starting at or past the limit are left for the next chunk', () => {
  const text = 'x'.repeat(10) + '.option("--late-flag","x")';
  assert.equal(extractSurfaces(text, emptySurfaceSets(), 10).flags.size, 0);
  assert.deepEqual([...extractSurfaces(text, emptySurfaceSets(), 11).flags], ['--late-flag']);
});

test('diff lists additions and removals per surface, sorted', () => {
  const diff = diffSurfaces(extract(OLD_BUNDLE), extract(NEW_BUNDLE));
  assert.deepEqual(diff.commands, { added: [], removed: ['usage'] });
  assert.deepEqual(diff.flags, { added: ['--trusted-folder'], removed: ['--resume-session-at'] });
  assert.deepEqual(diff.subtypes, { added: ['ui_notify'], removed: [] });
  assert.deepEqual(diff.env, { added: ['CLAUDE_CODE_ATTRIBUTION_PROJECT'], removed: [] });
  assert.deepEqual(diff.schemaKeys, { added: ['autoAllowBashIfSandboxed'], removed: ['allowUnsandboxedCommands'] });
  assert.equal(changeCount(diff), 7);
});

test('citedIn matches whole identifiers only', () => {
  const checklist = 'passes `--resume <id>` and reads `subtype == "can_use_tool"`';
  assert.equal(citedIn('--resume', checklist), true);
  assert.equal(citedIn('can_use_tool', checklist), true);
  assert.equal(citedIn('--resume-session-at', checklist), false);
  assert.equal(citedIn('use_tool', checklist), false);
  assert.equal(citedIn('--resume', ''), false);
});

test('render marks removed items the checklist cites and skips empty surfaces', () => {
  const diff = diffSurfaces(extract(OLD_BUNDLE), extract(NEW_BUNDLE));
  const report = renderBinaryDiff({
    tool: 'claude',
    from: '2.1.318',
    to: '2.1.326',
    diff,
    checklistText: 'The hidden `--resume-session-at` is deliberately not used',
  });
  assert.match(report, /^# Binary surface diff: claude 2\.1\.318 → 2\.1\.326$/m);
  assert.match(report, /^- `--resume-session-at` — \*\*cited by the checklist\*\*$/m);
  assert.match(report, /^- `--trusted-folder`$/m);
  assert.match(report, /^Changes: 7\./m);
});

test('render says so when nothing changed', () => {
  const sets = extract(OLD_BUNDLE);
  const report = renderBinaryDiff({
    tool: 'claude',
    from: 'a',
    to: 'b',
    diff: diffSurfaces(sets, sets),
    checklistText: '',
  });
  assert.match(report, /^No surface changes\.$/m);
  assert.doesNotMatch(report, /^## /m);
});
