import { create } from 'zustand';
import { api } from '../lib/api-client';
import { withOutboxTransaction } from '../sync/with-outbox-transaction';
// Note: real outbox queuing for offline happens in Electron main process via IPC.
// Renderer calls here are best-effort / will be wired when local DB writes move to main.

export interface OrderItem {
  productId: number;
  name: string;
  price: number;
  quantity: number;
}

export interface Order {
  id: number;
  table_id: number;
  waiter_id: number;
  status: 'pending' | 'confirmed' | 'preparing' | 'ready' | 'served' | 'paid' | 'cancelled' | 'rejected';
  items: OrderItem[];
  total: number;
  created_at: string;
  table_number?: string;
  waiter_name?: string;
  waiter_role?: string;
  payment_status?: 'pending' | 'completed';
  payment_method?: string;
  items_count?: number;
  duration_minutes?: number;
  customer_id?: number | null;
  customer_phone?: string;
  customer_name?: string;
  // QR / remote orders (pulled from Supabase via the light pull worker)
  remote_id?: number;
  source?: 'local' | 'qr' | string;
}

interface OrderStore {
  activeOrders: Order[];
  allOrders: Order[];
  stats: {
    active_orders: number;
    preparing_orders: number;
    ready_orders: number;
    served_orders: number;
    paid_orders: number;
    revenue_today: number;
  };
  filters: {
    status?: string;
    payment_status?: string;
    table_id?: number;
    search?: string;
  };
  userId?: number;
  role?: string;
  pendingQrCount: number;
  setUserContext: (userId: number, role: string) => void;
  setFilters: (filters: Partial<OrderStore['filters']>) => void;
  fetchActiveOrders: () => Promise<void>;
  fetchAllOrders: () => Promise<void>;
  createOrder: (order: Omit<Order, 'id' | 'created_at'>) => Promise<Order | null>;
  updateOrderItems: (id: number, items: OrderItem[]) => Promise<void>;
  updateOrderStatus: (id: number, status: Order['status']) => Promise<void>;
  deleteOrder: (id: number) => Promise<void>;
}

export const useOrderStore = create<OrderStore>((set, get) => ({
  activeOrders: [],
  allOrders: [],
  stats: {
    active_orders: 0,
    preparing_orders: 0,
    ready_orders: 0,
    served_orders: 0,
    paid_orders: 0,
    revenue_today: 0
  },
  filters: {},
  userId: undefined,
  role: undefined,
  pendingQrCount: 0,

  setUserContext: (userId, role) => set({ userId, role }),

  setFilters: (newFilters) => set((state) => ({
    filters: { ...state.filters, ...newFilters }
  })),

  fetchActiveOrders: async () => {
    const { userId, role } = get();
    try {
      const params: Record<string, string | number> = {};
      if (userId && role) {
        params.waiter_id = userId;
        params.role = role;
      }
      const orders = await api.orders.getAll(params);
      set({ activeOrders: Array.isArray(orders) ? orders : [] });
    } catch (err) {
      console.error('Failed to fetch active orders', err);
      set({ activeOrders: [] });
    }
  },

  fetchAllOrders: async () => {
    const { userId, role, filters } = get();
    try {
      const params: Record<string, string | number> = {};
      if (userId && role) {
        params.waiter_id = userId;
        params.role = role;
      }
      if (filters.status) params.status = filters.status;
      if (filters.payment_status) params.payment_status = filters.payment_status;
      if (filters.table_id) params.table_id = filters.table_id;
      if (filters.search) params.search = filters.search;

      console.log('[OrderStore] Fetching orders with params:', params);
      const response: any = await api.orders.getAllOrders(params);

      if (response && typeof response === 'object' && Array.isArray(response.orders)) {
        console.log('[OrderStore] Received orders:', response.orders.length);

        const orders = response.orders as Order[];
        // Centralised pending QR detection (used by Sidebar badge + global toast)
        const pendingQr = orders.filter(o => o.status === 'pending');
        const pendingQrCount = pendingQr.length;

        set({
          allOrders: orders,
          stats: (response.stats as OrderStore['stats']) || get().stats,
          pendingQrCount
        });
      } else {
        console.warn('[OrderStore] Invalid response format:', response);
        set({ allOrders: [], pendingQrCount: 0 });
      }
    } catch (err) {
      console.error('Failed to fetch all orders:', err);
      set({ allOrders: [] });
    }
  },

  createOrder: async (orderData) => {
    try {
      const newOrder: any = await api.orders.create(orderData);
      if (newOrder) {
        set({ activeOrders: [...get().activeOrders, newOrder as Order] });

        // === TRANSACTIONAL OUTBOX QUEUE (enforced for future offline-first) ===
        // When running in Electron main with local SQLite, the real DB write + queue
        // would happen inside this transaction. Renderer currently only calls the API.
        try {
          withOutboxTransaction(null, 'default-business', () => {
            // In full offline mode we would also do the local INSERT here
            // and then: orderSyncService.queueChangeInsideTransaction('order', 'insert', newOrder);
            console.log('[OrderStore] Order created via API — outbox queue will be handled by main-process sync engine');
          });
        } catch (syncErr) {
          console.warn('[OrderStore] Outbox transaction wrapper failed (non-blocking)', syncErr);
        }

        return newOrder as Order;
      }
      return null;
    } catch (err) {
      console.error('Failed to create order', err);
      return null;
    }
  },

  updateOrderItems: async (id, items) => {
    try {
      await api.orders.updateItems(id, items);
      get().fetchActiveOrders();
    } catch (err) {
      console.error('Failed to update items', err);
    }
  },

  updateOrderStatus: async (id, status) => {
    try {
      const { role } = get();
      await api.orders.updateStatus(id, status, role);

      // Enforce transaction layer for future offline sync (no-op in current renderer context)
      try {
        withOutboxTransaction(null, 'default-business', () => {
          // When local writes are done in main: 
          //   orderSyncService.queueChangeInsideTransaction('order', 'update', { id, status, ... });
          console.log(`[OrderStore] Status update for order ${id} — will be queued by sync engine`);
        });
      } catch (syncErr) {
        console.warn('[OrderStore] Transaction wrapper for order status failed (non-blocking)', syncErr);
      }

      get().fetchActiveOrders();
    } catch (err) {
      console.error('Failed to update status', err);
    }
  },

  deleteOrder: async (id) => {
    try {
      const { role } = get();
      await api.orders.delete(id, role);
      // remove locally and refetch for consistency
      set({
        allOrders: get().allOrders.filter(o => o.id !== id),
        activeOrders: get().activeOrders.filter(o => o.id !== id)
      });
      // background refresh stats etc.
      get().fetchAllOrders();
    } catch (err) {
      console.error('Failed to delete order', err);
      throw err;
    }
  }
}));

// Auto-feed the global notification store when new QR orders arrive
// (light integration - can be moved to a dedicated watcher later)
import { useNotificationStore } from './useNotificationStore';

let previousPendingQr = 0;
useOrderStore.subscribe((state) => {
  const current = state.pendingQrCount;
  if (current > previousPendingQr) {
    const diff = current - previousPendingQr;
    useNotificationStore.getState().addNotification({
      type: 'newQrOrder' as any,
      title: 'Nouvelle commande QR',
      message: `${diff} nouvelle(s) commande(s) en attente de validation`,
      priority: 'high',
      link: '/orders',
      metadata: { count: current },
    });
  }
  previousPendingQr = current;
});
