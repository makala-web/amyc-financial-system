import { db } from '@/lib/db-offline';
import type { Transaction } from '@/lib/types';
import { getStorageAdapter } from './index';

const BULK_CHUNK_SIZE = 250;

export interface BulkProgress {
  processed: number;
  total: number;
  chunkSize: number;
}

export async function addTransaction(transaction: Transaction) {
  const adapter = await getStorageAdapter();
  return adapter.saveTransaction(transaction);
}

export async function mirrorTransaction(transaction: Transaction & { id: number }) {
  const adapter = await getStorageAdapter();
  await adapter.mirrorTransaction(transaction);
}

export async function bulkAddTransactions(
  transactions: Transaction[],
  onProgress?: (progress: BulkProgress) => void
) {
  const allIds: number[] = [];

  for (let index = 0; index < transactions.length; index += BULK_CHUNK_SIZE) {
    const chunk = transactions.slice(index, index + BULK_CHUNK_SIZE);
    const ids = (await db.transactions.bulkAdd(chunk, { allKeys: true })) as number[];
    allIds.push(...ids);

    const saved = await db.transactions.bulkGet(ids);
    await Promise.all(
      saved
        .filter((transaction): transaction is Transaction & { id: number } => Boolean(transaction?.id))
        .map((transaction) => mirrorTransaction(transaction))
    );

    onProgress?.({
      processed: Math.min(index + chunk.length, transactions.length),
      total: transactions.length,
      chunkSize: chunk.length,
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  return allIds;
}

export async function updateTransaction(id: number, changes: Partial<Transaction>) {
  const adapter = await getStorageAdapter();
  await adapter.updateTransaction(id, changes);
}

export async function deleteTransaction(id: number) {
  const adapter = await getStorageAdapter();
  await adapter.deleteTransaction(id);
}

export async function deleteTransactionsByImportBatchIds(importBatchIds: number[]) {
  const adapter = await getStorageAdapter();
  await adapter.deleteTransactionsByImportBatchIds(importBatchIds);
}
