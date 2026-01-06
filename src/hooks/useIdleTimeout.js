// src/hooks/useIdleTimeout.js
// Hook to detect user inactivity and trigger logout after specified timeout

import { useEffect, useRef, useCallback } from 'react';

// Activity events to track
const ACTIVITY_EVENTS = [
  'mousedown',
  'mousemove',
  'keydown',
  'scroll',
  'touchstart',
  'click',
  'wheel'
];

// Storage key for last activity timestamp
const LAST_ACTIVITY_KEY = 'lastActivityTimestamp';

/**
 * Hook to handle idle timeout logout
 * @param {Function} onTimeout - Callback when timeout is reached (usually logout)
 * @param {number} timeoutMs - Timeout in milliseconds (default: 2 hours)
 * @param {boolean} enabled - Whether the timeout is enabled (default: true)
 */
export function useIdleTimeout(onTimeout, timeoutMs = 2 * 60 * 60 * 1000, enabled = true) {
  const timeoutRef = useRef(null);
  const lastActivityRef = useRef(Date.now());

  // Update last activity timestamp
  const updateActivity = useCallback(() => {
    const now = Date.now();
    lastActivityRef.current = now;
    localStorage.setItem(LAST_ACTIVITY_KEY, now.toString());
  }, []);

  // Check if timeout has been reached
  const checkTimeout = useCallback(() => {
    if (!enabled) return;

    const lastActivity = parseInt(localStorage.getItem(LAST_ACTIVITY_KEY) || lastActivityRef.current, 10);
    const now = Date.now();
    const elapsed = now - lastActivity;

    if (elapsed >= timeoutMs) {
      console.log(`[IdleTimeout] User idle for ${Math.round(elapsed / 1000 / 60)} minutes. Logging out.`);
      onTimeout();
    }
  }, [enabled, timeoutMs, onTimeout]);

  // Reset the timeout timer
  const resetTimer = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    if (!enabled) return;

    updateActivity();

    // Set timeout to check again after the timeout period
    timeoutRef.current = setTimeout(() => {
      checkTimeout();
    }, timeoutMs);
  }, [enabled, timeoutMs, updateActivity, checkTimeout]);

  // Handle activity event
  const handleActivity = useCallback(() => {
    resetTimer();
  }, [resetTimer]);

  useEffect(() => {
    if (!enabled) return;

    // Initialize last activity
    updateActivity();

    // Add event listeners for user activity
    ACTIVITY_EVENTS.forEach(event => {
      document.addEventListener(event, handleActivity, { passive: true });
    });

    // Start the initial timer
    resetTimer();

    // Check for timeout on mount (in case user was away)
    const lastActivity = parseInt(localStorage.getItem(LAST_ACTIVITY_KEY), 10);
    if (lastActivity) {
      const elapsed = Date.now() - lastActivity;
      if (elapsed >= timeoutMs) {
        console.log(`[IdleTimeout] User was idle for ${Math.round(elapsed / 1000 / 60)} minutes. Logging out.`);
        onTimeout();
      }
    }

    // Also check periodically (every minute) in case the tab was in background
    const intervalId = setInterval(() => {
      checkTimeout();
    }, 60 * 1000); // Check every minute

    // Cleanup
    return () => {
      ACTIVITY_EVENTS.forEach(event => {
        document.removeEventListener(event, handleActivity);
      });
      
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      
      clearInterval(intervalId);
    };
  }, [enabled, timeoutMs, handleActivity, resetTimer, updateActivity, checkTimeout, onTimeout]);

  // Return function to manually reset activity (useful after API calls, etc.)
  return { resetActivity: updateActivity };
}

export default useIdleTimeout;

