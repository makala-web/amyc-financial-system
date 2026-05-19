'use client';

import { useEffect } from 'react';
import { toast } from 'sonner';
import { processSyncQueue, getSyncStatus } from '@/lib/sync-engine';
import { useAuthStore } from '@/lib/store';

const AUTO_SYNC_INTERVAL_MS = 3 * 60 * 1000;

/**
 * Runs background sync when online + authenticated. Does not touch report logic.
 */
export default function SyncBootstrap() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const authToken = useAuthStore((s) => s.authToken);

  useEffect(() => {
    if (!isAuthenticated) return;

    const runSync = async (silent: boolean) => {
      if (!navigator.onLine || !authToken) return;
      const before = getSyncStatus();
      if (before.pending === 0 && before.failed === 0) return;

      try {
        const result = await processSyncQueue();
        if (!silent && result.succeeded > 0) {
          toast.success(`Miamala ${result.succeeded} imesawazishwa na seva.`);
        }
      } catch {
        // Manual retry available in Settings
      }
    };

    const onOnline = () => {
      toast.success('Umeunganishwa tena. Inasawazisha data...');
      void runSync(true);
    };

    window.addEventListener('online', onOnline);
    const interval = setInterval(() => void runSync(true), AUTO_SYNC_INTERVAL_MS);

    if (navigator.onLine && authToken) {
      void runSync(true);
    }

    return () => {
      window.removeEventListener('online', onOnline);
      clearInterval(interval);
    };
  }, [isAuthenticated, authToken]);

  return null;
}
