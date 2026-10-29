import React, { createContext, useContext, useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import {
  getUser,
  updateUser,
  USER_SESSION_UPDATED_EVENT,
} from '../../lib/helper.js';

const LIVE_BACKEND_URL = 'https://kuku-ahjz.onrender.com';
const URL = (
  import.meta.env.VITE_BACKEND_URL ||
  import.meta.env.VITE_API_BASE_URL ||
  LIVE_BACKEND_URL
)
  .trim()
  .replace(/\/+$/, '')
  .replace(/\/api$/i, '');

const SocketContext = createContext(null);

export function SocketProvider({ children }) {
  const [session, setSession] = useState(() => getUser());
  const [socket, setSocket] = useState(null);
  const token = session?.isAuthenticated ? session.token : null;

  useEffect(() => {
    const refreshSession = () => setSession(getUser());
    const refreshFromStorage = (event) => {
      if (event.key === 'user') refreshSession();
    };

    window.addEventListener(USER_SESSION_UPDATED_EVENT, refreshSession);
    window.addEventListener('storage', refreshFromStorage);
    return () => {
      window.removeEventListener(USER_SESSION_UPDATED_EVENT, refreshSession);
      window.removeEventListener('storage', refreshFromStorage);
    };
  }, []);

  useEffect(() => {
    if (!token) {
      setSocket(null);
      return undefined;
    }

    const nextSocket = io(URL, {
      autoConnect: false,
      auth: { token },
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      timeout: 20000,
      transports: ['websocket', 'polling'],
    });

    const syncWalletBalance = (payload = {}) => {
      const nextBalance =
        payload?.newBalance ?? payload?.balance ?? payload?.walletBalance;
      const currentUser = getUser();
      const eventUserId = String(
        payload?.userId || payload?.user?._id || payload?.user?.id || ''
      ).trim();
      const currentUserId = String(
        currentUser?._id || currentUser?.id || ''
      ).trim();

      if (
        nextBalance == null ||
        !Number.isFinite(Number(nextBalance)) ||
        !currentUserId ||
        eventUserId !== currentUserId
      ) {
        return;
      }

      updateUser({
        wallet: {
          ...(currentUser.wallet || {}),
          balance: Number(nextBalance),
        },
      });
    };

    nextSocket.on("demo", payload => {
      console.log(payload)
    })

    nextSocket.on('wallet:updated', syncWalletBalance);
    nextSocket.on('wallet-balance-update', syncWalletBalance);
    nextSocket.on('new-transaction', syncWalletBalance);
    setSocket(nextSocket);
    nextSocket.connect();

    return () => {
      nextSocket.disconnect();
      nextSocket.off('wallet:updated', syncWalletBalance);
      nextSocket.off('wallet-balance-update', syncWalletBalance);
      nextSocket.off('new-transaction', syncWalletBalance);
      setSocket((current) => (current === nextSocket ? null : current));
    };
  }, [token]);

  return (
    <SocketContext.Provider value={socket}>{children}</SocketContext.Provider>
  );
}

export function useSocket() {
  return useContext(SocketContext);
}
