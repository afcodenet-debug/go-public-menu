// src/server/tables/types/table.types.ts
// Table entity for the clean architecture (Supabase first)

export interface TableEntity {
  id: string | number;
  business_id: string;
  table_number: string;
  capacity: number;
  status: 'available' | 'occupied' | 'reserved' | 'active' | string;
  assigned_waiter_id: number | string | null;
  qr_token: string | null;
  created_at: string;
  updated_at: string;
  metadata?: Record<string, any> | null;
}

export interface TableListQuery {
  page?: number;
  limit?: number;
  status?: string;
  search?: string;
  assigned_waiter_id?: string | number;
}
