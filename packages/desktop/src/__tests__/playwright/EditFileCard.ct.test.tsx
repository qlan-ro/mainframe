import { test, expect } from '@playwright/experimental-ct-react';
import React from 'react';
import { EditFileCard } from '../../renderer/components/chat/assistant-ui/parts/tools/EditFileCard.js';

test('renders shortened filename in header', async ({ mount }) => {
  // shortFilename('src/components/Button.tsx') → 'components/Button.tsx' (parts.length > 2)
  const component = await mount(
    <EditFileCard
      args={{ file_path: 'src/components/Button.tsx', old_string: 'old', new_string: 'new' }}
      result={undefined}
      isError={undefined}
    />,
  );
  await expect(component.getByText('components/Button.tsx')).toBeVisible();
});

test('renders animate-pulse element in DOM while result is pending', async ({ mount }) => {
  const component = await mount(
    <EditFileCard
      args={{ file_path: 'src/index.ts', old_string: '', new_string: 'new code' }}
      result={undefined}
      isError={undefined}
    />,
  );
  // StatusDot renders an animate-pulse span when result is undefined
  await expect(component.locator('.animate-pulse')).toBeAttached();
});

test('shows diff content after clicking header to expand', async ({ mount }) => {
  const component = await mount(
    <EditFileCard
      args={{ file_path: 'src/components/Button.tsx', old_string: 'oldCode', new_string: 'newCode' }}
      result={undefined}
      isError={undefined}
    />,
  );
  // Click CollapsibleToolCard button to expand and reveal diff
  await component.locator('button').first().click();
  // DiffFallback renders the old and new strings as lines
  await expect(component.getByText('oldCode')).toBeVisible();
  await expect(component.getByText('newCode')).toBeVisible();
});
