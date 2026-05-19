// Offline Sync Engine for AMYC PWA
// Handles queue, retry, conflict resolution, and sync status

import { apiPost, apiPut } from '@/lib/api-client';
import { db } from '@/lib/db-offline';
import { useAuthStore } from '@/lib/store';
import type { Transaction } from '@/lib/types';

function txnToApiBody(txn: Transaction) {
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

// Types
export interface SyncQueueItem {
  id: string;
  entityType: 'transaction' | 'note' | 'attachment';
  action: 'create' | 'update' | 'delete';
  payload: string; // JSON stringified data
  status: 'pending' | 'syncing' | 'completed' | 'failed';
  attempts: number;
  maxAttempts: number;
  lastError?: string;
  createdAt: number;
  updatedAt: number;
}

export interface SyncStatus {
  pending: number;
  syncing: number;
  failed: number;
  completed: number;
  lastSyncAt: number | null;
  isOnline: boolean;
}

// Storage key
const SYNC_QUEUE_KEY = 'amyc_sync_queue';
const SYNC_STATUS_KEY = 'amyc_sync_status';

// ============================================================
// Queue Management
// ============================================================

/**
 * Add an item to the sync queue
 */
export function addToSyncQueue(item: Omit<SyncQueueItem, 'id' | 'status' | 'attempts' | 'maxAttempts' | 'createdAt' | 'updatedAt'>): SyncQueueItem {
  const queue = getSyncQueue();

  const newItem: SyncQueueItem = {
    ...item,
    id: `sync_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    status: 'pending',
    attempts: 0,
    maxAttempts: 5,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  queue.push(newItem);
  saveSyncQueue(queue);

  return newItem;
}

/**
 * Get all items in the sync queue
 */
export function getSyncQueue(): SyncQueueItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const data = localStorage.getItem(SYNC_QUEUE_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

/**
 * Save sync queue to localStorage
 */
function saveSyncQueue(queue: SyncQueueItem[]): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(queue));
}

/**
 * Remove completed items older than 24 hours
 */
export function cleanSyncQueue(): void {
  const queue = getSyncQueue();
  const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;

  const cleaned = queue.filter(item => {
    if (item.status === 'completed' && item.updatedAt < oneDayAgo) {
      return false;
    }
    return true;
  });

  saveSyncQueue(cleaned);
}

// ============================================================
// Sync Processing
// ============================================================

/**
 * Process the sync queue - attempt to sync pending/failed items
 */
export async function processSyncQueue(): Promise<{ processed: number; succeeded: number; failed: number }> {
  const queue = getSyncQueue();
  let processed = 0;
  let succeeded = 0;
  let failed = 0;

  const pendingItems = queue.filter(item =>
    item.status === 'pending' || (item.status === 'failed' && item.attempts < item.maxAttempts)
  );

  for (const item of pendingItems) {
    processed++;

    try {
      // Mark as syncing
      updateQueueItem(item.id, { status: 'syncing', updatedAt: Date.now() });

      // Determine API endpoint and method
      const result = await syncItem(item);

      if (result.success) {
        updateQueueItem(item.id, { status: 'completed', updatedAt: Date.now() });
        succeeded++;
      } else {
        const newAttempts = item.attempts + 1;
        const newStatus = newAttempts >= item.maxAttempts ? 'failed' : 'pending';
        updateQueueItem(item.id, {
          status: newStatus,
          attempts: newAttempts,
          lastError: result.error || 'Sync failed',
          updatedAt: Date.now(),
        });
        failed++;
      }
    } catch (error) {
      const newAttempts = item.attempts + 1;
      const newStatus = newAttempts >= item.maxAttempts ? 'failed' : 'pending';
      updateQueueItem(item.id, {
        status: newStatus,
        attempts: newAttempts,
        lastError: error instanceof Error ? error.message : 'Unknown error',
        updatedAt: Date.now(),
      });
      failed++;
    }
  }

  // Update last sync time
  if (typeof window !== 'undefined') {
    localStorage.setItem(SYNC_STATUS_KEY, JSON.stringify({ lastSyncAt: Date.now() }));
  }

  return { processed, succeeded, failed };
}

/**
 * Sync a single queue item to the server
 */
async function syncItem(item: SyncQueueItem): Promise<{ success: boolean; error?: string }> {
  const payload = JSON.parse(item.payload) as Record<string, unknown>;
  const token = useAuthStore.getState().authToken;

  if (!token) {
    return { success: false, error: 'Hakuna token. Ingia tena ukiwa mtandaoni.' };
  }

  if (!navigator.onLine) {
    return { success: false, error: 'Haujaunganishwa' };
  }

  const authHeaders = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'X-Requested-With': 'XMLHttpRequest',
  };

  try {
    if (item.entityType === 'transaction') {
      return await syncTransactionItem(item.action, payload, authHeaders);
    }

    let endpoint = '';
    switch (item.entityType) {
      case 'note':
        endpoint = item.action === 'create' ? '/api/notes' : `/api/notes/${payload.id}`;
        break;
      default:
        return { success: false, error: `Unknown entity type: ${item.entityType}` };
    }

    if (item.action === 'create') {
      await apiPost(endpoint, payload);
    } else if (item.action === 'update') {
      await apiPut(endpoint, payload);
    } else if (item.action === 'delete') {
      const res = await fetch(endpoint, { method: 'DELETE', headers: authHeaders });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        return { success: false, error: (err as { error?: string }).error || res.statusText };
      }
    }

    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Sync failed' };
  }
}

async function syncTransactionItem(
  action: SyncQueueItem['action'],
  payload: Record<string, unknown>,
  authHeaders: Record<string, string>
): Promise<{ success: boolean; error?: string }> {
  const localId = payload.localId as number | undefined;
  const serverId = payload.serverId as number | undefined;
  const apiId = (serverId ?? payload.id) as number;

  if (action === 'create') {
    const { localId: _local, serverId: _srv, id: _id, reason: _r, ...body } = payload;
    const res = (await apiPost('/api/transactions', body)) as { data?: { id: number } };
    const newServerId = res?.data?.id;
    if (localId && newServerId) {
      await db.transactions.update(localId, {
        serverId: newServerId,
        updatedAt: new Date().toISOString(),
      });
    }
    return { success: true };
  }

  if (action === 'update') {
    if (!serverId) {
      return syncTransactionItem('create', payload, authHeaders);
    }
    const txn = localId ? await db.transactions.get(localId) : undefined;
    const apiBody = txn
      ? {
          amount: txn.amount,
          department: txn.department,
          categoryId: txn.categoryId,
          description: txn.description || undefined,
          source: txn.source || undefined,
          vendor: txn.vendor || undefined,
          quantity: txn.quantity ?? undefined,
          unitPrice: txn.unitPrice ?? undefined,
          unit: txn.unit || undefined,
        }
      : payload;
    await apiPut(`/api/transactions/${apiId}`, apiBody);
    return { success: true };
  }

  if (action === 'delete') {
    if (!serverId) {
      return { success: true };
    }
    const reason = encodeURIComponent(String(payload.reason || 'Ufutaji kutoka kifaa'));
    const res = await fetch(`/api/transactions/${apiId}?reason=${reason}`, {
      method: 'DELETE',
      headers: authHeaders,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return { success: false, error: (err as { error?: string }).error || res.statusText };
    }
    return { success: true };
  }

  return { success: false, error: 'Unknown action' };
}

/**
 * Update a queue item
 */
function updateQueueItem(id: string, updates: Partial<SyncQueueItem>): void {
  const queue = getSyncQueue();
  const index = queue.findIndex(item => item.id === id);

  if (index !== -1) {
    queue[index] = { ...queue[index], ...updates };
    saveSyncQueue(queue);
  }
}

// ============================================================
// Conflict Resolution
// ============================================================

/**
 * Resolve a conflict between local and server data
 * Strategy: Server wins for financial data (safety first)
 */
export function resolveConflict(localData: Record<string, unknown>, serverData: Record<string, unknown>): { resolved: Record<string, unknown>; strategy: string } {
  // For financial data, server always wins
  // This prevents accidental overrides of approved/locked data
  return {
    resolved: serverData,
    strategy: 'server_wins',
  };
}

// ============================================================
// Status & Monitoring
// ============================================================

/**
 * Get current sync status
 */
export function getSyncStatus(): SyncStatus {
  const queue = getSyncQueue();
  const statusData = typeof window !== 'undefined'
    ? JSON.parse(localStorage.getItem(SYNC_STATUS_KEY) || '{}')
    : {};

  return {
    pending: queue.filter(i => i.status === 'pending').length,
    syncing: queue.filter(i => i.status === 'syncing').length,
    failed: queue.filter(i => i.status === 'failed').length,
    completed: queue.filter(i => i.status === 'completed').length,
    lastSyncAt: statusData.lastSyncAt || null,
    isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
  };
}

/**
 * Force a full resync
 */
export async function forceResync(): Promise<{ processed: number; succeeded: number; failed: number }> {
  // Reset all failed items to pending
  const queue = getSyncQueue();
  for (const item of queue) {
    if (item.status === 'failed' && item.attempts < item.maxAttempts) {
      item.status = 'pending';
      item.attempts = 0;
    }
  }
  saveSyncQueue(queue);

  // Process the queue
  return processSyncQueue();
}

/**
 * Clear the sync queue (use with caution)
 */
export function clearSyncQueue(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(SYNC_QUEUE_KEY);
}
