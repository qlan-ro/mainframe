export const regions = {
  transcript: ['#thread', '[data-testid=chat-thread-viewport]'],
  sidebar: ['#side', '[data-slot=sidebar]'],
  strip: ['#actstrip', '[data-testid=composer-activity-strip]'],
  panel: ['#spanel', '[data-testid=session-panel]'],
};

export const textMasks = [
  { region: 'transcript', side: 0, text: 'fetched 1 page, called GitHub, read 1 file, 2 more', reason: 'T1: folded summaries keep the app’s category order and counts.' },
  { region: 'transcript', side: 1, text: 'read 1 file, searched 1 pattern, fetched 1 page, 2 more', reason: 'T1: folded summaries keep the app’s category order and counts.' },
  { region: 'transcript', side: 0, text: 'Switched to Mock CLI B · earlier context carried over', reason: 'T1: provider switches retain the app’s handoff wording.' },
  { region: 'transcript', side: 1, text: 'Switched to Mock CLI B · context handed off (3 items)', reason: 'T1: provider switches retain the app’s handoff wording.' },
  { region: 'transcript', side: 1, text: '3 running tasks', reason: 'Owner ruling: retain the original running-task summary.' },
];
