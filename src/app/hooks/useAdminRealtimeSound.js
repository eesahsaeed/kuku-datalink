import React from 'react';

import { useSocket } from 'contexts/SocketContext';
import notificationSoundUrl from 'assets/sounds/notification.mp3';
import { hasAdminDashboardAccess } from '../utils/adminAccess';

const ADMIN_SOUND_EVENTS = [
  'notification:new',
  'ticket:created',
  'ticket:message',
  'new-transaction',
  'wallet-balance-update',
  'wallet-funding-event-received',
];

const SOUND_THROTTLE_MS = 900;
const ADMIN_SOUND_TEST_EVENT = 'admin:notification-sound-test';

const shouldPlayForEvent = (eventName, payload) => {
  if (eventName === 'ticket:message') {
    return String(payload?.fromType || '').toLowerCase() === 'user';
  }

  return true;
};

export default function useAdminRealtimeSound(user) {
  const socket = useSocket();
  const audioRef = React.useRef(null);
  const unlockedRef = React.useRef(false);
  const lastPlayedAtRef = React.useRef(0);
  const pendingPlayRef = React.useRef(false);

  React.useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    const audio = new Audio(notificationSoundUrl);
    audio.preload = 'auto';
    audio.volume = 0.72;
    audioRef.current = audio;

    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = '';
        audioRef.current = null;
      }
    };
  }, []);

  React.useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    const flushPendingSound = () => {
      if (!pendingPlayRef.current || !audioRef.current || !unlockedRef.current) {
        return;
      }

      pendingPlayRef.current = false;
      audioRef.current.currentTime = 0;
      const playAttempt = audioRef.current.play();
      if (playAttempt?.catch) {
        playAttempt.catch(() => {
          pendingPlayRef.current = true;
        });
      }
    };

    const unlockAudio = () => {
      unlockedRef.current = true;
      flushPendingSound();
      window.removeEventListener('pointerdown', unlockAudio);
      window.removeEventListener('keydown', unlockAudio);
      window.removeEventListener('touchstart', unlockAudio);
    };

    window.addEventListener('pointerdown', unlockAudio, { passive: true });
    window.addEventListener('keydown', unlockAudio);
    window.addEventListener('touchstart', unlockAudio, { passive: true });

    return () => {
      window.removeEventListener('pointerdown', unlockAudio);
      window.removeEventListener('keydown', unlockAudio);
      window.removeEventListener('touchstart', unlockAudio);
    };
  }, []);

  React.useEffect(() => {
    if (!socket || !user?.token || !hasAdminDashboardAccess(user)) {
      return undefined;
    }

    const playSound = () => {
      if (!audioRef.current) {
        return;
      }

      if (!unlockedRef.current) {
        pendingPlayRef.current = true;
        return;
      }

      const now = Date.now();
      if (now - lastPlayedAtRef.current < SOUND_THROTTLE_MS) {
        return;
      }

      pendingPlayRef.current = false;
      lastPlayedAtRef.current = now;
      audioRef.current.currentTime = 0;
      const playAttempt = audioRef.current.play();
      if (playAttempt?.catch) {
        playAttempt.catch(() => {});
      }
    };

    const joinAdminRoom = () => {
      socket.emit('join-admin-room', 'admin-dashboard');
    };

    const handleSoundTest = () => {
      playSound();
    };

    const eventHandlers = ADMIN_SOUND_EVENTS.map((eventName) => {
      const handler = (payload) => {
        if (shouldPlayForEvent(eventName, payload)) {
          playSound();
        }
      };

      socket.on(eventName, handler);
      return [eventName, handler];
    });

    if (socket.connected) {
      joinAdminRoom();
    }

    window.addEventListener(ADMIN_SOUND_TEST_EVENT, handleSoundTest);
    socket.on('connect', joinAdminRoom);

    return () => {
      window.removeEventListener(ADMIN_SOUND_TEST_EVENT, handleSoundTest);
      socket.off('connect', joinAdminRoom);
      eventHandlers.forEach(([eventName, handler]) => {
        socket.off(eventName, handler);
      });
    };
  }, [socket, user?.token, user?.roles, user?.isAdmin]);
}
