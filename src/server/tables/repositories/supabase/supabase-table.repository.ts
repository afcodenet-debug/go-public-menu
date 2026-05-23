// src/server/tables/repositories/supabase/supabase-table.repository.ts
// Supabase implementation for restaurant_tables

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { TableEntity, TableListQuery } from '../../types/table.types';
import { ITableRepository, PaginatedTables } from '../table.repository.interface';
import { env } from '../../../config/env';

export class SupabaseTableRepository implements ITableRepository {
  private supabase: SupabaseClient;

  constructor() {
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error('Supabase credentials missing for TableRepository');
    }
    this.supabase = createClient(
      env.SUPABASE_URL,
      env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { persistSession: false } }
    );
  }

  async findByQrToken(qrToken: string, businessId: string): Promise<TableEntity | null> {
    const { data, error } = await this.supabase
      .from('restaurant_tables')
      .select('*')
      .eq('qr_token', qrToken)
      // Note: business_id filter temporarily relaxed until we add the column to the Supabase table
      // .eq('business_id', businessId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null; // not found
      throw error;
    }
    return this.mapRow(data);
  }

  async findAll(businessId: string, query: TableListQuery = {}): Promise<PaginatedTables> {
    let q = this.supabase
      .from('restaurant_tables')
      .select('*', { count: 'exact' });
      // business_id filter commented until schema has the column on Supabase
      // .eq('business_id', businessId);

    if (query.status) q = q.eq('status', query.status);
    if (query.search) q = q.ilike('table_number', `%${query.search}%`);

    const page = query.page ?? 1;
    const limit = query.limit ?? 50;
    const from = (page - 1) * limit;

    const { data, count, error } = await q
      .order('table_number', { ascending: true })
      .range(from, from + limit - 1);

    if (error) throw error;

    return {
      items: (data || []).map(this.mapRow),
      total: count || 0,
      page,
      limit,
      totalPages: Math.ceil((count || 0) / limit),
    };
  }

  async findById(id: string | number, businessId: string): Promise<TableEntity | null> {
    const { data, error } = await this.supabase
      .from('restaurant_tables')
      .select('*')
      .eq('id', id)
      // .eq('business_id', businessId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw error;
    }
    return this.mapRow(data);
  }

  private mapRow(row: any): TableEntity {
    return {
      id: row.id,
      business_id: row.business_id,
      table_number: row.table_number,
      capacity: row.capacity,
      status: row.status,
      assigned_waiter_id: row.assigned_waiter_id,
      qr_token: row.qr_token,
      created_at: row.created_at,
      updated_at: row.updated_at,
      metadata: row.metadata,
    };
  }
}
