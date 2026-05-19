import { initializeDatabase } from '@/lib/db-offline';
import { getStorageAdapter } from '@/lib/storage';
import { Capacitor } from '@capacitor/core';

export async function initializeOfflineRuntime() {
  const adapter = await getStorageAdapter();
  await adapter.init();
  if (Capacitor.isNativePlatform()) {
    const { restoreDexieFromNativeSQLiteIfEmpty } = await import('@/lib/native-sqlite-backup');
    const { restoreDexieFromNativeRecordsIfEmpty } = await import('@/lib/storage/native-record-store');
    await restoreDexieFromNativeSQLiteIfEmpty();
    await restoreDexieFromNativeRecordsIfEmpty();
  }
  await initializeDatabase();
  if (Capacitor.isNativePlatform()) {
    const { startNativeSQLitePersistence } = await import('@/lib/native-sqlite-backup');
    startNativeSQLitePersistence();
  }
}
