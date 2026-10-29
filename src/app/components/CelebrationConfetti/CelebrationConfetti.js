import React from 'react';
import Confetti from 'react-confetti';

const getViewport = () => {
  if (typeof window === 'undefined') {
    return { width: 0, height: 0 };
  }

  return {
    width: window.innerWidth,
    height: window.innerHeight,
  };
};

function CelebrationConfetti({
  active = false,
  durationMs = 3200,
  onComplete,
}) {
  const [viewport, setViewport] = React.useState(getViewport);

  React.useEffect(() => {
    if (!active || typeof window === 'undefined') {
      return undefined;
    }

    let frameId = 0;

    const updateViewport = () => {
      setViewport(getViewport());
    };

    const handleResize = () => {
      window.cancelAnimationFrame(frameId);
      frameId = window.requestAnimationFrame(updateViewport);
    };

    updateViewport();
    window.addEventListener('resize', handleResize, { passive: true });

    return () => {
      window.removeEventListener('resize', handleResize);
      window.cancelAnimationFrame(frameId);
    };
  }, [active]);

  React.useEffect(() => {
    if (!active || !onComplete || typeof window === 'undefined') {
      return undefined;
    }

    const timerId = window.setTimeout(() => {
      onComplete();
    }, durationMs);

    return () => window.clearTimeout(timerId);
  }, [active, durationMs, onComplete]);

  if (!active || !viewport.width || !viewport.height) {
    return null;
  }

  const isMobile = viewport.width < 768;

  return (
    <Confetti
      width={viewport.width}
      height={viewport.height}
      recycle={false}
      numberOfPieces={isMobile ? 90 : 180}
      gravity={isMobile ? 0.32 : 0.24}
      initialVelocityX={{ min: -10, max: 10 }}
      initialVelocityY={{ min: 12, max: 24 }}
      tweenDuration={isMobile ? 220 : 280}
      style={{
        position: 'fixed',
        pointerEvents: 'none',
        top: 0,
        left: 0,
        zIndex: 20000,
      }}
    />
  );
}

export default CelebrationConfetti;
