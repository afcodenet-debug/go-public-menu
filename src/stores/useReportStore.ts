import { create } from 'zustand';
import { api } from '../lib/api-client';

export interface SalesReport {
  date: string;
  total_sales: number;
  total_amount: number;
  transaction_count: number;
}

export interface ProductReport {
  product_id: number;
  product_name: string;
  quantity_sold: number;
  revenue: number;
}

export interface PaymentMethodReport {
  payment_method: string;
  total: number;
  count: number;
}

export interface CategoryReport {
  category_name: string;
  revenue: number;
  items_sold: number;
}

export interface InventoryMovement {
  id: number;
  product_id: number;
  product_name: string;
  movement_type: string;
  quantity_before: number;
  quantity_changed: number;
  quantity_after: number;
  created_at: string;
  reason: string;
}

interface ReportStore {
  dailySales: SalesReport[];
  weeklySales: SalesReport[];
  monthlySales: SalesReport[];
  topProducts: ProductReport[];
  lowStock: { id: number; name: string; stock_quantity: number; minimum_stock: number }[];
  paymentMethods: PaymentMethodReport[];
  categoriesPerformance: CategoryReport[];
  inventoryMovements: InventoryMovement[];
  summary: {
    totalRevenue: number;
    totalTransactions: number;
    avgTicket: number;
    topProduct: { product_name: string; quantity_sold: number; revenue: number } | null;
    lowStockCount: number;
  } | null;
  loading: boolean;
  fetchDailySales: (date: string) => Promise<void>;
  fetchWeeklySales: (startDate: string, endDate: string) => Promise<void>;
  fetchMonthlySales: (month: string, year: string) => Promise<void>;
  fetchTopProducts: (limit?: number) => Promise<void>;
  fetchLowStock: () => Promise<void>;
  fetchPaymentMethods: (params?: { start?: string; end?: string }) => Promise<void>;
  fetchCategoriesPerformance: (params?: { start?: string; end?: string }) => Promise<void>;
  fetchInventoryMovements: (params?: { start?: string; end?: string; product_id?: number; limit?: number }) => Promise<void>;
  fetchSummary: (params?: { start?: string; end?: string }) => Promise<void>;
}

export const useReportStore = create<ReportStore>((set) => ({
  dailySales: [],
  weeklySales: [],
  monthlySales: [],
  topProducts: [],
  lowStock: [],
  paymentMethods: [],
  categoriesPerformance: [],
  inventoryMovements: [],
  summary: null,
  loading: false,

  fetchDailySales: async (date) => {
    set({ loading: true });
    try {
      const data = await api.reports.dailySales(date);
      set({ dailySales: Array.isArray(data) ? data : [] });
    } catch (err) {
      console.error('Failed to fetch daily sales', err);
    } finally {
      set({ loading: false });
    }
  },

  fetchWeeklySales: async (startDate, endDate) => {
    set({ loading: true });
    try {
      const data = await api.reports.weeklySales(startDate, endDate);
      set({ weeklySales: Array.isArray(data) ? data : [] });
    } catch (err) {
      console.error('Failed to fetch weekly sales', err);
    } finally {
      set({ loading: false });
    }
  },

  fetchMonthlySales: async (month, year) => {
    set({ loading: true });
    try {
      const data = await api.reports.monthlySales(month, year);
      set({ monthlySales: Array.isArray(data) ? data : [] });
    } catch (err) {
      console.error('Failed to fetch monthly sales', err);
    } finally {
      set({ loading: false });
    }
  },

  fetchTopProducts: async (limit = 10) => {
    set({ loading: true });
    try {
      const data = await api.reports.topProducts(limit);
      set({ topProducts: Array.isArray(data) ? data : [] });
    } catch (err) {
      console.error('Failed to fetch top products', err);
    } finally {
      set({ loading: false });
    }
  },

  fetchLowStock: async () => {
    set({ loading: true });
    try {
      const data = await api.reports.lowStock();
      set({ lowStock: Array.isArray(data) ? data : [] });
    } catch (err) {
      console.error('Failed to fetch low stock', err);
    } finally {
      set({ loading: false });
    }
  },

  fetchPaymentMethods: async (params) => {
    set({ loading: true });
    try {
      const data = await api.reports.paymentMethods(params);
      set({ paymentMethods: Array.isArray(data) ? data : [] });
    } catch (err) {
      console.error('Failed to fetch payment methods', err);
    } finally {
      set({ loading: false });
    }
  },

  fetchCategoriesPerformance: async (params) => {
    set({ loading: true });
    try {
      const data = await api.reports.categoriesPerformance(params);
      set({ categoriesPerformance: Array.isArray(data) ? data : [] });
    } catch (err) {
      console.error('Failed to fetch categories performance', err);
    } finally {
      set({ loading: false });
    }
  },

  fetchInventoryMovements: async (params) => {
    set({ loading: true });
    try {
      const data = await api.reports.inventoryMovements(params);
      set({ inventoryMovements: Array.isArray(data) ? data : [] });
    } catch (err) {
      console.error('Failed to fetch inventory movements', err);
    } finally {
      set({ loading: false });
    }
  },

  fetchSummary: async (params) => {
    set({ loading: true });
    try {
      const data = await api.reports.summary(params);
      set({ summary: data });
    } catch (err) {
      console.error('Failed to fetch summary', err);
    } finally {
      set({ loading: false });
    }
  }
}));