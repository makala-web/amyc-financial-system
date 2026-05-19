import { Capacitor } from '@capacitor/core';
import type { StorageAdapter } from './StorageAdapter';
import { DexieAdapter } from './DexieAdapter';
import { isNativeSQLitePluginAvailable } from './native-sqlite';

let adapter: StorageAdapter | null = null;

export async function getStorageAdapter(): Promise<StorageAdapter> {
  if (!adapter) {
    if (Capacitor.isNativePlatform() && isNativeSQLitePluginAvailable()) {
      const { SQLiteAdapter } = await import('./SQLiteAdapter');
      const nativeAdapter = new SQLiteAdapter();
      try {
        await nativeAdapter.init();
        adapter = nativeAdapter;
      } catch (error) {
        console.warn('[AMYC Storage] SQLite adapter unavailable; falling back to Dexie.', error);
        adapter = new DexieAdapter();
      }
    } else {
      adapter = new DexieAdapter();
    }
  }
  return adapter;
}

export function isNativeStorage() {
  return Capacitor.isNativePlatform() && adapter?.name === 'sqlite';
}
