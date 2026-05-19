'use client';

import { useAuthStore } from '@/lib/store';
import { initializeOfflineRuntime } from '@/lib/offline-startup';
import { installStartupDiagnostics, logStartupStep } from '@/lib/startup-diagnostics';
import { useEffect } from 'react';
import AuthPage from '@/components/auth/AuthPage';
import MainLayout from '@/components/layout/MainLayout';

export default function LoginRoutePage() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  useEffect(() => {
    let cancelled = false;
    installStartupDiagnostics();
    logStartupStep('Login mounted; initializing offline runtime in background');

    initializeOfflineRuntime()
      .then(() => {
        if (!cancelled) {
          logStartupStep('Offline runtime ready');
        }
      })
      .catch((err) => {
        console.error('[AMYC Startup] DB init error:', err);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (!isAuthenticated) {
    return <AuthPage />;
  }

  return <MainLayout />;
}
