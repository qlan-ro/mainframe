/**
 * The v2 scale lab — what verifies the token layer landed. V2Lab owns the theme
 * attributes; this view is the measurements.
 */
import { FormSpecimen } from './FormSpecimen';
import { SpacingScale } from './SpacingScale';
import { TypeScale } from './TypeScale';

export function ScaleLab() {
  return (
    <div className="min-h-full bg-mf-window px-8 py-6">
      <div className="mx-auto flex max-w-[1100px] flex-col gap-8">
        <header className="flex flex-col gap-2">
          <h1 className="text-title font-bold">Mainframe v2 — scale</h1>
          <p className="max-w-[70ch] text-body text-muted-foreground">
            Colours, radii, shadows and the three schemes are imported from the shipped stylesheet and unchanged. Only
            spacing and type differ, and both are measured below rather than asserted.
          </p>
        </header>

        <SpacingScale />
        <TypeScale />
        <FormSpecimen />
      </div>
    </div>
  );
}
