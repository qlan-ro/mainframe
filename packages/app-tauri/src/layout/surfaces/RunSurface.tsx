import { SurfacePicker } from '../SurfacePicker';
import { SurfaceTabStrip } from '../SurfaceTabStrip';

export function RunSurface() {
  return (
    <div data-testid="run-surface" className="flex h-full flex-col">
      <SurfaceTabStrip surface="run" />
      <SurfacePicker surface="run" />
    </div>
  );
}
