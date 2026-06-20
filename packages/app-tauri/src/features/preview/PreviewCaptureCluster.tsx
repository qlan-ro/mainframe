import { ArrowUp, Crosshair, Camera, Frame } from 'lucide-react';
import { PreviewIconButton } from './PreviewIconButton';

interface PreviewCaptureClusterProps {
  isRunning: boolean;
  inspectActive: boolean;
  regionActive: boolean;
  onCaptureClick: () => void;
  onRegionClick: () => void;
  onInspectClick: () => void;
}

export function PreviewCaptureCluster({
  isRunning,
  inspectActive,
  regionActive,
  onCaptureClick,
  onRegionClick,
  onInspectClick,
}: PreviewCaptureClusterProps) {
  return (
    <div
      data-testid="preview-capture-cluster"
      className={`flex items-center gap-px py-px pl-[7px] pr-[4px] rounded-md flex-shrink-0 ${
        isRunning
          ? 'bg-primary/[0.055] border-[0.5px] border-primary/20'
          : 'opacity-40 pointer-events-none'
      }`}
    >
      <ArrowUp size={9} strokeWidth={2.4} className="text-primary" />
      <span className="text-micro font-bold text-primary uppercase [letter-spacing:0.3px] mr-0.5">
        Chat
      </span>
      <PreviewIconButton
        testId="preview-toolbar-inspect"
        title="Inspect element"
        onClick={onInspectClick}
        active={inspectActive}
        className="w-[24px]"
      >
        <Crosshair size={13} />
      </PreviewIconButton>
      <PreviewIconButton
        testId="preview-toolbar-capture"
        title="Capture screenshot"
        onClick={onCaptureClick}
        className="w-[24px]"
      >
        <Camera size={13} />
      </PreviewIconButton>
      <PreviewIconButton
        testId="preview-toolbar-region"
        title="Capture region"
        onClick={onRegionClick}
        active={regionActive}
        className="w-[24px]"
      >
        <Frame size={13} />
      </PreviewIconButton>
    </div>
  );
}
