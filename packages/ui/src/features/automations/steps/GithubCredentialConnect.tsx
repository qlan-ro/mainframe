/**
 * GithubCredentialConnect — GitHub's `CredentialConnect` branch. Unlike
 * every other provider, GitHub can offer two connect paths: a pasted PAT
 * (always available, like Notion/ADO) and, once a GitHub App client ID is
 * registered, device-flow sign-in as the nicer alternative alongside it.
 * The token path is never hidden behind the nicer one — this restores the
 * only way to authenticate GitHub left after a prior release shipped
 * device-flow-only with no client ID configured (2026-08-19 regression fix).
 */
import { useEffect, useState } from 'react';
import { useAutomationsStore } from '../data/use-automations-store';
import { GithubDeviceConnect } from './GithubDeviceConnect';
import { TokenCredentialField } from './TokenCredentialField';

export interface GithubCredentialConnectProps {
  onChange: (label: string | undefined) => void;
  testId: string;
}

export function GithubCredentialConnect({ onChange, testId }: GithubCredentialConnectProps) {
  const gateway = useAutomationsStore((s) => s.gateway);
  const [deviceFlowConfigured, setDeviceFlowConfigured] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void gateway.githubDeviceFlowStatus().then((status) => {
      if (!cancelled) setDeviceFlowConfigured(status.configured);
    });
    return () => {
      cancelled = true;
    };
  }, [gateway]);

  return (
    <div className="flex flex-col gap-1.5">
      <TokenCredentialField service="github" onChange={onChange} testId={testId} />
      {deviceFlowConfigured && <GithubDeviceConnect onChange={onChange} testId={`${testId}-device`} />}
    </div>
  );
}
