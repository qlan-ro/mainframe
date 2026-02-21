import { test, expect } from '@playwright/experimental-ct-react';
import React from 'react';
import { BashCard } from '../../renderer/components/chat/assistant-ui/parts/tools/BashCard.js';

test('renders command in the collapsible header', async ({ mount }) => {
  const component = await mount(
    <BashCard args={{ command: 'npm run build' }} result={undefined} isError={undefined} />,
  );
  await expect(component.getByText('npm run build')).toBeVisible();
});

test('renders animate-pulse element in DOM when result is undefined', async ({ mount }) => {
  const component = await mount(<BashCard args={{ command: 'sleep 10' }} result={undefined} isError={undefined} />);
  // StatusDot renders a span with animate-pulse class when result is undefined
  await expect(component.locator('.animate-pulse')).toBeAttached();
});

test('shows command in expanded output after clicking header', async ({ mount }) => {
  const component = await mount(<BashCard args={{ command: 'echo hello' }} result="hello\n" isError={false} />);
  // CollapsibleToolCard starts collapsed; click the button to expand
  await component.locator('button').first().click();
  // After expansion, the full command is shown in <pre>$ {command}</pre>
  await expect(component.getByText(/\$ echo hello/)).toBeVisible();
});

test('does not render animate-pulse element when result is available', async ({ mount }) => {
  const component = await mount(<BashCard args={{ command: 'ls' }} result="file.txt\n" isError={false} />);
  await expect(component.locator('.animate-pulse')).not.toBeAttached();
});
