import { toast } from 'sonner';
import React, { useEffect, useState } from 'react';

// Call this wherever you want to show the toast
const showServiceUnavailableToast = (redirectUrl = '/dashboard') => {
  toast.custom(
    (t) => {
      const [count, setCount] = useState(5);

      useEffect(() => {
        if (count <= 0) {
          window.location.href = redirectUrl; // or use router.push() if using Next.js
          return;
        }

        const timer = setTimeout(() => {
          setCount((prev) => prev - 1);
        }, 1000);

        return () => clearTimeout(timer);
      }, [count]);

      return (
        <div className="flex flex-col items-center gap-2 bg-white dark:bg-zinc-900 border border-red-200 dark:border-red-800 px-6 py-4 rounded-xl shadow-lg">
          <div className="text-red-500">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="w-6 h-6"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
          </div>

          <p className="font-medium text-center">
            Virtual account service is currently unavailable.
          </p>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Redirecting in{' '}
            <span className="font-mono font-semibold text-red-600">
              {count}
            </span>
            ...
          </p>
        </div>
      );
    },
    {
      duration: 6000, // Give a bit of buffer
      dismissible: true, // Allow manual close if needed
    }
  );
};

export default showServiceUnavailableToast;
