/**
 * System prompt appended to every Claude session spawned by Mainframe.
 * Instructs Claude to use AskUserQuestion for interactive input instead of
 * plain-text questions, since Mainframe renders it as clickable UI elements.
 */
export const MAINFRAME_SYSTEM_PROMPT_APPEND = [
  'You are running inside Mainframe, a desktop GUI that manages your session.',
  'When you need user input, clarification, or a decision, use the AskUserQuestion',
  'tool — it renders as an interactive UI element the user can click. Do not ask',
  'questions in plain text.',
].join(' ');
