import type { ConsolidatedReportRecord, Transaction } from '@/lib/types';

export interface StorageAdapter {
  readonly name: 'dexie' | 'sqlite';
  init(): Promise<void>;
  saveTransaction(transaction: Transaction): Promise<number>;
  mirrorTransaction(transaction: Transaction & { id: number }): Promise<void>;
  updateTransaction(id: number, changes: Partial<Transaction>): Promise<void>;
  deleteTransaction(id: number): Promise<void>;
  deleteTransactionsByImportBatchIds(importBatchIds: number[]): Promise<void>;
  getTransactions(orgUnitId: number, year?: number, month?: number): Promise<Transaction[]>;
  saveReport(table: 'regionalReports' | 'markazReports', report: ConsolidatedReportRecord): Promise<number>;
  getReports(table: 'regionalReports' | 'markazReports', unitId: number, year?: number, month?: number): Promise<ConsolidatedReportRecord[]>;
}
