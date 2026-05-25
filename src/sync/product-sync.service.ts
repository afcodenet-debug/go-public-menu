import Database from 'better-sqlite3';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { ProductEntity } from '../server/products/types/product.types'; // Réutilisation des types backend

function newId(): string {
  // Node >= 19: randomUUID exists; fallback to crypto.randomUUID-like.
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { randomUUID } = require('crypto') as { randomUUID: () => string };
  return randomUUID();
}

interface OutboxItem {
  id: string;
  entity: string;
  operation: 'insert' | 'update' | 'delete';
  record_id: string;
  payload: string;
  version: number;
  status: string;
}

export class ProductSyncService {
  private db: Database.Database;
  private supabase: SupabaseClient;
  private isRunning = false;
  private lastPullTimestamp: string | null = null;

  private readonly ENTITY_TABLE: Record<string, string> = {
    product: 'products',
    order: 'orders',
    order_item: 'order_items',
  };

  constructor(db: Database.Database, supabaseUrl: string, supabaseAnonKey: string) {
    this.db = db;
    this.supabase = createClient(supabaseUrl, supabaseAnonKey);
  }

  /**
   * Enregistre une modification produit dans l'outbox.
   * 
   * ⚠️ IMPORTANT (Transaction Safety):
   * Cette méthode doit être appelée **à l'intérieur d'une transaction SQLite**
   * qui englobe également la modification du produit lui-même.
   * 
   * Exemple recommandé :
   *   const tx = db.transaction(() => {
   *     // 1. Modifier le produit en local
   *     db.prepare('UPDATE products ...').run(...);
   *     // 2. Enregistrer dans l'outbox
   *     productSyncService.queueProductChangeInsideTransaction(...);
   *   });
   *   tx();
   */
  queueProductChange(operation: 'insert' | 'update' | 'delete', product: Partial<ProductEntity>) {
    this.queueChange('product', operation, product);
  }

  /**
   * Version interne à utiliser uniquement à l'intérieur d'une transaction déjà ouverte.
   * Ne pas appeler directement depuis l'extérieur d'une transaction.
   */
  queueProductChangeInsideTransaction(operation: 'insert' | 'update' | 'delete', product: Partial<ProductEntity>) {
    this.queueChangeInsideTransaction('product', operation, product);
  }

  /**
   * Generic queue for any supported entity (product, order, order_item, ...)
   * Safe to call from outside a transaction.
   */
  queueChange(entity: string, operation: 'insert' | 'update' | 'delete', record: any) {
    const id = newId();
    const payload = JSON.stringify(record);
    const version = (record as any).version || 1;

    this.db.prepare(`
      INSERT INTO sync_outbox (id, entity, operation, record_id, payload, version)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, entity, operation, record.id, payload, version);

    console.log(`[Sync] ${entity} ${operation} queued for ${record.id}`);
  }

  /**
   * Generic queue to be called ONLY from inside an already-open SQLite transaction.
   */
  queueChangeInsideTransaction(entity: string, operation: 'insert' | 'update' | 'delete', record: any) {
    const id = newId();
    const payload = JSON.stringify(record);
    const version = (record as any).version || 1;

    this.db.prepare(`
      INSERT INTO sync_outbox (id, entity, operation, record_id, payload, version)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, entity, operation, record.id, payload, version);
  }

  /**
   * Lance le cycle de synchronisation complet (PUSH + PULL)
   */
  async syncNow(businessId: string): Promise<{ pushed: number; pulled: number; errors: number }> {
    if (this.isRunning) {
      console.log('[Sync] Sync already in progress');
      return { pushed: 0, pulled: 0, errors: 0 };
    }

    this.isRunning = true;
    let pushed = 0, pulled = 0, errors = 0;

    try {
      // 1. PUSH (SQLite → Supabase)
      pushed = await this.pushPendingProducts(businessId);

      // 2. PULL (Supabase → SQLite)
      pulled = await this.pullProductsFromSupabase(businessId);

    } catch (err: any) {
      console.error('[Sync] Sync cycle failed:', err);
      errors++;
    } finally {
      this.isRunning = false;
    }

    return { pushed, pulled, errors };
  }

