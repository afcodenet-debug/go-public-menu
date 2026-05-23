export interface TableEntity {
  id: string | number;
  table_number: string;
  capacity: number;
  status: string;
  assigned_waiter_id?: number | string | null;
  qr_token: string | null;
}

export interface ITableRepository {
  findByQrToken(qrToken: string, businessId: string): Promise<TableEntity | null>;
}
