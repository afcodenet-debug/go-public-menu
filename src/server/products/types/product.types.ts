// src/server/products/types/product.types.ts
// Product domain types - Blueprint for the entire migration

export type UUID = string;
export type Timestamp = string;

export const PRODUCT_SYNC_STATUS = ['pending', 'synced', 'conflict', 'failed'] as const;
export type ProductSyncStatus = (typeof PRODUCT_SYNC_STATUS)[number];

/**
 * ProductEntity - Exact shape coming from the database.
 * This is the only place where the raw DB structure is defined.
 */
export interface ProductEntity {
  id: UUID;
  business_id: UUID;
  branch_id: UUID | null;           // Future multi-branch support
  category_id: UUID | null;
  name: string;
  description: string | null;
  sku: string | null;
  barcode: string | null;
  price: string;                    // Always string (numeric in DB) - NEVER use number/float for money
  cost_price: string | null;
  stock_quantity: number;
  low_stock_threshold: number;
  image_url: string | null;
  is_available: boolean;
  is_featured: boolean;
  sort_order: number;
  metadata: Record<string, any> | null;
  version: number;
  sync_status: ProductSyncStatus;
  created_at: Timestamp;
  updated_at: Timestamp;
  deleted_at: Timestamp | null;
}
