'use client';

import { useEffect } from 'react';
import { Capacitor } from '@capacitor/core';

export default function RegisterSW() {
  useEffect(() => {
    if (typeof window === 'undefined') return;

    if (Capacitor.isNativePlatform()) {
      console.log('[AMYC SW] Skipped service worker registration inside native APK');
      return;
    }

    if (!('serviceWorker' in navigator)) {
      console.log('[AMYC SW] Service Worker not supported in this browser');
      return;
    }

    const registerServiceWorker = async () => {
      try {
        // Check if a service worker is already controlling this page
        if (navigator.serviceWorker.controller) {
          console.log('[AMYC SW] Active service worker found:', navigator.serviceWorker.controller.scriptURL);
        }

        const registration = await navigator.serviceWorker.register('/sw.js', {
          scope: '/',
        });

        console.log('[AMYC SW] Service Worker registered successfully, scope:', registration.scope);

        // Determine current SW state
        if (registration.installing) {
          console.log('[AMYC SW] New service worker installing...');
        } else if (registration.waiting) {
          console.log('[AMYC SW] New service worker waiting to activate');
        } else if (registration.active) {
          console.log('[AMYC SW] Service worker active and controlling the page');
        }

        // Check for updates periodically (every 60 minutes)
        const updateInterval = setInterval(() => {
          try {
            registration.update().then(() => {
              console.log('[AMYC SW] Update check completed');
            }).catch(() => {
              // Update check failed silently
            });
          } catch {
            // Silent - update check is optional
          }
        }, 60 * 60 * 1000);

        // Listen for new service worker lifecycle events
        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          if (!newWorker) return;

          console.log('[AMYC SW] New service worker found, state:', newWorker.state);

          newWorker.addEventListener('statechange', () => {
            console.log('[AMYC SW] Service worker state changed to:', newWorker.state);

            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              // New SW installed but waiting to activate
              console.log('[AMYC SW] New service worker installed. It will activate on next navigation.');
            }

            if (
              newWorker.state === 'activated' &&
              navigator.serviceWorker.controller
            ) {
              console.log('[AMYC SW] New service worker activated and controlling the page');
            }
          });
        });

        // Handle controller change (new SW took over)
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          console.log('[AMYC SW] Controller changed - new service worker took over');
        });

        // Cleanup interval on unmount (though this component rarely unmounts)
        return () => clearInterval(updateInterval);
      } catch (error) {
        // SW registration failed - app works fine without it
        console.log('[AMYC SW] Service Worker registration failed:', error instanceof Error ? error.message : 'Unknown error');
      }
    };

    // Register after the page loads to avoid blocking rendering
    if (document.readyState === 'complete') {
      registerServiceWorker();
    } else {
      window.addEventListener('load', registerServiceWorker);
    }
  }, []);

  return null;
}
