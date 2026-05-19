import { Capacitor } from '@capacitor/core';
import type { ConsolidatedReportRecord, Transaction } from '@/lib/types';
import { getNativeSQLiteDb } from './native-sqlite';

const DB_NAME = 'amyc_financial';

let db: Awaited<ReturnType<typeof getNativeSQLiteDb>> = null;

async function getDb() {
  if (!Capacitor.isNativePlatform()) return null;
  if (db) return db;

  db = await getNativeSQLiteDb(DB_NAME);
  return db;
}

export function canUseNativePrimaryQueries() {
  return Capacitor.isNativePlatform();
}

export async function queryNativeTransactionsForOrgPeriod(
  orgUnitId: number,
  year: number,
  month?: number
): Promise<Transaction[]> {
  const nativeDb = await getDb();
  if (!nativeDb) return [];

  const clauses = ['org_unit_id = ?', 'year = ?'];
  const values: Array<number | string> = [orgUnitId, year];
  if (month && month > 0) {
    clauses.push('month = ?');
    values.push(month);
  }

  const result = await nativeDb.query(
    `SELECT data_json FROM transactions WHERE ${clauses.join(' AND ')}`,
    values
  );

  return (result.values || []).map((row) => JSON.parse(String(row.data_json)) as Transaction);
}

export async function queryNativeReportsForUnitPeriod(
  tableName: 'regionalReports' | 'markazReports',
  unitId: number,
  year: number,
  month?: number
): Promise<ConsolidatedReportRecord[]> {
  const nativeDb = await getDb();
  if (!nativeDb) return [];

  const clauses = ['table_name = ?', 'unit_id = ?', 'year = ?'];
  const values: Array<number | string> = [tableName, unitId, year];
  if (month && month > 0) {
    clauses.push('month = ?');
    values.push(month);
  }

  const result = await nativeDb.query(
    `SELECT data_json FROM records WHERE ${clauses.join(' AND ')} ORDER BY updated_at ASC`,
    values
  );

  return (result.values || []).map((row) => JSON.parse(String(row.data_json)) as ConsolidatedReportRecord);
}
