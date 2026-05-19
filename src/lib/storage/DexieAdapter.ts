import { db, getTransactionsByOrg } from '@/lib/db-offline';
import type { ConsolidatedReportRecord, Transaction } from '@/lib/types';
import type { StorageAdapter } from './StorageAdapter';

export class DexieAdapter implements StorageAdapter {
  readonly name = 'dexie' as const;

  async init() {
    await db.open();
  }

  async saveTransaction(transaction: Transaction) {
    return (await db.transactions.add(transaction)) as number;
  }

  async mirrorTransaction() {
    // Dexie is the source store on web.
  }

  async updateTransaction(id: number, changes: Partial<Transaction>) {
    await db.transactions.update(id, changes);
  }

  async deleteTransaction(id: number) {
    await db.transactions.delete(id);
  }

  async deleteTransactionsByImportBatchIds(importBatchIds: number[]) {
    if (importBatchIds.length === 0) return;
    await db.transactions.where('importBatchId').anyOf(importBatchIds).delete();
  }

  async getTransactions(orgUnitId: number, year?: number, month?: number) {
    return getTransactionsByOrg(orgUnitId, year, month);
  }

  async saveReport(table: 'regionalReports' | 'markazReports', report: ConsolidatedReportRecord) {
    return (await db[table].add(report)) as number;
  }

  async getReports(
    table: 'regionalReports' | 'markazReports',
    unitId: number,
    year?: number,
    month?: number
  ) {
    const rows = await db[table].where('unitId').equals(unitId).toArray();
    return rows.filter((row) => (!year || row.year === year) && (!month || row.month === month));
  }
}
