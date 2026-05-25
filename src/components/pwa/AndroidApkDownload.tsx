'use client';

import { useCallback, useEffect, useState } from 'react';
import { Download, ShieldCheck, X } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { Button } from '@/components/ui/button';

const APK_DISMISSAL_KEY = 'amyc-apk-download-dismissed';
const APK_URL = '/downloads/AMYC-Finance-v2.0.0-release-signed.apk';

function isAndroidBrowser() {
  if (typeof navigator === 'undefined') return false;
  return /Android/i.test(navigator.userAgent);
}

function isStandalonePwa() {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(display-mode: standalone)').matches;
}

export default function AndroidApkDownload() {
  const [showPrompt, setShowPrompt] = useState(false);

  const isDismissed = useCallback(() => {
    try {
      const dismissedAt = localStorage.getItem(APK_DISMISSAL_KEY);
      if (!dismissedAt) return false;
      const threeDaysMs = 3 * 24 * 60 * 60 * 1000;
      return Date.now() - Number(dismissedAt) < threeDaysMs;
    } catch {
      return false;
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (Capacitor.isNativePlatform()) return;
    if (!isAndroidBrowser()) return;
    if (isStandalonePwa()) return;
    if (isDismissed()) return;

    const timer = window.setTimeout(() => setShowPrompt(true), 4500);
    return () => window.clearTimeout(timer);
  }, [isDismissed]);

  const handleDismiss = () => {
    setShowPrompt(false);
    try {
      localStorage.setItem(APK_DISMISSAL_KEY, String(Date.now()));
    } catch {
      // localStorage may be unavailable in restricted browsers.
    }
  };

  if (!showPrompt) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 px-3 pb-3 sm:px-4 sm:pb-4 pointer-events-none">
      <div className="relative mx-auto max-w-lg pointer-events-auto rounded-lg border border-slate-200 bg-white p-4 shadow-xl shadow-slate-900/15">
        <button
          onClick={handleDismiss}
          className="absolute right-5 mt-0.5 rounded-full p-1 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
          aria-label="Funga"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="flex gap-3 pr-8">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-emerald-50 text-emerald-700">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-slate-950">
              Pakua app ya Android
            </h3>
            <p className="mt-1 text-xs leading-5 text-slate-600">
              APK rasmi ya AMYC v2.0.0. Pakua ikiwa unataka kutumia app moja kwa moja kwenye simu.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button asChild size="sm" className="bg-emerald-700 hover:bg-emerald-800">
                <a href={APK_URL} download>
                  <Download className="mr-2 h-4 w-4" />
                  Download APK
                </a>
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={handleDismiss}>
                Baadaye
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
