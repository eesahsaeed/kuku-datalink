import React from 'react';
import classNames from 'classnames';
import { Button } from 'components/ui/primitives';

export default function NINEMOBILE({
  handleNetworkChange,
  network,
  isLoading = false,
}) {
  return (
    <Button
      tag="label"
      className={classNames('btn-simple network-btn', {
        active: network === '9mobile',
        'is-loading': isLoading,
      })}
      color="info"
      size="sm"
      style={{ position: 'relative' }}
      aria-busy={isLoading}
      onClick={() => handleNetworkChange('9mobile')}
    >
      {!isLoading && <img src={'/img/t2mobile.png'} alt="t2-logo" />}
      {isLoading && (
        <span
          className="d-inline-flex align-items-center justify-content-center flex-column gap-1"
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: 12,
            zIndex: 2,
            background: 'rgba(100, 116, 139, 0.45)',
            pointerEvents: 'none',
          }}
        >
          <span className="spinner-border spinner-border-sm text-light" />
          <span className="small text-light fw-semibold">
            Loading 9mobile...
          </span>
        </span>
      )}
    </Button>
  );
}
