import React from 'react';
import { Spinner } from 'components/ui/primitives';

function Loading({ size = 150, label = 'Loading...' }) {
  const spinnerSize =
    typeof size === 'number' && Number.isFinite(size) ? `${size}px` : size;

  return (
    <div className="loading-container" role="status" aria-live="polite">
      <div className="d-flex flex-column align-items-center gap-2">
        <Spinner
          className="loading-spinner"
          style={{ width: spinnerSize, height: spinnerSize }}
          aria-label="Loading Spinner"
          data-testid="loader"
        />
        <span className="loading-label">{label}</span>
      </div>
    </div>
  );
}

export default Loading;