  /**
   * Generic PUSH for any entity using outbox + version-safe upsert
   */
  async pushPendingByEntity(entity: string, businessId: string): Promise<number> {
    const table = this.ENTITY_TABLE[entity] || `${entity}s`;
    const items: OutboxItem[] = this.db
      .prepare(
        `SELECT * FROM sync_outbox 
         WHERE entity = ? AND status = 'pending' 
         ORDER BY created_at ASC 
         LIMIT 50`
      )
      .all(entity) as unknown as OutboxItem[];

    let successCount = 0;

    for (const item of items) {
      // Mark as in_progress for crash detection + partial failure safety
      this.db.prepare(`UPDATE sync_outbox SET status = 'in_progress' WHERE id = ?`).run(item.id);

      try {
        const payload = JSON.parse(item.payload);

        if (item.operation === 'insert' || item.operation === 'update') {
          // --- Tolerant push for legacy schemas (no business_id, no version, no sync_status) ---
          // Primary goal right now: keep stock_quantity in sync.
          // We only send fields that are very likely to exist in the remote table.
          const safeUpdate: Record<string, any> = {
            updated_at: new Date().toISOString()
          };

          // Only copy safe, commonly present fields from the queued payload
          if (payload.stock_quantity !== undefined) safeUpdate.stock_quantity = payload.stock_quantity;
          if (payload.name !== undefined)            safeUpdate.name = payload.name;
          if (payload.price !== undefined)           safeUpdate.price = payload.price;
          if (payload.selling_price !== undefined)   safeUpdate.selling_price = payload.selling_price;
          if (payload.buying_price !== undefined)    safeUpdate.buying_price = payload.buying_price;
          if (payload.is_available !== undefined)    safeUpdate.is_available = payload.is_available;

          // Use plain update + eq('id') — works on almost any schema without extra columns
          const { error } = await this.supabase
            .from(table)
            .update(safeUpdate)
            .eq('id', item.record_id);

          if (error) throw error;

        } else if (item.operation === 'delete') {
          // Soft-delete tolerant version
          const { error } = await this.supabase
            .from(table)
            .update({ is_available: 0, updated_at: new Date().toISOString() })
            .eq('id', item.record_id);

          if (error) throw error;
        }

        // Mark as successfully pushed
        this.db.prepare(`UPDATE sync_outbox SET status = 'done' WHERE id = ?`).run(item.id);
        successCount++;
      } catch (err: any) {
        this.db.prepare(`
          UPDATE sync_outbox 
          SET status = 'failed', retry_count = retry_count + 1, last_error = ?
          WHERE id = ?
        `).run(err?.message ?? String(err), item.id);

        console.error(`[Sync] Push failed for ${entity} ${item.record_id}:`, err?.message ?? err);
      }
    }

    return successCount;
  }

  /**
   * PUSH : Envoie les changements en attente vers Supabase (Products)
   * Delegates to the generic implementation for DRY + future entities
   */
  private async pushPendingProducts(businessId: string): Promise<number> {
    return this.pushPendingByEntity('product', businessId);
  }

  /**
   * PULL : Récupère les changements depuis Supabase et les applique en local
   */
  private async pullProductsFromSupabase(businessId: string): Promise<number> {
    const since = this.lastPullTimestamp || new Date(0).toISOString();

    const { data, error } = await this.supabase
      .from('products')
      .select('*')
      .eq('business_id', businessId)
      .gt('updated_at', since)
      .order('updated_at', { ascending: true });

    if (error) throw error;

    let applied = 0;

    for (const remoteProduct of (data || []) as Array<{ id: string; version: number; [key: string]: any }>) {
      const local = this.db
        .prepare('SELECT version, updated_at FROM products WHERE id = ?')
        .get(remoteProduct.id) as { version?: number; updated_at?: string } | undefined;

      // Conflit resolution : on prend la version la plus récente
      if (!local || remoteProduct.version > (local.version || 0)) {
        this.db.prepare(`
          INSERT OR REPLACE INTO products 
          (id, business_id, name, price, stock_quantity, updated_at, version, sync_status)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'synced')
        `).run(
          remoteProduct.id,
          remoteProduct.business_id,
          remoteProduct.name,
          remoteProduct.price,
          remoteProduct.stock_quantity,
          remoteProduct.updated_at,
          remoteProduct.version
        );
        applied++;
      }
    }

    if (data && data.length > 0) {
      this.lastPullTimestamp = data[data.length - 1].updated_at;
    }

    return applied;
  }

  /**
   * Méthode utilitaire pour forcer un pull complet (utile après reconnexion longue)
   */
  async forceFullPull(businessId: string): Promise<number> {
    this.lastPullTimestamp = null;
    return this.pullProductsFromSupabase(businessId);
  }

  /** Reset the in-memory pull cursor so the next sync cycle will pull everything */
  resetPullCursor(): void {
    this.lastPullTimestamp = null;
  }
}
