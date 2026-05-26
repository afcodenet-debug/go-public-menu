// src/sync/sync-orchestrator.ts
// Production-grade orchestration layer for the Product Sync Engine
// Handles scheduling, mutex, offline detection, crash recovery, and lastSync persistence

import { ProductSyncService } from './product-sync.service';
import type Database from 'better-sqlite3';

interface SyncState {
  lastPullTimestamp: string | null;
}

export class SyncOrchestrator {
  private syncService: ProductSyncService;
  private db: Database.Database;
  private businessId: string;
  private isSyncing = false;
  private schedulerInterval: NodeJS.Timeout | null = null;
  private isOnline = true;

  constructor(
    syncService: ProductSyncService,
    db: Database.Database,
    businessId: string
  ) {
    this.syncService = syncService;
    this.db = db;
    this.businessId = businessId;

    this.ensureSyncStateTable();
    this.recoverUnfinishedSync();
    this.recoverInProgressItems(); // NEW: Crash recovery
  }

  private ensureSyncStateTable() {
    // Simple key-value table for sync state (avoids heavy schema changes)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sync_state (
        key TEXT PRIMARY KEY,
        value TEXT
      )
    `);
  }

  private getLastPullTimestamp(): string | null {
    const row = this.db.prepare("SELECT value FROM sync_state WHERE key = 'last_pull_timestamp'").get() as { value: string } | undefined;
    return row?.value || null;
  }

  private setLastPullTimestamp(timestamp: string | null) {
    if (timestamp === null) {
      this.db.prepare(`DELETE FROM sync_state WHERE key = 'last_pull_timestamp'`).run();
      return;
    }
    this.db.prepare(`
      INSERT OR REPLACE INTO sync_state (key, value) 
      VALUES ('last_pull_timestamp', ?)
    `).run(timestamp);
  }

  /**
   * Crash recovery: resume any unfinished outbox items
   */
  private readonly SYNC_ENTITIES = ['product', 'order', 'order_item'] as const;

  private recoverUnfinishedSync() {
    for (const entity of this.SYNC_ENTITIES) {
      const pending = this.db.prepare(`
        SELECT COUNT(*) as count FROM sync_outbox 
        WHERE entity = ? AND status IN ('pending', 'in_progress')
      `).get(entity) as { count: number };

      if (pending.count > 0) {
        console.log(`[SyncOrchestrator] Crash recovery: ${pending.count} pending ${entity} sync items found`);
      }
    }
  }

  /**
   * Récupère les items bloqués en 'in_progress' ou 'failed' après un crash/redémarrage
   * et les remet en 'pending' pour qu'ils soient retentés (toutes entités supportées).
   */
  private recoverInProgressItems() {
    for (const entity of this.SYNC_ENTITIES) {
      const updated = this.db.prepare(`
        UPDATE sync_outbox 
        SET status = 'pending', 
            updated_at = datetime('now')
        WHERE entity = ? 
          AND (status = 'in_progress' OR (status = 'failed' AND retry_count < 5))
      `).run(entity);

      if (updated.changes > 0) {
        console.log(`[SyncOrchestrator] Recovered ${updated.changes} stuck/failed ${entity} sync items to 'pending'`);
      }
    }
  }

  /**
   * Called by the app when network status changes
   */
  setNetworkStatus(isOnline: boolean) {
    const wasOffline = !this.isOnline;
    this.isOnline = isOnline;

    if (isOnline && wasOffline) {
      console.log('[SyncOrchestrator] Network back online - triggering sync');
      this.triggerSync();
    } else if (!isOnline) {
      console.log('[SyncOrchestrator] Network offline - pausing sync');
      this.stopScheduler();
    }
  }

  /**
   * Start the periodic sync scheduler (every X seconds)
   */
  startScheduler(intervalMs = 30000) {
    if (this.schedulerInterval) return;

    this.schedulerInterval = setInterval(() => {
      if (this.isOnline) {
        this.triggerSync();
      }
    }, intervalMs);

    console.log(`[SyncOrchestrator] Periodic sync scheduler started (${intervalMs / 1000}s)`);
  }

  stopScheduler() {
    if (this.schedulerInterval) {
      clearInterval(this.schedulerInterval);
      this.schedulerInterval = null;
    }
  }

  /**
   * Manual or automatic trigger with mutex protection
   */
  async triggerSync(): Promise<void> {
    if (this.isSyncing) {
      console.log('[SyncOrchestrator] Sync already running, skipping');
      return;
    }

    if (!this.isOnline) {
      console.log('[SyncOrchestrator] Offline - sync skipped');
      return;
    }

    this.isSyncing = true;

    try {
      const lastSync = this.getLastPullTimestamp();
      const result = await this.syncService.syncNow(this.businessId);

      // Also push any pending orders (orders use the same generic engine)
      const ordersPushed = await this.syncService.pushPendingByEntity('order', this.businessId);
      const orderItemsPushed = await this.syncService.pushPendingByEntity('order_item', this.businessId);

      if (result.pulled > 0) {
        const now = new Date().toISOString();
        this.setLastPullTimestamp(now);
      }

      const totalPushed = result.pushed + ordersPushed + orderItemsPushed;
      console.log(`[SyncOrchestrator] Sync completed - Pushed: ${totalPushed} (products: ${result.pushed}, orders: ${ordersPushed + orderItemsPushed}), Pulled: ${result.pulled}`);

    } catch (error) {
      console.error('[SyncOrchestrator] Sync failed:', error);
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * Force a full pull (useful after long offline period)
   */
  async forceFullResync(): Promise<void> {
    this.setLastPullTimestamp(null);
    this.syncService.resetPullCursor(); // also clear in-memory cursor on the service
    await this.triggerSync();
  }
}
