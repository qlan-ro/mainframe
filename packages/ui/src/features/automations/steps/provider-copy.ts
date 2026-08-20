/**
 * Per-provider display name and paste-field copy for `TokenCredentialField`.
 * `service` (the storage label the daemon uses — `notion`/`ado`) is
 * lowercase and never shown verbatim; this is the one place that maps it to
 * a human name and, where the connector is manual on purpose, explains why.
 */
export interface ProviderCopy {
  displayName: string;
  /** Absent for a provider with no story to tell (e.g. a generic `http.request` credential) — the field renders with no explanatory paragraph. */
  description?: string;
  linkLabel?: string;
  linkHref?: string;
}

export const PROVIDER_COPY: Record<string, ProviderCopy> = {
  github: {
    displayName: 'GitHub',
    description:
      'Needs a personal access token that can create and list pull requests — classic tokens need the repo scope; fine-grained tokens need Contents: Read and write and Pull requests: Read and write.',
    linkLabel: 'Create a GitHub personal access token',
    linkHref: 'https://github.com/settings/tokens',
  },
  notion: {
    displayName: 'Notion',
    description:
      "Notion's API needs a server-side secret we can't ship, so this is a manual step: create an internal integration and paste its token.",
    linkLabel: 'Create a Notion internal integration',
    linkHref: 'https://www.notion.so/my-integrations',
  },
  ado: {
    displayName: 'Azure DevOps',
    description:
      'Paste an organization-scoped personal access token, scoped to the organization named above. Microsoft stops issuing global PATs on 2026-03-15 and decommissions them on 2026-12-01 — organization-scoped tokens are unaffected.',
    linkLabel: 'Create an Azure DevOps personal access token',
    linkHref:
      'https://learn.microsoft.com/en-us/azure/devops/organizations/accounts/use-personal-access-tokens-to-authenticate',
  },
};

export function providerDisplayName(service: string): string {
  return PROVIDER_COPY[service]?.displayName ?? service;
}
