// src/server/products/repositories/supabase/supabase-product.repository.ts
import { SupabaseClient } from '@supabase/supabase-js';
import { IProductRepository } from '../product.repository.interface';
import { ProductEntity } from '../../types/product.types';
import { CreateProductDTO, UpdateProductDTO, ProductListQuery } from '../../dtos/product.dto';
import { PaginatedResult } from '../../../types/common.types';
import { getSupabaseClient } from '../../../database/supabase.client'; // Will be created in infrastructure phase
import { DatabaseError, NotFoundError } from '../../../utils/error';

/**
 * Production implementation using Supabase PostgreSQL.
 * This is the target implementation.
 */
export class SupabaseProductRepository implements IProductRepository {
  private readonly supabase: SupabaseClient<any>;
  private readonly table = 'products';

  constructor(supabaseClient?: SupabaseClient<any>) {
    this.supabase = supabaseClient ?? getSupabaseClient();
  }

  async findById(id: string, businessId: string): Promise<ProductEntity | null> {
    const { data, error } = await this.supabase
      .from(this.table)
      .select('*')
      .eq('id', id)
      .eq('business_id', businessId)
      .is('deleted_at', null)
      .single();

    if (error && error.code !== 'PGRST116') {
      throw new DatabaseError(`Failed to fetch product: ${error.message}`);
    }

    return data as ProductEntity | null;
  }

  async findAll(businessId: string, query: ProductListQuery): Promise<PaginatedResult<ProductEntity>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const from = (page - 1) * limit;

    let q = this.supabase
      .from(this.table)
      .select('*', { count: 'exact' })
      .eq('business_id', businessId)
      .is('deleted_at', null);

    // Filters
    if (query.search) {
      q = q.ilike('name', `%${query.search}%`);
    }
    if (query.category_id) {
      q = q.eq('category_id', query.category_id);
    }
    if (query.is_available !== undefined) {
      q = q.eq('is_available', query.is_available);
    }
    if (query.is_featured !== undefined) {
      q = q.eq('is_featured', query.is_featured);
    }

    // Sorting
    const sortColumn = query.sort_by ?? 'sort_order';
    const ascending = (query.sort_order ?? 'asc') === 'asc';
    q = q.order(sortColumn, { ascending });

    const { data, error, count } = await q.range(from, from + limit - 1);

    if (error) {
      throw new DatabaseError(`Failed to list products: ${error.message}`);
    }

    return {
      data: (data ?? []) as ProductEntity[],
      total: count ?? 0,
      page,
      limit,
      hasMore: (from + limit) < (count ?? 0),
    };
  }

  async create(data: CreateProductDTO, businessId: string, createdBy?: string): Promise<ProductEntity> {
    const payload = {
      ...data,
      business_id: businessId,
      price: data.price,
      cost_price: data.cost_price ?? null,
      stock_quantity: data.stock_quantity ?? 0,
      low_stock_threshold: data.low_stock_threshold ?? 5,
      is_available: data.is_available ?? true,
      is_featured: data.is_featured ?? false,
      sort_order: data.sort_order ?? 0,
      version: 1,
      sync_status: 'pending',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const { data: created, error } = await this.supabase
      .from(this.table)
      .insert(payload)
      .select()
      .single();

    if (error) {
      throw new DatabaseError(`Failed to create product: ${error.message}`);
    }

    return created as ProductEntity;
  }

  async update(id: string, data: UpdateProductDTO, businessId: string): Promise<ProductEntity> {
    // First get current version for optimistic locking
    const current = await this.findById(id, businessId);
    if (!current) throw new NotFoundError('Product');

    const { data: updated, error } = await this.supabase
      .from(this.table)
      .update({
        ...data,
        updated_at: new Date().toISOString(),
        version: current.version + 1,
        sync_status: 'pending',
      })
      .eq('id', id)
      .eq('business_id', businessId)
      .is('deleted_at', null)
      .select()
      .single();

    if (error) {
      throw new DatabaseError(`Failed to update product: ${error.message}`);
    }

    return updated as ProductEntity;
  }

  async softDelete(id: string, businessId: string): Promise<void> {
    const { error } = await this.supabase
      .from(this.table)
      .update({
        deleted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        sync_status: 'pending',
      })
      .eq('id', id)
      .eq('business_id', businessId);

    if (error) {
      throw new DatabaseError(`Failed to delete product: ${error.message}`);
    }
  }

  async findAvailableForMenu(businessId: string, categoryId?: string): Promise<ProductEntity[]> {
    let q = this.supabase
      .from(this.table)
      .select('*')
      .eq('business_id', businessId)
      .is('deleted_at', null)
      .eq('is_available', true)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true });

    if (categoryId) {
      q = q.eq('category_id', categoryId);
    }

    const { data, error } = await q;

    if (error) {
      throw new DatabaseError(`Failed to fetch menu products: ${error.message}`);
    }

    return (data ?? []) as ProductEntity[];
  }

  // ==================== Sync Contract Implementation ====================

  async findPendingSync(businessId: string, limit = 100): Promise<ProductEntity[]> {
    const { data, error } = await this.supabase
      .from(this.table)
      .select('*')
      .eq('business_id', businessId)
      .eq('sync_status', 'pending')
      .is('deleted_at', null)
      .order('updated_at', { ascending: true })
      .limit(limit);

    if (error) throw new DatabaseError(error.message);
    return (data ?? []) as ProductEntity[];
  }

  async markAsSynced(ids: string[], businessId: string): Promise<void> {
    if (ids.length === 0) return;

    const { error } = await this.supabase
      .from(this.table)
      .update({ sync_status: 'synced', last_synced_at: new Date().toISOString() })
      .in('id', ids)
      .eq('business_id', businessId);

    if (error) throw new DatabaseError(error.message);
  }

  async getDeltaSince(businessId: string, since: string): Promise<ProductEntity[]> {
    const { data, error } = await this.supabase
      .from(this.table)
      .select('*')
      .eq('business_id', businessId)
      .gt('updated_at', since)
      .order('updated_at', { ascending: true });

    if (error) throw new DatabaseError(error.message);
    return (data ?? []) as ProductEntity[];
  }

  async findByIdWithVersion(id: string, businessId: string): Promise<{ id: string; version: number; updated_at: string } | null> {
    const { data, error } = await this.supabase
      .from(this.table)
      .select('id, version, updated_at')
      .eq('id', id)
      .eq('business_id', businessId)
      .single();

    if (error) return null;
    return data as any;
  }
}
