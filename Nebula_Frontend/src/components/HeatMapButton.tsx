import { useState } from 'react';
import { useGraphStore } from '../store/useGraphStore';
import { HealthHeatmap } from './HealthHeatmap';
import HeatmapModal from './HeatmapModal';

export function HeatmapButton() {
  const [open, setOpen] = useState(false);
  const analysisId = useGraphStore((state) => state.analysisId);
  const focusNode = useGraphStore((state) => state.focusNode);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={!analysisId}
        className="analyze-button heatmap-trigger-button"
        aria-haspopup="dialog"
      >
        Heatmap
      </button>
      <HeatmapModal open={open} onClose={() => setOpen(false)}>
        <HealthHeatmap onSelectFile={(fileId) => {
          focusNode(fileId);
          setOpen(false);
        }} />
      </HeatmapModal>
    </>
  );
}
