// Queue local transaction writes for server sync (reports stay on Dexie)

import { addToSyncQueue } from '@/lib/sync-engine';
import type { Transaction } from '@/lib/types';

export const TRANSACTIONS_CHANGED_EVENT = 'amyc-transactions-changed';

export function notifyTransactionsChanged(detail?: {
  orgUnitId?: number;
  orgLevel?: Transaction['orgLevel'];
  type?: Transaction['type'];
  year?: number;
  month?: number;
}) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(TRANSACTIONS_CHANGED_EVENT, { detail }));
}

export function toApiTransactionBody(txn: Transaction) {
  return {
    type: txn.type,
    amount: txn.amount,
    date: txn.date,
    month: txn.month,
    year: txn.year,
    department: txn.department,
    categoryId: txn.categoryId,
    description: txn.description || undefined,
    source: txn.source || undefined,
    vendor: txn.vendor || undefined,
    quantity: txn.quantity ?? undefined,
    unitPrice: txn.unitPrice ?? undefined,
    unit: txn.unit || undefined,
    orgUnitId: txn.orgUnitId,
    importBatchId: txn.importBatchId ?? undefined,
    isOpening: false,
  };
}

export function queueTransactionCreate(txn: Transaction & { id: number }) {
  addToSyncQueue({
    entityType: 'transaction',
    action: 'create',
    payload: JSON.stringify({
      localId: txn.id,
      ...toApiTransactionBody(txn),
    }),
  });
}

export function queueTransactionUpdate(txn: Transaction & { id: number }) {
  const apiId = txn.serverId ?? txn.id;
  addToSyncQueue({
    entityType: 'transaction',
    action: 'update',
    payload: JSON.stringify({
      id: apiId,
      localId: txn.id,
      serverId: txn.serverId,
      ...toApiTransactionBody(txn),
    }),
  });
}

export function queueTransactionDelete(
  txn: Pick<Transaction, 'id' | 'serverId'> & { id: number },
  reason = 'Ufutaji kutoka kifaa (AMYC offline)'
) {
  addToSyncQueue({
    entityType: 'transaction',
    action: 'delete',
    payload: JSON.stringify({
      id: txn.serverId ?? txn.id,
      localId: txn.id,
      serverId: txn.serverId,
      reason,
    }),
  });
}

export function transactionSaveToast(online: boolean): string {
  if (online) {
    return 'Imehifadhiwa kwenye kifaa na itasawazishwa na seva.';
  }
  return 'Imehifadhiwa kwenye kifaa. Itasawazishwa ukirudi mtandaoni.';
}
