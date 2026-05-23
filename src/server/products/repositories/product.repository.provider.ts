// src/server/products/repositories/product.repository.provider.ts
import { IProductRepository } from './product.repository.interface';
import { SupabaseProductRepository } from './supabase/supabase-product.repository';
import { LegacySQLiteProductAdapter } from './legacy/legacy-sqlite-product.adapter';
import { env } from '../../config/env';

/**
 * Central place that decides which repository implementation to use.
 * This is the only place that knows about feature flags for the Products domain.
 */
export function getProductRepository(): IProductRepository {
  const useSupabase = env.USE_SUPABASE_PRODUCTS === true;

  if (useSupabase) {
    return new SupabaseProductRepository();
  }

  // Fallback to legacy during migration
  return new LegacySQLiteProductAdapter();
}
