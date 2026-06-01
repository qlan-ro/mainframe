import type { DetectedPr } from '@qlan-ro/mainframe-types';

export const PR_URL_REGEX = /https:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/pull\/(\d+)/;

export const GITLAB_MR_URL_REGEX = /https:\/\/gitlab\.com\/([^/\s]+)\/([^/\s]+)\/-\/merge_requests\/(\d+)/;

export const AZURE_PR_URL_REGEX = /https:\/\/dev\.azure\.com\/([^/\s]+)\/[^/\s]+\/_git\/([^/\s]+)\/pullrequest\/(\d+)/;

const AZURE_PR_ID_REGEX = /"pullRequestId"\s*:\s*(\d+)/;

export const PR_CREATE_COMMANDS: RegExp[] = [
  /\bgh\s+pr\s+create\b/,
  /\bglab\s+mr\s+create\b/,
  /\baz\s+repos\s+pr\s+create\b/,
];

export function isPrCreateCommand(command: string): boolean {
  return PR_CREATE_COMMANDS.some((re) => re.test(command));
}

/** PR info without the `source` field — used as the value shape for stashed mutations and as the parser return type. */
export type DetectedPrCore = Omit<DetectedPr, 'source'>;

export const PR_MUTATION_COMMANDS: RegExp[] = [
  /\bgh\s+pr\s+(edit|ready|merge|close|reopen|comment|review)\b/,
  /\bglab\s+mr\s+(update|merge|close|reopen|note)\b/,
  /\baz\s+repos\s+pr\s+update\b/,
];

export function isPrMutationCommand(command: string): boolean {
  return PR_MUTATION_COMMANDS.some((re) => re.test(command));
}

/**
 * Bash commands whose output may legitimately surface a PR URL we want to attribute
 * to this chat (creates, mutations, and views/lists). Anything else — `cat`, `grep`,
 * `git log` of unrelated history — must NOT trigger Path A, otherwise we tag the chat
 * with PRs that just happen to be mentioned in some file or transcript.
 */
const PR_RELEVANT_BASH_REGEX = /\b(gh\s+pr|glab\s+mr|az\s+repos\s+pr)\b/;

/**
 * Tools whose tool_result we trust to surface PR URLs that belong to this chat.
 * - Bash: gated further by PR_RELEVANT_BASH_REGEX on the originating command.
 * - Agent / Task: subagent dispatch — the parent assistant explicitly delegated work,
 *   so a PR URL in the subagent's final report is attributable to this chat.
 */
export function shouldScanToolResultForPr(meta: { name: string; command?: string } | undefined): boolean {
  if (!meta) return false;
  if (meta.name === 'Bash' || meta.name === 'BashTool') {
    return !!meta.command && PR_RELEVANT_BASH_REGEX.test(meta.command);
  }
  return meta.name === 'Agent' || meta.name === 'Task';
}

const GH_COMPACT_REF_REGEX = /\b([^/\s#]+)\/([^/\s#]+)#(\d+)\b/;

export function parsePrIdentifierFromArgs(command: string): DetectedPrCore | null {
  // Try full URLs first — any of the three existing regexes.
  const fromUrl = extractPrFromToolResult(command);
  if (fromUrl) return fromUrl;

  // gh-only compact syntax: owner/repo#N
  if (/\bgh\s+pr\s+/.test(command)) {
    const match = GH_COMPACT_REF_REGEX.exec(command);
    if (match) {
      const owner = match[1]!;
      const repo = match[2]!;
      const number = parseInt(match[3]!, 10);
      if (owner && repo && !isNaN(number)) {
        return { url: `https://github.com/${owner}/${repo}/pull/${number}`, owner, repo, number };
      }
    }
  }
  return null;
}

export function parsePrUrl(text: string): { url: string; owner: string; repo: string; number: number } | null {
  const match = PR_URL_REGEX.exec(text);
  if (!match) return null;
  const owner = match[1];
  const repo = match[2];
  const number = parseInt(match[3]!, 10);
  if (!owner || !repo || isNaN(number)) return null;
  return { url: match[0], owner, repo, number };
}

export function parseGitlabMrUrl(text: string): { url: string; owner: string; repo: string; number: number } | null {
  const match = GITLAB_MR_URL_REGEX.exec(text);
  if (!match) return null;
  const owner = match[1];
  const repo = match[2];
  const number = parseInt(match[3]!, 10);
  if (!owner || !repo || isNaN(number)) return null;
  return { url: match[0], owner, repo, number };
}

export function parseAzurePrUrl(text: string): { url: string; owner: string; repo: string; number: number } | null {
  const match = AZURE_PR_URL_REGEX.exec(text);
  if (!match) return null;
  const owner = match[1];
  const repo = match[2];
  const number = parseInt(match[3]!, 10);
  if (!owner || !repo || isNaN(number)) return null;
  return { url: match[0], owner, repo, number };
}

function parseAzurePrJson(text: string): { url: string; owner: string; repo: string; number: number } | null {
  const idMatch = AZURE_PR_ID_REGEX.exec(text);
  if (!idMatch) return null;
  const number = parseInt(idMatch[1]!, 10);
  if (isNaN(number)) return null;
  const repoMatch = /"name"\s*:\s*"([^"]+)"/.exec(text);
  const orgMatch = /dev\.azure\.com\/([^/"]+)/.exec(text);
  return {
    url: text.trim(),
    owner: orgMatch?.[1] ?? 'azure',
    repo: repoMatch?.[1] ?? 'unknown',
    number,
  };
}

export function extractPrFromToolResult(
  text: string,
): { url: string; owner: string; repo: string; number: number } | null {
  return parsePrUrl(text) ?? parseGitlabMrUrl(text) ?? parseAzurePrUrl(text) ?? parseAzurePrJson(text);
}
