/**
 * withOutboxTransaction
 *
 * Executes the given callback inside a better-sqlite3 transaction when a real
 * Database instance is provided (typical in Electron main process).
 *
 * When db is null (renderer / early dev), it runs the callback directly.
 * The caller is responsible for also calling syncService.queueChangeInsideTransaction(...)
 * from *inside* the callback so that local write + outbox insert are atomic.
 *
 * Future: renderer usage will go through IPC to the main-process sync engine.
 */

import type Database from 'better-sqlite3';

export type OutboxQueuedOperation = {
  entity: string;
  operation: 'insert' | 'update' | 'delete' | string;
  record_id: string;
  payload: unknown;
  version?: number;
};

type TxCallback<T> = () => T;

export function withOutboxTransaction<T>(
  db: Database.Database | null,
  _businessId: string,
  callback: TxCallback<T>
): T {
  if (!db) {
    // Renderer or no local DB context yet — run non-transactionally.
    // The queue calls inside will be ignored or forwarded via IPC later.
    return callback();
  }

  const tx = db.transaction(() => {
    return callback();
  });

  return tx();
}
