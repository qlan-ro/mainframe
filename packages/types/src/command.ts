export interface CustomCommand {
  /** Command name without the leading slash */
  name: string;
  /** Short description shown in the popover */
  description: string;
  /** Origin: adapter id (e.g. 'claude') or 'mainframe' */
  source: string;
  /** Mainframe commands only — prompt sent to the model */
  promptTemplate?: string;
}
