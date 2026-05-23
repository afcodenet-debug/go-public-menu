// src/server/tables/repositories/table.repository.provider.ts
import { ITableRepository } from './table.repository.interface';
import { SupabaseTableRepository } from './supabase/supabase-table.repository';
import { LegacySQLiteTableAdapter } from './legacy/legacy-sqlite-table.adapter';
import { env } from '../../config/env';

export function getTableRepository(): ITableRepository {
  const useSupabase = env.USE_SUPABASE_TABLES === true;

  if (useSupabase) {
    return new SupabaseTableRepository();
  }
  return new LegacySQLiteTableAdapter();
}
