import { Capacitor } from '@capacitor/core';
import { db } from '@/lib/db-offline';
import { createBackup, restoreBackup, type BackupData } from '@/lib/backup';
import { replaceNativeTableRecords } from '@/lib/storage/native-record-store';
import { getNativeSQLiteDb } from '@/lib/storage/native-sqlite';

const SNAPSHOT_DB = 'amyc_financial_native_store';
const SNAPSHOT_KEY = 'latest_backup';
const SNAPSHOT_INTERVAL_MS = 2 * 60 * 1000;

let snapshotDb: Awaited<ReturnType<typeof getNativeSQLiteDb>> = null;
let started = false;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let intervalId: ReturnType<typeof setInterval> | null = null;

function isNative() {
  return Capacitor.isNativePlatform();
}

async function getSnapshotDb() {
  if (!isNative()) return null;
  if (snapshotDb) return snapshotDb;

  snapshotDb = await getNativeSQLiteDb(SNAPSHOT_DB);
  if (!snapshotDb) return null;

  await snapshotDb.execute(`
    CREATE TABLE IF NOT EXISTS app_snapshots (
      key TEXT PRIMARY KEY NOT NULL,
      data_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  return snapshotDb;
}

async function getDexieHasUserData() {
  const [users, transactions, regionalReports, markazReports] = await Promise.all([
    db.users.count(),
    db.transactions.count(),
    db.regionalReports.count(),
    db.markazReports.count(),
  ]);

  return users > 0 || transactions > 0 || regionalReports > 0 || markazReports > 0;
}

function getRecordIndexes(row: any) {
  return {
    orgUnitId: row.orgUnitId ?? row.sourceOrgId ?? row.targetOrgId,
    unitId: row.unitId,
    month: row.month,
    year: row.year,
  };
}

async function saveDexieRecordsToNativeSQLite(backup: BackupData) {
  const tables: Array<[keyof BackupData, any[]]> = [
    ['users', backup.users],
    ['orgUnits', backup.orgUnits],
    ['categories', backup.categories],
    ['transactions', backup.transactions],
    ['importBatches', backup.importBatches],
    ['notes', backup.notes],
    ['monthlySubmissions', backup.monthlySubmissions],
    ['auditLogs', backup.auditLogs],
    ['budgets', backup.budgets],
    ['budgetItems', backup.budgetItems],
    ['performanceReports', backup.performanceReports],
    ['monthlyBalances', backup.monthlyBalances],
    ['regionalReports', backup.regionalReports],
    ['markazReports', backup.markazReports],
    ['reportArchives', backup.reportArchives],
  ];

  for (const [tableName, rows] of tables) {
    await replaceNativeTableRecords(tableName, rows, getRecordIndexes);
  }
}

export async function saveDexieSnapshotToNativeSQLite() {
  const nativeDb = await getSnapshotDb();
  if (!nativeDb) return;

  const backup = await createBackup();
  await nativeDb.run(
    'INSERT OR REPLACE INTO app_snapshots (key, data_json, updated_at) VALUES (?, ?, ?)',
    [SNAPSHOT_KEY, JSON.stringify(backup), new Date().toISOString()]
  );

  await saveDexieRecordsToNativeSQLite(backup);
}

export async function restoreDexieFromNativeSQLiteIfEmpty() {
  const nativeDb = await getSnapshotDb();
  if (!nativeDb) return false;

  if (await getDexieHasUserData()) {
    return false;
  }

  const result = await nativeDb.query(
    'SELECT data_json FROM app_snapshots WHERE key = ? LIMIT 1',
    [SNAPSHOT_KEY]
  );
  const dataJson = result.values?.[0]?.data_json;
  if (!dataJson) return false;

  const backup = JSON.parse(String(dataJson)) as BackupData;
  await restoreBackup(backup);
  return true;
}

function scheduleNativeSnapshot() {
  if (!isNative()) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveDexieSnapshotToNativeSQLite().catch((error) => {
      console.warn('Failed to save native SQLite snapshot:', error);
    });
  }, 1200);
}

export function startNativeSQLitePersistence() {
  if (!isNative() || started) return;
  started = true;

  const tables = [
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
  ];

  tables.forEach((table) => {
    table.hook('creating', scheduleNativeSnapshot);
    table.hook('updating', scheduleNativeSnapshot);
    table.hook('deleting', scheduleNativeSnapshot);
  });

  saveDexieSnapshotToNativeSQLite().catch(() => {});
  intervalId = setInterval(() => {
    saveDexieSnapshotToNativeSQLite().catch(() => {});
  }, SNAPSHOT_INTERVAL_MS);

  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      saveDexieSnapshotToNativeSQLite().catch(() => {});
    }
  });
}

export function stopNativeSQLitePersistence() {
  if (saveTimer) clearTimeout(saveTimer);
  if (intervalId) clearInterval(intervalId);
  saveTimer = null;
  intervalId = null;
  started = false;
}
