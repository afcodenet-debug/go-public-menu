// src/server/products/repositories/product.sync.contract.ts
// Sync contract for the Products domain
// This interface must be implemented by both SupabaseProductRepository and LegacySQLiteProductAdapter
// so that the Sync Engine can treat them uniformly.

import { ProductEntity } from '../types/product.types';

export interface IProductSyncContract {
  /**
   * Returns products that have sync_status = 'pending' for a given business.
   * Used by the Sync Engine to push local changes to Supabase.
   */
  findPendingSync(businessId: string, limit?: number): Promise<ProductEntity[]>;

  /**
   * Marks a list of product IDs as successfully synchronized.
   */
  markAsSynced(ids: string[], businessId: string): Promise<void>;

  /**
   * Returns products modified after a given timestamp (for pull / delta sync).
   */
  getDeltaSince(businessId: string, since: string): Promise<ProductEntity[]>;

  /**
   * Used during conflict resolution.
   */
  findByIdWithVersion(id: string, businessId: string): Promise<{ id: string; version: number; updated_at: string } | null>;
}
