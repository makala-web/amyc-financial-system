'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  RefreshCw,
  Wifi,
  WifiOff,
  Clock,
  CheckCircle2,
  XCircle,
  Loader2,
  AlertTriangle,
  FolderSync,
  Trash2,
} from 'lucide-react';
import {
  getSyncStatus,
  processSyncQueue,
  forceResync,
  clearSyncQueue,
  type SyncStatus as SyncStatusType,
} from '@/lib/sync-engine';
import { toast } from 'sonner';

// ============================================================
// SyncStatus Component
// ============================================================

export default function SyncStatus() {
  const [status, setStatus] = useState<SyncStatusType>({
    pending: 0,
    syncing: 0,
    failed: 0,
    completed: 0,
    lastSyncAt: null,
    isOnline: true,
  });
  const [isSyncing, setIsSyncing] = useState(false);
  const [isResyncing, setIsResyncing] = useState(false);

  // Refresh status every 30 seconds
  const refreshStatus = useCallback(() => {
    const currentStatus = getSyncStatus();
    setStatus(currentStatus);
  }, []);

  useEffect(() => {
    refreshStatus();
    const interval = setInterval(refreshStatus, 30000);

    // Listen for online/offline events
    const handleOnline = async () => {
      refreshStatus();
      toast.success('Umeunganishwa tena! Inasawazisha data...');
      try {
        await processSyncQueue();
        refreshStatus();
      } catch {
        // User can retry manually below
      }
    };
    const handleOffline = () => {
      refreshStatus();
      toast.info('Haujaunganishwa. Data itahifadhiwa kwenye foleni ya kusawazisha.');
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      clearInterval(interval);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [refreshStatus]);

  // Handle manual sync
  const handleSyncNow = async () => {
    setIsSyncing(true);
    try {
      const result = await processSyncQueue();
      refreshStatus();

      if (result.processed === 0) {
        toast.info('Hakuna vitu vya kusawazisha.');
      } else if (result.failed === 0) {
        toast.success(`Vitu ${result.succeeded} vimesawazishwa kikamilifu!`);
      } else {
        toast.warning(`Vitu ${result.succeeded} vimesawazishwa, ${result.failed} vimeshindwa.`, {
          description: 'Jaribu "Lazimisha Usawazishaji" kwa vitu vilivyoshindwa.',
        });
      }
    } catch (error) {
      toast.error('Hitilafu katika kusawazisha data');
    } finally {
      setIsSyncing(false);
    }
  };

  // Handle force resync
  const handleForceResync = async () => {
    setIsResyncing(true);
    try {
      const result = await forceResync();
      refreshStatus();

      if (result.failed === 0 && result.succeeded > 0) {
        toast.success(`Vitu ${result.succeeded} vimesawazishwa tena kikamilifu!`);
      } else if (result.succeeded > 0 && result.failed > 0) {
        toast.warning(`${result.succeeded} vimefanikiwa, ${result.failed} vimeshindwa tena.`);
      } else if (result.processed === 0) {
        toast.info('Hakuna vitu vya kusawazisha tena.');
      } else {
        toast.error('Vitu vyote vimeshindwa kusawazishwa tena.');
      }
    } catch (error) {
      toast.error('Hitilafu katika kulazimisha usawazishaji');
    } finally {
      setIsResyncing(false);
    }
  };

  // Handle clear queue
  const handleClearQueue = () => {
    clearSyncQueue();
    refreshStatus();
    toast.success('Foleni ya kusawazisha imefutwa.');
  };

  // Format last sync time
  const formatLastSync = (timestamp: number | null): string => {
    if (!timestamp) return 'Bado hakuna usawazishaji';
    try {
      const now = Date.now();
      const diff = now - timestamp;
      const minutes = Math.floor(diff / 60000);
      const hours = Math.floor(diff / 3600000);
      const days = Math.floor(diff / 86400000);

      if (minutes < 1) return 'Sasa hivi';
      if (minutes < 60) return `Dakika ${minutes} zilizopita`;
      if (hours < 24) return `Masaa ${hours} yaliyopita`;
      if (days < 7) return `Siku ${days} zilizopita`;

      return new Date(timestamp).toLocaleDateString('sw-TZ', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return 'Bado hakuna usawazishaji';
    }
  };

  const totalItems = status.pending + status.syncing + status.failed + status.completed;
  const hasPendingOrFailed = status.pending > 0 || status.failed > 0;

  return (
    <Card className="border-emerald-200">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-emerald-700">
          <FolderSync className="h-5 w-5" />
          Hali ya Usawazishaji
        </CardTitle>
        <CardDescription>Angalia na simamia usawazishaji wa data nje ya mtandao</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Online/Offline Indicator */}
        <div className="flex items-center justify-between p-3 rounded-lg bg-emerald-50/50 border border-emerald-100">
          <div className="flex items-center gap-2">
            {status.isOnline ? (
              <>
                <Wifi className="h-4 w-4 text-emerald-600" />
                <span className="text-sm font-medium text-emerald-800">Umeunganishwa</span>
              </>
            ) : (
              <>
                <WifiOff className="h-4 w-4 text-red-500" />
                <span className="text-sm font-medium text-red-700">Haujaunganishwa</span>
              </>
            )}
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Clock className="h-3 w-3" />
            <span>Mwisho: {formatLastSync(status.lastSyncAt)}</span>
          </div>
        </div>

        {/* Queue Status Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {/* Pending */}
          <div className="flex flex-col items-center gap-1 p-3 rounded-lg bg-amber-50 border border-amber-100">
            <Clock className="h-5 w-5 text-amber-600" />
            <span className="text-xl font-bold text-amber-800">{status.pending}</span>
            <span className="text-[10px] text-amber-600 font-medium uppercase">Inasubiri</span>
          </div>

          {/* Syncing */}
          <div className="flex flex-col items-center gap-1 p-3 rounded-lg bg-sky-50 border border-sky-100">
            <Loader2 className={`h-5 w-5 text-sky-600 ${status.syncing > 0 ? 'animate-spin' : ''}`} />
            <span className="text-xl font-bold text-sky-800">{status.syncing}</span>
            <span className="text-[10px] text-sky-600 font-medium uppercase">Inasawazisha</span>
          </div>

          {/* Failed */}
          <div className="flex flex-col items-center gap-1 p-3 rounded-lg bg-red-50 border border-red-100">
            <XCircle className="h-5 w-5 text-red-600" />
            <span className="text-xl font-bold text-red-800">{status.failed}</span>
            <span className="text-[10px] text-red-600 font-medium uppercase">Imeshindwa</span>
          </div>

          {/* Completed */}
          <div className="flex flex-col items-center gap-1 p-3 rounded-lg bg-emerald-50 border border-emerald-100">
            <CheckCircle2 className="h-5 w-5 text-emerald-600" />
            <span className="text-xl font-bold text-emerald-800">{status.completed}</span>
            <span className="text-[10px] text-emerald-600 font-medium uppercase">Imekamilika</span>
          </div>
        </div>

        {/* Failed items warning */}
        {status.failed > 0 && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200">
            <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
            <div className="text-xs">
              <p className="font-medium text-amber-800">Vitu {status.failed} vimeshindwa kusawazishwa</p>
              <p className="text-amber-600 mt-0.5">Bonyeza &quot;Lazimisha Usawazishaji&quot ili kujaribu tena.</p>
            </div>
          </div>
        )}

        {/* Queue info */}
        {totalItems > 0 && (
          <div className="text-xs text-muted-foreground text-center">
            Jumla vitu {totalItems} kwenye foleni
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row gap-2">
          <Button
            onClick={handleSyncNow}
            disabled={isSyncing || !status.isOnline || !hasPendingOrFailed}
            className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            {isSyncing ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-2" />
            )}
            Sawazisha Sasa
          </Button>

          <Button
            onClick={handleForceResync}
            disabled={isResyncing || !status.isOnline || status.failed === 0}
            variant="outline"
            className="flex-1 border-amber-300 text-amber-700 hover:bg-amber-50"
          >
            {isResyncing ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <FolderSync className="h-4 w-4 mr-2" />
            )}
            Lazimisha Usawazishaji
          </Button>

          {totalItems > 0 && (
            <Button
              onClick={handleClearQueue}
              variant="outline"
              className="border-red-300 text-red-700 hover:bg-red-50"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Futa Foleni
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
