'use client';

import { useEffect, useState } from 'react';
import { Wifi, WifiOff, Cloud, Database } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { getSyncStatus } from '@/lib/sync-engine';

export default function SyncIndicator() {
  const [online, setOnline] = useState(true);
  const [pending, setPending] = useState(0);

  useEffect(() => {
    const refresh = () => {
      setOnline(navigator.onLine);
      const s = getSyncStatus();
      setPending(s.pending + s.failed);
    };
    refresh();
    window.addEventListener('online', refresh);
    window.addEventListener('offline', refresh);
    const interval = setInterval(refresh, 12000);
    return () => {
      window.removeEventListener('online', refresh);
      window.removeEventListener('offline', refresh);
      clearInterval(interval);
    };
  }, []);

  return (
    <div className="flex items-center gap-1.5 shrink-0" title={online ? 'Umeunganishwa' : 'Nje ya mtandao'}>
      {online ? (
        <Wifi className="h-3.5 w-3.5 text-emerald-600" aria-hidden />
      ) : (
        <WifiOff className="h-3.5 w-3.5 text-amber-600" aria-hidden />
      )}
      <span className="text-[10px] sm:text-xs font-medium text-muted-foreground hidden sm:inline">
        {online ? 'Mtandaoni | Data ya kifaa' : 'Nje ya mtandao | Cached'}
      </span>
      <Database className="h-3.5 w-3.5 text-emerald-700" aria-hidden />
      {pending > 0 && (
        <Badge
          variant="secondary"
          className="h-5 px-1.5 text-[10px] bg-amber-100 text-amber-800 border-amber-200"
        >
          <Cloud className="h-3 w-3 mr-0.5 inline" />
          {pending}
        </Badge>
      )}
    </div>
  );
}
