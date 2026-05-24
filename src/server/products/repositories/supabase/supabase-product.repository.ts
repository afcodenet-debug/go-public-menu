import { createClient } from '@supabase/supabase-js';
import { env } from '../../../config/env';
import { IProductRepository } from '../product.repository.interface';
import { ProductEntity } from '../../types/product.types';

export class SupabaseProductRepository implements IProductRepository {
  private supabase = createClient(env.SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

  async findById(id: string, businessId?: string): Promise<ProductEntity | null> {
    let qb = this.supabase
      .from('products')
      .select('*')
      .eq('id', id)
      .is('deleted_at', null);

    if (businessId) {
      qb = qb.eq('business_id', businessId);
    }

    const { data, error } = await qb.maybeSingle();

    if (error) throw error;
    return data ? this.map(data) : null;
  }

  async findAll(
    businessId?: string,
    query?: {
      page?: number;
      limit?: number;
      search?: string;
      category_id?: string;
      is_available?: boolean;
      is_featured?: boolean;
      sort_by?: 'name' | 'price' | 'stock_quantity' | 'created_at' | 'sort_order';
      sort_order?: 'asc' | 'desc';
    }
  ): Promise<{
    data: ProductEntity[];
    total: number;
    page: number;
    limit: number;
    hasMore: boolean;
  }> {
    const page = query?.page ?? 1;
    const limit = query?.limit ?? 50;
    const from = (page - 1) * limit;

    let qb = this.supabase
      .from('products')
      .select('*', { count: 'exact' })
      .is('deleted_at', null);

    if (businessId) {
      qb = qb.eq('business_id', businessId);
    }

    if (query?.search) {
      qb = qb.ilike('name', `%${query.search}%`);
    }
    if (query?.category_id) {
      qb = qb.eq('category_id', query.category_id);
    }
    if (typeof query?.is_available === 'boolean') {
      qb = qb.eq('is_available', query.is_available);
    }
    if (typeof query?.is_featured === 'boolean') {
      qb = qb.eq('is_featured', query.is_featured);
    }

    const sortBy = query?.sort_by ?? 'sort_order';
    const sortOrder = query?.sort_order ?? 'asc';
    qb = qb.order(sortBy as any, { ascending: sortOrder === 'asc' });

    qb = qb.range(from, from + limit - 1);

    const { data, error, count } = await qb;
    if (error) throw error;

    const total = count ?? 0;
    const hasMore = from + limit < total;

    return {
      data: (data || []).map(this.map),
      total,
      page,
      limit,
      hasMore,
    };
  }

  async create(dto: any, businessId?: string, userId?: string): Promise<ProductEntity> {
    const payload: any = {
      ...dto,
      // Only include business_id if provided (single-tenant mode may not have the column)
      ...(businessId ? { business_id: businessId } : {}),
      ...(userId ? { created_by: userId, updated_by: userId } : {}),
    };

    const { data, error } = await this.supabase.from('products').insert(payload).select('*').single();
    if (error) throw error;
    return this.map(data);
  }

  async update(id: string, dto: any, businessId?: string): Promise<ProductEntity> {
    const payload = { ...dto };

    let qb = this.supabase
      .from('products')
      .update(payload)
      .eq('id', id)
      .is('deleted_at', null);

    if (businessId) {
      qb = qb.eq('business_id', businessId);
    }

    const { data, error } = await qb.select('*').single();

    if (error) throw error;
    return this.map(data);
  }

  async softDelete(id: string, businessId?: string): Promise<void> {
    let qb = this.supabase
      .from('products')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id)
      .is('deleted_at', null);

    if (businessId) {
      qb = qb.eq('business_id', businessId);
    }

    const { error } = await qb;

    if (error) throw error;
  }

  private map(row: any): ProductEntity {
    return {
      id: row.id,
      business_id: row.business_id,
      branch_id: row.branch_id ?? null,
      category_id: row.category_id,
      name: row.name,
      description: row.description ?? null,
      sku: row.sku ?? null,
      barcode: row.barcode ?? null,
      // The current Supabase products table uses legacy columns (selling_price / buying_price).
      // We map them to the new model fields so the rest of the app can consume them uniformly.
      price: row.price ?? row.selling_price ?? null,
      cost_price: row.cost_price ?? row.buying_price ?? null,
      stock_quantity: row.stock_quantity ?? 0,
      low_stock_threshold: row.low_stock_threshold ?? 0,
      image_url: row.image_url ?? null,
      is_available: !!row.is_available,
      is_featured: !!row.is_featured,
      sort_order: row.sort_order ?? 0,
      metadata: row.metadata ?? null,
      version: row.version ?? 0,
      sync_status: row.sync_status,
      created_at: row.created_at,
      updated_at: row.updated_at,
      deleted_at: row.deleted_at ?? null,
    };
  }
}
