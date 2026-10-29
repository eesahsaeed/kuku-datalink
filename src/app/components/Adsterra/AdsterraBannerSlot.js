import React from 'react';

import { getAdsterraConfig, isAdsterraEnabled } from 'utils/adsterra';

export default function AdsterraBannerSlot({
  className = '',
  minHeight,
  slotName = 'banner',
  variant = 'iframe',
}) {
  const containerRef = React.useRef(null);
  const adsterraConfig = React.useMemo(() => getAdsterraConfig(), []);
  const effectiveMinHeight = React.useMemo(() => {
    if (Number.isFinite(Number(minHeight)) && Number(minHeight) > 0) {
      return Number(minHeight);
    }

    if (variant === 'iframe') {
      return Number(adsterraConfig.iframeAdOptions?.height || 60) + 24;
    }

    return 90;
  }, [adsterraConfig.iframeAdOptions?.height, minHeight, variant]);

  React.useEffect(() => {
    if (!isAdsterraEnabled()) return undefined;
    if (!containerRef.current) return undefined;

    const container = containerRef.current;
    container.innerHTML = '';

    let script = null;
    let slotElement = null;

    if (variant === 'iframe') {
      if (!adsterraConfig.iframeScriptUrl) return undefined;

      window.atOptions = {
        ...(adsterraConfig.iframeAdOptions || {}),
      };

      script = document.createElement('script');
      script.type = 'text/javascript';
      script.async = true;
      script.src = adsterraConfig.iframeScriptUrl;
      script.setAttribute('data-adsterra-slot', `${slotName}-iframe`);
      container.appendChild(script);
    } else {
      if (!adsterraConfig.containerScriptUrl || !adsterraConfig.containerId) {
        return undefined;
      }

      slotElement = document.createElement('div');
      slotElement.id = adsterraConfig.containerId;
      container.appendChild(slotElement);

      script = document.createElement('script');
      script.type = 'text/javascript';
      script.async = true;
      script.src = adsterraConfig.containerScriptUrl;
      script.setAttribute('data-adsterra-slot', `${slotName}-container`);
      script.setAttribute('data-cfasync', 'false');
      container.appendChild(script);
    }

    return () => {
      if (script && container.contains(script)) {
        container.removeChild(script);
      }
      if (slotElement && container.contains(slotElement)) {
        container.removeChild(slotElement);
      }
      container.innerHTML = '';
    };
  }, [
    adsterraConfig.containerId,
    adsterraConfig.containerScriptUrl,
    adsterraConfig.iframeAdOptions,
    adsterraConfig.iframeScriptUrl,
    slotName,
    variant,
  ]);

  if (!isAdsterraEnabled()) {
    return null;
  }

  if (variant === 'iframe' && !adsterraConfig.iframeScriptUrl) {
    return null;
  }

  if (
    variant !== 'iframe' &&
    (!adsterraConfig.containerScriptUrl || !adsterraConfig.containerId)
  ) {
    return null;
  }

  return (
    <div
      className={`adsterra-banner-slot ${className}`.trim()}
      style={{
        minHeight: effectiveMinHeight,
        border: '1px solid rgba(8, 27, 58, 0.08)',
        borderRadius: 20,
        padding: 12,
        background:
          'linear-gradient(180deg, rgba(255,255,255,0.98) 0%, rgba(244,248,255,0.96) 100%)',
        boxShadow: '0 14px 30px rgba(8, 27, 58, 0.05)',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: 0.6,
          textTransform: 'uppercase',
          color: '#64748B',
          marginBottom: 8,
        }}
      >
        Sponsored
      </div>
      <div
        ref={containerRef}
        style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          width: '100%',
        }}
      />
    </div>
  );
}
