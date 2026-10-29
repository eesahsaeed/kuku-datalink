import { useCallback, useEffect, useRef, useState } from 'react';

const DEFAULT_GOOGLE_CLIENT_ID =
  '968600140927-c7v3ie8um4qs7qvh0mign2jooa1sco9s.apps.googleusercontent.com';
const GOOGLE_CLIENT_ID =
  import.meta.env.VITE_GOOGLE_CLIENT_ID || DEFAULT_GOOGLE_CLIENT_ID;
const GOOGLE_SCRIPT_ID = 'google-identity-services';
const GOOGLE_SCRIPT_SRC = 'https://accounts.google.com/gsi/client';

function ensureGoogleScript() {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Google Sign-In is not available here.'));
  }

  if (window.google?.accounts?.oauth2) {
    return Promise.resolve(window.google);
  }

  const existingScript = document.getElementById(GOOGLE_SCRIPT_ID);
  if (existingScript) {
    return new Promise((resolve, reject) => {
      existingScript.addEventListener('load', () => resolve(window.google), {
        once: true,
      });
      existingScript.addEventListener(
        'error',
        () => reject(new Error('Failed to load Google Sign-In.')),
        {
          once: true,
        }
      );
    });
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.id = GOOGLE_SCRIPT_ID;
    script.src = GOOGLE_SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve(window.google);
    script.onerror = () => reject(new Error('Failed to load Google Sign-In.'));
    document.head.appendChild(script);
  });
}

export default function useGoogleTokenClient({
  onSuccess,
  onError,
  scope = 'openid profile email',
  prompt = 'select_account',
} = {}) {
  const [isReady, setIsReady] = useState(false);
  const tokenClientRef = useRef(null);
  const successRef = useRef(onSuccess);
  const errorRef = useRef(onError);

  successRef.current = onSuccess;
  errorRef.current = onError;

  useEffect(() => {
    let cancelled = false;

    const initialize = async () => {
      try {
        const google = await ensureGoogleScript();
        if (cancelled || !google?.accounts?.oauth2 || !GOOGLE_CLIENT_ID) {
          return;
        }

        tokenClientRef.current = google.accounts.oauth2.initTokenClient({
          client_id: GOOGLE_CLIENT_ID,
          scope,
          callback: (response = {}) => {
            if (response.error || !response.access_token) {
              errorRef.current?.(
                new Error(
                  response.error_description ||
                    response.error ||
                    'Google did not return an access token.'
                )
              );
              return;
            }

            successRef.current?.(response);
          },
          error_callback: (response = {}) => {
            errorRef.current?.(
              new Error(
                response.error_description ||
                  response.error ||
                  'Google authentication failed.'
              )
            );
          },
        });

        setIsReady(true);
      } catch (error) {
        if (!cancelled) {
          errorRef.current?.(error);
          setIsReady(false);
        }
      }
    };

    initialize();

    return () => {
      cancelled = true;
    };
  }, [scope]);

  const startGoogleLogin = useCallback(() => {
    if (!tokenClientRef.current) {
      errorRef.current?.(new Error('Google Sign-In is still loading.'));
      return false;
    }

    tokenClientRef.current.requestAccessToken({ prompt });
    return true;
  }, [prompt]);

  return {
    isReady,
    startGoogleLogin,
  };
}
