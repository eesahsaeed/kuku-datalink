import React, { useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Route, Routes, Navigate } from 'react-router-dom';
import { Toaster } from 'sonner';
import axios from 'axios';

import AdminLayout from './layouts/Admin/Admin.js';
import CustomerLayout from './layouts/Customer/CustomerLayout.js';

import E404 from './views/E404.js';

import './assets/scss/kuku-dashboard.scss';
import './assets/css/styles.css';
import './assets/css/react-aria-compat.css';
import './assets/css/nucleo-icons.css';

import 'bootstrap/dist/css/bootstrap.min.css';
import '@fortawesome/fontawesome-free/css/all.min.css';

import ThemeContextWrapper from './components/ThemeWrapper/ThemeWrapper.js';
import BackgroundColorWrapper from './components/BackgroundColorWrapper/BackgroundColorWrapper.js';
import { SocketProvider } from './contexts/SocketContext.js';
import {
  getUser,
  replaceAllDataDetails,
  updateUser,
} from '../lib/helper';
import Signup from 'views/Signup.js';
import Signin from 'views/Signin.js';
import ConfirmAccount from 'views/ConfirmAccount.js';
import ConfirmEmail from 'views/ConfirmEmail.js';
import ConfirmEmailLanding from 'views/ConfirmEmailLanding.js';
import SetupPin from 'views/SetupPin.js';
import ForgotPassword from 'views/ForgotPassword.js';
import ForgotPin from 'views/ForgotPin.js';
import ResetPasswordLanding from 'views/ResetPasswordLanding.js';
import ResetPassword from 'views/ResetPassword.js';
import ResetPinLanding from 'views/ResetPinLanding.js';
import ResetPin from 'views/ResetPin.js';
import PrivacyPolicy from 'PrivacyPolicy.js';
import TermsOfService from 'TermsOfService.js';

const LIVE_BACKEND_URL = 'https://kuku-ahjz.onrender.com';

const normalizeBaseUrl = (value = '') =>
  String(value || '')
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/api$/i, '');

const resolveApiBaseUrl = () => {
  const configuredBaseUrl = normalizeBaseUrl(
    import.meta.env.VITE_API_BASE_URL || import.meta.env.VITE_BACKEND_URL
  );
  if (configuredBaseUrl) {
    return configuredBaseUrl;
  }

  const hostname = String(window?.location?.hostname || '').toLowerCase();
  const isLocalHost = hostname === 'localhost' || hostname === '127.0.0.1';

  return isLocalHost ? '' : LIVE_BACKEND_URL;
};

const apiBaseUrl = resolveApiBaseUrl();
if (apiBaseUrl) {
  axios.defaults.baseURL = apiBaseUrl;
}

const PLAN_DETAILS_UPDATE_EVENT = 'kuku-plan-details-updated';
const PLAN_DETAILS_UPDATE_STORAGE_KEY = 'kuku-plan-details-updated';

async function hydrateDataDetailsFromApi() {
  try {
    const response = await axios.get('/api/purchase/catalog/data-details', {
      timeout: 30000,
    });
    const remoteDataDetails = response?.data?.data;

    if (
      remoteDataDetails &&
      typeof remoteDataDetails === 'object' &&
      !Array.isArray(remoteDataDetails)
    ) {
      replaceAllDataDetails(remoteDataDetails);
    }
  } catch (error) {
    console.warn('[aidapay] Failed to hydrate live data details:', error?.message);
  }
}

function AidapayDataDetailsBootstrap() {
  useEffect(() => {
    let cancelled = false;

    const hydrateAndSync = async () => {
      if (cancelled) {
        return;
      }

      await hydrateDataDetailsFromApi();
    };

    const handlePlanDetailsUpdate = () => {
      void hydrateAndSync();
    };

    const handleStorageUpdate = (event) => {
      if (event?.key === PLAN_DETAILS_UPDATE_STORAGE_KEY) {
        void hydrateAndSync();
      }
    };

    hydrateAndSync();
    window.addEventListener(PLAN_DETAILS_UPDATE_EVENT, handlePlanDetailsUpdate);
    window.addEventListener('storage', handleStorageUpdate);

    return () => {
      cancelled = true;
      window.removeEventListener(PLAN_DETAILS_UPDATE_EVENT, handlePlanDetailsUpdate);
      window.removeEventListener('storage', handleStorageUpdate);
    };
  }, []);

  return null;
}

function UserSessionBootstrap() {
  useEffect(() => {
    let cancelled = false;
    const currentUser = getUser();
    const token = currentUser?.token;

    if (!token) return undefined;

    const refreshUser = async () => {
      try {
        const response = await axios.get('/api/authentication/me', {
          headers: { Authorization: `Bearer ${token}` },
          timeout: 15000,
        });

        if (cancelled || !response?.data?.user) return;

        updateUser({
          ...response.data.user,
          token,
          isAuthenticated: true,
          lastActive: new Date().toISOString(),
        });
      } catch (error) {
        // Keep the cached session available when the app opens offline.
        console.warn('[auth] Failed to refresh user session:', error?.message);
      }
    };

    void refreshUser();

    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}

const root = ReactDOM.createRoot(document.getElementById('root'));

root.render(
  <>
    <ThemeContextWrapper>
      <BackgroundColorWrapper>
        <SocketProvider>
          <UserSessionBootstrap />
          <AidapayDataDetailsBootstrap />
          <BrowserRouter
            future={{
              v7_startTransition: true,
              v7_relativeSplatPath: true,
            }}
          >
            <Routes>
            <Route path="/*" element={<CustomerLayout />} />
            <Route path="/admin/*" element={<AdminLayout />} />
            <Route path="error" element={<E404 />} />
            <Route path="signup" element={<Signup />} />
            <Route path="signin" element={<Signin />} />
            <Route path="confirm-account" element={<ConfirmAccount />} />
            <Route path="confirm-email/:token" element={<ConfirmEmail />} />
            <Route
              path="open-confirm-email/:token"
              element={<ConfirmEmailLanding />}
            />
            <Route path="setup-pin" element={<SetupPin />} />
            <Route path="forgot-password" element={<ForgotPassword />} />
            <Route path="forgot-pin" element={<ForgotPin />} />
            <Route
              path="open-reset/:token"
              element={<ResetPasswordLanding />}
            />
            <Route path="reset-password/:token" element={<ResetPassword />} />
            <Route path="open-reset-pin/:token" element={<ResetPinLanding />} />
            <Route path="reset-pin/:token" element={<ResetPin />} />
            <Route path="privacy-policy" element={<PrivacyPolicy />} />
            <Route path="terms-of-service" element={<TermsOfService />} />
            <Route path="*" element={<Navigate to="/error" replace />} />
            </Routes>
          </BrowserRouter>
        </SocketProvider>
      </BackgroundColorWrapper>
    </ThemeContextWrapper>
    <Toaster />
  </>
);
