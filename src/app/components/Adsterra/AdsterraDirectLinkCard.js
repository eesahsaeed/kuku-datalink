import React from 'react';
import { toast } from 'sonner';

import {
  getAdsterraConfig,
  isAdsterraEnabled,
  openAdsterraDirectLink,
} from 'utils/adsterra';

export default function AdsterraDirectLinkCard({ className = '' }) {
  const adsterraConfig = React.useMemo(() => getAdsterraConfig(), []);

  if (!isAdsterraEnabled() || !adsterraConfig.directLinkUrl) {
    return null;
  }

  const handleOpen = () => {
    const opened = openAdsterraDirectLink(adsterraConfig.directLinkUrl);
    if (!opened) {
      toast.error(
        'Unable to open sponsored offer. Please allow popups and try again.'
      );
    }
  };

  return (
    <div
      className={`adsterra-direct-link-card ${className}`.trim()}
      style={{
        border: '1px solid rgba(8, 27, 58, 0.08)',
        borderRadius: 20,
        padding: 14,
        background:
          'linear-gradient(135deg, rgba(244,248,255,0.98) 0%, rgba(227,252,246,0.92) 100%)',
        boxShadow: '0 14px 30px rgba(8, 27, 58, 0.05)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
      }}
    >
      <div style={{ display: 'grid', gap: 4 }}>
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: 0.6,
            textTransform: 'uppercase',
            color: '#64748B',
          }}
        >
          Sponsored
        </span>
        <strong style={{ color: '#081B3A', fontSize: 14 }}>
          Adsterra Smart Direct Link
        </strong>
      </div>
      <button
        type="button"
        onClick={handleOpen}
        style={{
          border: 'none',
          borderRadius: 999,
          padding: '10px 16px',
          fontWeight: 700,
          background: '#26D8B6',
          color: '#081B3A',
          cursor: 'pointer',
        }}
      >
        {adsterraConfig.directLinkLabel}
      </button>
    </div>
  );
}
