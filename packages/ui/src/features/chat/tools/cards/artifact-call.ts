/**
 * artifact-call — what a Claude `Artifact` tool call did, read from its args and
 * the CLI's result text.
 *
 * The result is prose written for the model (the create result runs to ~48 KB and
 * embeds the type's instructions), so the card shows none of it on success. Its
 * only use here is the artifact's address, which a first publish doesn't know
 * until the CLI reports it: "Created a new Artifact at <url>", "Published <path>
 * at <url>" or "Updated the Artifact at <url>". A create result also names the
 * type's own artifact URL, hence the `type_url` exclusion.
 */
import { isArtifactUrl } from '@/features/artifacts/artifact-url';

const ARTIFACT_URL = /https:\/\/claude\.ai\/artifact\/[A-Za-z0-9_-]+/g;
const PUBLISH_ACTION = 'publish';

export interface ArtifactCall {
  verb: string;
  /** What the card shows: the title when the call has one, else the URL slug. */
  label: string;
  /** Set once the call names a specific artifact the user can open. */
  url: string | null;
  /** Whether this call changes the artifact, so views of it go stale. */
  publishes: boolean;
  /** Whether the result text is meant for the user, not only for the model. */
  showResult: boolean;
}

function stringArg(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function publishedUrl(resultText: string, typeUrl: string | undefined): string | null {
  for (const match of resultText.matchAll(ARTIFACT_URL)) {
    if (match[0] !== typeUrl) return match[0];
  }
  return null;
}

function slugOf(url: string | null): string {
  return url?.slice(url.lastIndexOf('/') + 1) ?? '';
}

export function describeArtifactCall(args: Record<string, unknown>, resultText: string): ArtifactCall {
  const action = stringArg(args, 'action') ?? PUBLISH_ACTION;
  const argUrl = stringArg(args, 'url');
  const typeUrl = stringArg(args, 'type_url');
  const isPublish = action === PUBLISH_ACTION;

  const url = isArtifactUrl(argUrl) ? argUrl : isPublish ? publishedUrl(resultText, typeUrl) : null;
  const verb = isPublish
    ? typeUrl !== undefined && argUrl === undefined
      ? 'Create artifact'
      : 'Publish artifact'
    : `Artifact ${action.replace(/_/g, ' ')}`;

  return {
    verb,
    label: stringArg(args, 'title') ?? slugOf(url),
    url,
    publishes: isPublish,
    showResult: !isPublish && action !== 'quickstart',
  };
}

/**
 * What a permission prompt shows for an `Artifact` call: the request minus the
 * CLI's internal `__artifact*` bookkeeping, which means nothing to the user.
 */
export function artifactPermissionInput(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([key]) => !key.startsWith('__')));
}
