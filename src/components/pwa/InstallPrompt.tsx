'use client';

import { useEffect, useState, useCallback } from 'react';
import { Download, X, Smartphone } from 'lucide-react';
import { Button } from '@/components/ui/button';

const DISMISSAL_KEY = 'amyc-install-prompt-dismissed';
const SHOW_DELAY = 3000; // 3 seconds delay before showing

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export default function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [showPrompt, setShowPrompt] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);

  // Check if the user has already dismissed the prompt
  const isDismissed = useCallback(() => {
    try {
      const dismissed = localStorage.getItem(DISMISSAL_KEY);
      if (!dismissed) return false;
      const { timestamp, permanent } = JSON.parse(dismissed);
      // If permanently dismissed, don't show again
      if (permanent) return true;
      // Otherwise, show again after 7 days
      const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
      return Date.now() - timestamp < sevenDaysMs;
    } catch {
      return false;
    }
  }, []);

  // Listen for the beforeinstallprompt event
  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Don't show if already installed (in standalone mode)
    if (window.matchMedia('(display-mode: standalone)').matches) return;

    // Don't show if previously dismissed
    if (isDismissed()) return;

    const handleBeforeInstallPrompt = (e: Event) => {
      // Prevent the default mini-infobar
      e.preventDefault();
      const promptEvent = e as BeforeInstallPromptEvent;
      setDeferredPrompt(promptEvent);

      // Show the prompt after a delay
      setTimeout(() => {
        if (!isDismissed()) {
          setShowPrompt(true);
        }
      }, SHOW_DELAY);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    // Also listen for appinstalled to hide the prompt if user installs through browser UI
    const handleAppInstalled = () => {
      setShowPrompt(false);
      setDeferredPrompt(null);
    };

    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener(
        'beforeinstallprompt',
        handleBeforeInstallPrompt
      );
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, [isDismissed]);

  const handleInstall = async () => {
    if (!deferredPrompt) return;

    setIsInstalling(true);

    try {
      // Show the install prompt
      await deferredPrompt.prompt();

      // Wait for the user to respond
      const { outcome } = await deferredPrompt.userChoice;

      if (outcome === 'accepted') {
        // User accepted - no need to show again
        setShowPrompt(false);
      }
      // Clear the deferred prompt - it can only be used once
      setDeferredPrompt(null);
    } catch {
      // Prompt failed - silently handle
    } finally {
      setIsInstalling(false);
    }
  };

  const handleDismiss = () => {
    setShowPrompt(false);
    // Remember dismissal in localStorage
    try {
      localStorage.setItem(
        DISMISSAL_KEY,
        JSON.stringify({
          timestamp: Date.now(),
          permanent: false, // Will show again after 7 days
        })
      );
    } catch {
      // localStorage not available - that's OK
    }
  };

  // Don't render anything if prompt shouldn't be shown
  if (!showPrompt || !deferredPrompt) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 p-4 animate-in slide-in-from-bottom-4 duration-300">
      <div className="mx-auto max-w-lg">
        <div className="relative overflow-hidden rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-600 to-emerald-700 p-5 shadow-2xl shadow-emerald-900/30">
          {/* Decorative background pattern */}
          <div className="absolute inset-0 opacity-10">
            <div className="absolute -right-8 -top-8 h-32 w-32 rounded-full bg-white" />
            <div className="absolute -bottom-4 -left-4 h-20 w-20 rounded-full bg-white" />
          </div>

          {/* Close button */}
          <button
            onClick={handleDismiss}
            className="absolute right-3 top-3 rounded-full p-1 text-emerald-100 transition-colors hover:bg-emerald-500/50 hover:text-white"
            aria-label="Funga"
          >
            <X className="h-4 w-4" />
          </button>

          {/* Content */}
          <div className="relative flex items-start gap-4">
            {/* Icon */}
            <div className="flex-shrink-0 rounded-xl bg-white/20 p-3 backdrop-blur-sm">
              <Smartphone className="h-7 w-7 text-white" />
            </div>

            {/* Text */}
            <div className="flex-1 min-w-0 pr-6">
              <h3 className="text-lg font-bold text-white">
                Sakinisha App
              </h3>
              <p className="mt-1 text-sm leading-relaxed text-emerald-100">
                Sakinisha AMYC kwenye kifaa chako ili uitumie nje ya mtandao
              </p>

              {/* Action buttons */}
              <div className="mt-4 flex flex-wrap gap-2">
                <Button
                  onClick={handleInstall}
                  disabled={isInstalling}
                  className="bg-white text-emerald-700 hover:bg-emerald-50 font-semibold shadow-md"
                  size="sm"
                >
                  <Download className="mr-2 h-4 w-4" />
                  {isInstalling ? 'Inasakinisha...' : 'Sakinisha Sasa'}
                </Button>
                <Button
                  onClick={handleDismiss}
                  variant="ghost"
                  size="sm"
                  className="text-emerald-100 hover:bg-emerald-500/30 hover:text-white"
                >
                  Baadae
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
