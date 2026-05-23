// src/server/tables/repositories/table.repository.interface.ts

import { TableEntity, TableListQuery } from '../types/table.types';

export interface PaginatedTables {
  items: TableEntity[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface ITableRepository {
  findByQrToken(qrToken: string, businessId: string): Promise<TableEntity | null>;
  findAll(businessId: string, query?: TableListQuery): Promise<PaginatedTables>;
  findById(id: string | number, businessId: string): Promise<TableEntity | null>;
  // Add update/assign later when we migrate the admin UI
}
