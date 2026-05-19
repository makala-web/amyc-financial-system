// AMYC Auto Backup System - saves data to localStorage as fallback
import { db } from './db-offline';

const BACKUP_KEY = 'amyc_backup_data';
const BACKUP_TIMESTAMP_KEY = 'amyc_backup_timestamp';
const AUTO_BACKUP_INTERVAL = 5 * 60 * 1000; // 5 minutes

export interface BackupData {
  users: any[];
  orgUnits: any[];
  categories: any[];
  transactions: any[];
  importBatches: any[];
  notes: any[];
  monthlySubmissions: any[];
  auditLogs: any[];
  budgets: any[];
  budgetItems: any[];
  performanceReports: any[];
  monthlyBalances: any[];
  regionalReports: any[];
  markazReports: any[];
  reportArchives: any[];
  timestamp: string;
  version: number;
}

export async function createBackup(): Promise<BackupData> {
  const [
    users,
    orgUnits,
    categories,
    transactions,
    importBatches,
    notes,
    monthlySubmissions,
    auditLogs,
    budgets,
    budgetItems,
    performanceReports,
    monthlyBalances,
    regionalReports,
    markazReports,
    reportArchives,
  ] = await Promise.all([
    db.users.toArray(),
    db.orgUnits.toArray(),
    db.categories.toArray(),
    db.transactions.toArray(),
    db.importBatches.toArray(),
    db.notes.toArray(),
    db.monthlySubmissions.toArray(),
    db.auditLogs.toArray(),
    db.budgets.toArray(),
    db.budgetItems.toArray(),
    db.performanceReports.toArray(),
    db.monthlyBalances.toArray(),
    db.regionalReports.toArray(),
    db.markazReports.toArray(),
    db.reportArchives.toArray(),
  ]);

  return {
    users,
    orgUnits,
    categories,
    transactions,
    importBatches,
    notes,
    monthlySubmissions,
    auditLogs,
    budgets,
    budgetItems,
    performanceReports,
    monthlyBalances,
    regionalReports,
    markazReports,
    reportArchives,
    timestamp: new Date().toISOString(),
    version: 9,
  };
}

export async function restoreBackup(data: BackupData): Promise<void> {
  await db.transaction('rw', [
    db.users,
    db.orgUnits,
    db.categories,
    db.transactions,
    db.importBatches,
    db.notes,
    db.monthlySubmissions,
    db.auditLogs,
    db.budgets,
    db.budgetItems,
    db.performanceReports,
    db.monthlyBalances,
    db.regionalReports,
    db.markazReports,
    db.reportArchives,
  ], async () => {
    // Clear existing data
    await Promise.all([
      db.users.clear(),
      db.orgUnits.clear(),
      db.categories.clear(),
      db.transactions.clear(),
      db.importBatches.clear(),
      db.notes.clear(),
      db.monthlySubmissions.clear(),
      db.auditLogs.clear(),
      db.budgets.clear(),
      db.budgetItems.clear(),
      db.performanceReports.clear(),
      db.monthlyBalances.clear(),
      db.regionalReports.clear(),
      db.markazReports.clear(),
      db.reportArchives.clear(),
    ]);

    // Restore data (gracefully skip missing/empty arrays for backward compat)
    if (data.users?.length) await db.users.bulkAdd(data.users);
    if (data.orgUnits?.length) await db.orgUnits.bulkAdd(data.orgUnits);
    if (data.categories?.length) await db.categories.bulkAdd(data.categories);
    if (data.transactions?.length) await db.transactions.bulkAdd(data.transactions);
    if (data.importBatches?.length) await db.importBatches.bulkAdd(data.importBatches);
    if (data.notes?.length) await db.notes.bulkAdd(data.notes);
    if (data.monthlySubmissions?.length) await db.monthlySubmissions.bulkAdd(data.monthlySubmissions);
    if (data.auditLogs?.length) await db.auditLogs.bulkAdd(data.auditLogs);
    if (data.budgets?.length) await db.budgets.bulkAdd(data.budgets);
    if (data.budgetItems?.length) await db.budgetItems.bulkAdd(data.budgetItems);
    if (data.performanceReports?.length) await db.performanceReports.bulkAdd(data.performanceReports);
    if (data.monthlyBalances?.length) await db.monthlyBalances.bulkAdd(data.monthlyBalances);
    if (data.regionalReports?.length) await db.regionalReports.bulkAdd(data.regionalReports);
    if (data.markazReports?.length) await db.markazReports.bulkAdd(data.markazReports);
    if (data.reportArchives?.length) await db.reportArchives.bulkAdd(data.reportArchives);
  });
}

