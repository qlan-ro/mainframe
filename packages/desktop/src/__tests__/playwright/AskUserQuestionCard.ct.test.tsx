import { test, expect } from '@playwright/experimental-ct-react';
import React from 'react';
import { AskUserQuestionCard } from '../../renderer/components/chat/AskUserQuestionCard.js';
import type { ControlRequest } from '@mainframe/types';

function makeRequest(): ControlRequest {
  return {
    requestId: 'req-1',
    toolName: 'AskUserQuestion',
    toolUseId: 'tu-1',
    input: {
      questions: [
        {
          question: 'Which framework should we use?',
          header: 'Framework',
          options: [
            { label: 'React', description: 'Component model' },
            { label: 'Vue', description: 'Progressive framework' },
          ],
          multiSelect: false,
        },
      ],
    },
    suggestions: [],
  };
}

test('renders the question text and options', async ({ mount }) => {
  const component = await mount(<AskUserQuestionCard request={makeRequest()} onRespond={() => {}} />);

  await expect(component.getByText('Which framework should we use?')).toBeVisible();
  await expect(component.getByText('React')).toBeVisible();
  await expect(component.getByText('Vue')).toBeVisible();
});

test('submit is disabled until option selected', async ({ mount }) => {
  const component = await mount(<AskUserQuestionCard request={makeRequest()} onRespond={() => {}} />);

  // The Submit button should be disabled before any selection
  await expect(component.getByRole('button', { name: /submit/i })).toBeDisabled();
});

test('submit becomes enabled after selection', async ({ mount }) => {
  const component = await mount(<AskUserQuestionCard request={makeRequest()} onRespond={() => {}} />);

  await component.getByText('React').click();
  await expect(component.getByRole('button', { name: /submit/i })).not.toBeDisabled();
});

test('calls onRespond with selected answer on submit', async ({ mount }) => {
  let capturedBehavior: string | undefined;
  let capturedInput: Record<string, unknown> | undefined;

  const component = await mount(
    <AskUserQuestionCard
      request={makeRequest()}
      onRespond={(behavior, _alwaysAllow, overrideInput) => {
        capturedBehavior = behavior;
        capturedInput = overrideInput;
      }}
    />,
  );

  await component.getByText('Vue').click();
  await component.getByRole('button', { name: /submit/i }).click();

  expect(capturedBehavior).toBe('allow');
  expect(capturedInput).toBeDefined();
});
