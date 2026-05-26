// src/sync/index.ts
// Point d'entrée du module Sync Engine

import { ProductSyncService } from './product-sync.service';
import type Database from 'better-sqlite3';

let productSyncService: ProductSyncService | null = null;

function ensureOutboxTable(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sync_outbox (
      id TEXT PRIMARY KEY,
      entity TEXT NOT NULL,
      operation TEXT NOT NULL,
      record_id TEXT NOT NULL,
      payload TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      status TEXT DEFAULT 'pending',
      retry_count INTEGER DEFAULT 0,
      last_error TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_sync_outbox_status ON sync_outbox(status, entity);
    CREATE INDEX IF NOT EXISTS idx_sync_outbox_entity ON sync_outbox(entity, status);
  `);
}

export function initializeProductSync(
  db: Database.Database, 
  supabaseUrl: string, 
  supabaseAnonKey: string
): ProductSyncService {
  if (!productSyncService) {
    ensureOutboxTable(db);
    productSyncService = new ProductSyncService(db, supabaseUrl, supabaseAnonKey);
    console.log('[Sync] ProductSyncService initialized (outbox table ensured)');
  }
  return productSyncService;
}

export function getProductSyncService(): ProductSyncService {
  if (!productSyncService) {
    throw new Error('ProductSyncService not initialized. Call initializeProductSync first.');
  }
  return productSyncService;
}

// Helper pour lancer la sync périodiquement (à appeler depuis le main process)
export function startPeriodicSync(businessId: string, intervalMs = 30000) {
  const service = getProductSyncService();
  
  setInterval(async () => {
    try {
      const result = await service.syncNow(businessId);
      if (result.pushed > 0 || result.pulled > 0) {
        console.log(`[Sync] Cycle completed - Pushed: ${result.pushed}, Pulled: ${result.pulled}`);
      }
    } catch (err) {
      console.error('[Sync] Periodic sync failed:', err);
    }
  }, intervalMs);

  console.log(`[Sync] Periodic sync started every ${intervalMs / 1000}s`);
}

export { SyncOrchestrator } from './sync-orchestrator';