export async function saveBackupToLocal(): Promise<void> {
  try {
    const backup = await createBackup();
    const json = JSON.stringify(backup);
    
    // Save to localStorage
    localStorage.setItem(BACKUP_KEY, json);
    localStorage.setItem(BACKUP_TIMESTAMP_KEY, new Date().toISOString());
    
    // Also try to save to a file-like blob in cache
    if ('caches' in window) {
      const cache = await caches.open('amyc-backups');
      const response = new Response(json, {
        headers: { 'Content-Type': 'application/json' },
      });
      await cache.put('/backup/latest.json', response);
    }
  } catch (error) {
    console.error('Backup failed:', error);
  }
}

export async function loadBackupFromLocal(): Promise<BackupData | null> {
  try {
    const json = localStorage.getItem(BACKUP_KEY);
    if (json) {
      return JSON.parse(json);
    }
    
    // Try cache
    if ('caches' in window) {
      const cache = await caches.open('amyc-backups');
      const response = await cache.match('/backup/latest.json');
      if (response) {
        return await response.json();
      }
    }
    
    return null;
  } catch (error) {
    console.error('Load backup failed:', error);
    return null;
  }
}

export function getBackupTimestamp(): string | null {
  return localStorage.getItem(BACKUP_TIMESTAMP_KEY);
}

// Auto-backup system
let backupIntervalId: ReturnType<typeof setInterval> | null = null;

export function startAutoBackup(): void {
  if (backupIntervalId) return; // already running
  
  // Initial backup
  saveBackupToLocal();
  
  // Periodic backup
  backupIntervalId = setInterval(() => {
    saveBackupToLocal();
  }, AUTO_BACKUP_INTERVAL);
}

export function stopAutoBackup(): void {
  if (backupIntervalId) {
    clearInterval(backupIntervalId);
    backupIntervalId = null;
  }
}

// Export backup as JSON file for download
export async function exportBackupAsFile(): Promise<void> {
  const backup = await createBackup();
  const json = JSON.stringify(backup, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  
  const a = document.createElement('a');
  a.href = url;
  a.download = `amyc-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Import backup from JSON file
export function importBackupFromFile(): Promise<BackupData> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) {
        reject(new Error('Hakuna faili lililochaguliwa'));
        return;
      }
      
      try {
        const text = await file.text();
        const data = JSON.parse(text) as BackupData;
        resolve(data);
      } catch (err) {
        reject(new Error('Faili si sahihi'));
      }
    };
    
    input.click();
  });
}

async function deriveBackupKey(passphrase: string, salt: Uint8Array) {
  const baseKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt.buffer.slice(salt.byteOffset, salt.byteOffset + salt.byteLength) as ArrayBuffer,
      iterations: 150000,
      hash: 'SHA-256',
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export async function exportEncryptedBackupAsFile(passphrase: string): Promise<void> {
  if (!passphrase || passphrase.length < 8) {
    throw new Error('Nenosiri la backup linahitaji herufi 8 au zaidi.');
  }

  const backup = await createBackup();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveBackupKey(passphrase, salt);
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv.buffer.slice(iv.byteOffset, iv.byteOffset + iv.byteLength) as ArrayBuffer },
    key,
    new TextEncoder().encode(JSON.stringify(backup))
  );

  const payload = {
    kind: 'AMYC_ENCRYPTED_BACKUP',
    version: 1,
    kdf: 'PBKDF2-SHA256',
    iterations: 150000,
    cipher: 'AES-GCM',
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    data: bytesToBase64(new Uint8Array(encrypted)),
    createdAt: new Date().toISOString(),
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `amyc-backup-encrypted-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function decryptBackupFile(file: File, passphrase: string): Promise<BackupData> {
  const payload = JSON.parse(await file.text()) as {
    kind?: string;
    salt?: string;
    iv?: string;
    data?: string;
  };

  if (payload.kind !== 'AMYC_ENCRYPTED_BACKUP' || !payload.salt || !payload.iv || !payload.data) {
    throw new Error('Faili si encrypted backup rasmi ya AMYC.');
  }

  const key = await deriveBackupKey(passphrase, base64ToBytes(payload.salt));
  const decrypted = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: base64ToBytes(payload.iv).buffer.slice(0) as ArrayBuffer,
    },
    key,
    base64ToBytes(payload.data)
  );

  return JSON.parse(new TextDecoder().decode(decrypted)) as BackupData;
}
