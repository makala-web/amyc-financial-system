import { Capacitor } from '@capacitor/core';
import { db as dexieDb } from '@/lib/db-offline';
import { getNativeSQLiteDb } from './native-sqlite';

const DB_NAME = 'amyc_financial';

let db: Awaited<ReturnType<typeof getNativeSQLiteDb>> = null;

async function getDb() {
  if (!Capacitor.isNativePlatform()) return null;
  if (db) return db;

  db = await getNativeSQLiteDb(DB_NAME);
  if (!db) return null;

  await db.execute(`
    CREATE TABLE IF NOT EXISTS records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      table_name TEXT NOT NULL,
      local_id INTEGER NOT NULL,
      data_json TEXT NOT NULL,
      org_unit_id INTEGER,
      unit_id INTEGER,
      month INTEGER,
      year INTEGER,
      updated_at TEXT NOT NULL,
      UNIQUE(table_name, local_id)
    );
    CREATE INDEX IF NOT EXISTS idx_records_table ON records(table_name);
    CREATE INDEX IF NOT EXISTS idx_records_scope ON records(table_name, unit_id, org_unit_id, year, month);
  `);

  return db;
}

export async function mirrorNativeRecord(
  tableName: string,
  localId: number,
  data: unknown,
  indexes: {
    orgUnitId?: number;
    unitId?: number;
    month?: number;
    year?: number;
  } = {}
) {
  const nativeDb = await getDb().catch((error) => {
    console.warn('[AMYC SQLite] Failed to mirror native record; Dexie data remains saved.', error);
    return null;
  });
  if (!nativeDb) return;

  await nativeDb.run(
    `INSERT OR REPLACE INTO records
      (table_name, local_id, data_json, org_unit_id, unit_id, month, year, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      tableName,
      localId,
      JSON.stringify(data),
      indexes.orgUnitId ?? null,
      indexes.unitId ?? null,
      indexes.month ?? null,
      indexes.year ?? null,
      new Date().toISOString(),
    ]
  );
}

export async function deleteNativeRecord(tableName: string, localId: number) {
  const nativeDb = await getDb().catch(() => null);
  if (!nativeDb) return;
  await nativeDb.run('DELETE FROM records WHERE table_name = ? AND local_id = ?', [tableName, localId]);
}

export async function replaceNativeTableRecords(
  tableName: string,
  rows: unknown[],
  getIndexes: (row: any) => {
    orgUnitId?: number;
    unitId?: number;
    month?: number;
    year?: number;
  } = () => ({})
) {
  const nativeDb = await getDb().catch((error) => {
    console.warn('[AMYC SQLite] Failed to replace native table records; Dexie remains primary.', error);
    return null;
  });
  if (!nativeDb) return;

  await nativeDb.run('DELETE FROM records WHERE table_name = ?', [tableName]);

  for (const row of rows) {
    const localId = Number((row as { id?: unknown }).id);
    if (!Number.isFinite(localId)) continue;
    const indexes = getIndexes(row);

    await nativeDb.run(
      `INSERT OR REPLACE INTO records
        (table_name, local_id, data_json, org_unit_id, unit_id, month, year, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        tableName,
        localId,
        JSON.stringify(row),
        indexes.orgUnitId ?? null,
        indexes.unitId ?? null,
        indexes.month ?? null,
        indexes.year ?? null,
        new Date().toISOString(),
      ]
    );
  }
}

async function dexieHasOperationalData() {
  const [users, transactions, regionalReports, markazReports] = await Promise.all([
    dexieDb.users.count(),
    dexieDb.transactions.count(),
    dexieDb.regionalReports.count(),
    dexieDb.markazReports.count(),
  ]);

  return users > 0 || transactions > 0 || regionalReports > 0 || markazReports > 0;
}

async function restoreTable(tableName: string, table: { put: (record: any) => Promise<any> }) {
  const nativeDb = await getDb().catch(() => null);
  if (!nativeDb) return;

  const result = await nativeDb.query(
    'SELECT data_json FROM records WHERE table_name = ? ORDER BY updated_at ASC',
    [tableName]
  );

  for (const row of result.values || []) {
    const dataJson = row.data_json;
    if (!dataJson) continue;
    await table.put(JSON.parse(String(dataJson)));
  }
}

export async function restoreDexieFromNativeRecordsIfEmpty() {
  if (!Capacitor.isNativePlatform()) return false;
  if (await dexieHasOperationalData()) return false;

  try {
    await restoreTable('orgUnits', dexieDb.orgUnits);
    await restoreTable('users', dexieDb.users);
    await restoreTable('categories', dexieDb.categories);
    await restoreTable('transactions', dexieDb.transactions);
    await restoreTable('importBatches', dexieDb.importBatches);
    await restoreTable('notes', dexieDb.notes);
    await restoreTable('monthlySubmissions', dexieDb.monthlySubmissions);
    await restoreTable('budgets', dexieDb.budgets);
    await restoreTable('budgetItems', dexieDb.budgetItems);
    await restoreTable('performanceReports', dexieDb.performanceReports);
    await restoreTable('monthlyBalances', dexieDb.monthlyBalances);
    await restoreTable('regionalReports', dexieDb.regionalReports);
    await restoreTable('markazReports', dexieDb.markazReports);
    await restoreTable('reportArchives', dexieDb.reportArchives);
    await restoreTable('auditLogs', dexieDb.auditLogs);
  } catch (error) {
    console.warn('[AMYC SQLite] Native record restore skipped; Dexie remains available.', error);
    return false;
  }

  return dexieHasOperationalData();
}
