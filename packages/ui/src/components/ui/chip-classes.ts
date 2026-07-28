/**
 * The toolbar chip recipe, shared rather than restated.
 *
 * `MainToolbar`'s branch chips and the setup advisor's skill-scope chips are the
 * same pill; two other chip constants in the package (`TagFilterBar`,
 * automations' `ChipButton`) are deliberately different recipes and do not
 * belong here.
 */
export const CHIP_BASE =
  'inline-flex h-[22px] min-w-0 max-w-[230px] items-center gap-[5px] rounded-[6px] border-[0.5px] border-solid px-[6px] font-mono text-label font-normal';
