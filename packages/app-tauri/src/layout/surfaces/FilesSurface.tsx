import { SurfacePicker } from '../SurfacePicker';
import { SurfaceTabStrip } from '../SurfaceTabStrip';

export function FilesSurface() {
  return (
    <div data-testid="files-surface" className="flex h-full flex-col">
      <SurfaceTabStrip surface="files" />
      <SurfacePicker surface="files" />
    </div>
  );
}
