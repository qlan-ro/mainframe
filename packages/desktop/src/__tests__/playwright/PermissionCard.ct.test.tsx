import { test, expect } from '@playwright/experimental-ct-react';
import React from 'react';
import { PermissionCard } from '../../renderer/components/chat/PermissionCard.js';
import type { PermissionRequest } from '@mainframe/types';

const request: PermissionRequest = {
  requestId: 'req-1',
  toolName: 'Bash',
  toolUseId: 'tu-1',
  input: { command: 'rm -rf /tmp/test' },
  suggestions: [],
};

test('renders permission card with tool name and action buttons', async ({ mount }) => {
  const component = await mount(<PermissionCard request={request} onRespond={() => {}} />);

  await expect(component.getByText('Permission Required')).toBeVisible();
  await expect(component.getByText('Bash')).toBeVisible();
  await expect(component.getByRole('button', { name: /allow once/i })).toBeVisible();
  await expect(component.getByRole('button', { name: /deny/i })).toBeVisible();
});

test('calls onRespond with allow when Allow Once is clicked', async ({ mount }) => {
  let respondArg: string | undefined;
  const component = await mount(
    <PermissionCard
      request={request}
      onRespond={(behavior) => {
        respondArg = behavior;
      }}
    />,
  );

  await component.getByRole('button', { name: /allow once/i }).click();
  expect(respondArg).toBe('allow');
});

test('calls onRespond with deny when Deny is clicked', async ({ mount }) => {
  let respondArg: string | undefined;
  const component = await mount(
    <PermissionCard
      request={request}
      onRespond={(behavior) => {
        respondArg = behavior;
      }}
    />,
  );

  await component.getByRole('button', { name: /deny/i }).click();
  expect(respondArg).toBe('deny');
});

test('expands details section on click and shows input', async ({ mount }) => {
  const component = await mount(<PermissionCard request={request} onRespond={() => {}} />);

  // Details section is collapsed initially; clicking the button expands it
  await component.getByText('Details').click();
  // The input is JSON-stringified inside a <pre>
  await expect(component.getByText(/rm -rf/)).toBeVisible();
});
