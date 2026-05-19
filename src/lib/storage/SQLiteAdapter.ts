import { Capacitor } from '@capacitor/core';
import { db as dexieDb } from '@/lib/db-offline';
import type { ConsolidatedReportRecord, Transaction } from '@/lib/types';
import type { StorageAdapter } from './StorageAdapter';
import {
  addSQLiteColumnIfMissing,
  getNativeSQLiteDb,
} from './native-sqlite';

export class SQLiteAdapter implements StorageAdapter {
  readonly name = 'sqlite' as const;
  private db: Awaited<ReturnType<typeof getNativeSQLiteDb>> = null;

  async init() {
    if (!Capacitor.isNativePlatform()) {
      throw new Error('SQLiteAdapter is only available on native Capacitor platforms.');
    }
    if (this.db) return;

    const db = await getNativeSQLiteDb('amyc_financial');
    if (!db) return;

    await db.execute(`
      CREATE TABLE IF NOT EXISTS transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        local_id INTEGER UNIQUE,
        data_json TEXT NOT NULL,
        org_unit_id INTEGER NOT NULL,
        import_batch_id INTEGER,
        year INTEGER NOT NULL,
        month INTEGER NOT NULL,
        type TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_transactions_scope ON transactions(org_unit_id, year, month);
      CREATE INDEX IF NOT EXISTS idx_transactions_import_batch ON transactions(import_batch_id);
      CREATE TABLE IF NOT EXISTS reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        table_name TEXT NOT NULL,
        data_json TEXT NOT NULL,
        unit_id INTEGER NOT NULL,
        year INTEGER NOT NULL,
        month INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_reports_scope ON reports(table_name, unit_id, year, month);
    `);
    await addSQLiteColumnIfMissing(db, 'transactions', 'local_id', 'INTEGER UNIQUE');
    await addSQLiteColumnIfMissing(db, 'transactions', 'import_batch_id', 'INTEGER');
    this.db = db;
  }

  async saveTransaction(transaction: Transaction) {
    const localId = (await dexieDb.transactions.add(transaction)) as number;
    const saved = await dexieDb.transactions.get(localId);
    if (saved?.id) {
      await this.mirrorTransaction(saved as Transaction & { id: number });
    }
    return localId;
  }

  async mirrorTransaction(transaction: Transaction & { id: number }) {
    await this.init();
    await this.db!.run(
      `INSERT OR REPLACE INTO transactions
        (local_id, data_json, org_unit_id, import_batch_id, year, month, type, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        transaction.id,
        JSON.stringify(transaction),
        transaction.orgUnitId,
        transaction.importBatchId ?? null,
        transaction.year,
        transaction.month,
        transaction.type,
        transaction.createdAt,
      ]
    );
  }

  async updateTransaction(id: number, changes: Partial<Transaction>) {
    await dexieDb.transactions.update(id, changes);
    const updated = await dexieDb.transactions.get(id);
    if (updated?.id) {
      await this.mirrorTransaction(updated as Transaction & { id: number });
    }
  }

  async deleteTransaction(id: number) {
    await this.init();
    await dexieDb.transactions.delete(id);
    await this.db!.run('DELETE FROM transactions WHERE local_id = ?', [id]);
  }

  async deleteTransactionsByImportBatchIds(importBatchIds: number[]) {
    if (importBatchIds.length === 0) return;
    await this.init();
    const previous = await dexieDb.transactions.where('importBatchId').anyOf(importBatchIds).toArray();
    await dexieDb.transactions.where('importBatchId').anyOf(importBatchIds).delete();
    for (const importBatchId of importBatchIds) {
      await this.db!.run('DELETE FROM transactions WHERE import_batch_id = ?', [importBatchId]);
    }
  }

  async getTransactions(orgUnitId: number, year?: number, month?: number) {
    await this.init();
    const clauses = ['org_unit_id = ?'];
    const values: Array<number | string> = [orgUnitId];
    if (year) {
      clauses.push('year = ?');
      values.push(year);
    }
    if (month) {
      clauses.push('month = ?');
      values.push(month);
    }
    const result = await this.db!.query(
      `SELECT data_json FROM transactions WHERE ${clauses.join(' AND ')}`,
      values
    );
    return (result.values || []).map((row) => JSON.parse(String(row.data_json)) as Transaction);
  }

  async saveReport(table: 'regionalReports' | 'markazReports', report: ConsolidatedReportRecord) {
    await this.init();
    const result = await this.db!.run(
      'INSERT INTO reports (table_name, data_json, unit_id, year, month, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [table, JSON.stringify(report), report.unitId, report.year, report.month, report.createdAt]
    );
    return result.changes?.lastId ?? 0;
  }

  async getReports(
    table: 'regionalReports' | 'markazReports',
    unitId: number,
    year?: number,
    month?: number
  ) {
    await this.init();
    const clauses = ['table_name = ?', 'unit_id = ?'];
    const values: Array<number | string> = [table, unitId];
    if (year) {
      clauses.push('year = ?');
      values.push(year);
    }
    if (month) {
      clauses.push('month = ?');
      values.push(month);
    }
    const result = await this.db!.query(
      `SELECT data_json FROM reports WHERE ${clauses.join(' AND ')}`,
      values
    );
    return (result.values || []).map((row) => JSON.parse(String(row.data_json)) as ConsolidatedReportRecord);
  }
}
