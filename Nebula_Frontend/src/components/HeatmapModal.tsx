
import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import './HeatmapModal.css';

interface HeatmapModalProps {
  open: boolean;
  onClose: () => void;
  children?: ReactNode;
}

export default function HeatmapModal({
  open,
  onClose,
  children,
}: HeatmapModalProps) {
  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal((
    <div
      className="heatmap-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="heatmap-modal-title"
        className="heatmap-dialog"
      >
        {/* Header */}
        <div className="heatmap-dialog-header">
          <div>
            <h2
              id="heatmap-modal-title"
              className="heatmap-dialog-title"
            >
              Churn vs. Complexity
            </h2>

            <p className="heatmap-dialog-subtitle">
              Find fragile files and technical-debt hotspots.
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close heatmap"
            title="Close (Esc)"
            className="heatmap-close"
          >
            ×
          </button>
        </div>

        {/* Heatmap content */}
        <div className="heatmap-dialog-content">
          {children}
        </div>
      </div>
    </div>
  ), document.body);
}
