import { create } from 'zustand';
import { api } from '../lib/api-client';
import { useProductStore } from '../features/products/hooks/useProductStore';
import { ReceiptData } from '../utils/receiptPrinter';

export interface POSCartItem {
  productId: number;
  name: string;
  price: number;
  quantity: number;
  notes?: string;
}

export interface POSOrder {
  id?: number;
  table_id: number | null;
  waiter_id: number;
  items: POSCartItem[];
  total: number;
   status: 'pending' | 'confirmed' | 'preparing' | 'ready' | 'served' | 'paid' | 'cancelled' | 'rejected';
  discount?: number;
  tax?: number;
  customer_name?: string;
  customer_phone?: string;
}

interface POSStore {
  // State
  selectedTableId: number | null;
  cart: POSCartItem[];
  currentOrder: any | null;
  isLoading: boolean;
  isProcessing: boolean;
  error: string | null;

  // Cart Actions
  addToCart: (product: { id: number; name: string; selling_price: number }) => void;
  updateQuantity: (productId: number, quantity: number) => void;
  removeFromCart: (productId: number) => void;
  clearCart: () => void;

  // Table Actions
  selectTable: (tableId: number | null) => void;
  loadOrderForTable: (tableId: number, orderId?: number) => Promise<void>;

  // Order Actions
  saveOrder: () => Promise<boolean>;
  checkout: (paymentMethod: string) => Promise<{ success: boolean; receipt?: ReceiptData; error?: string; partial?: boolean; blockedItems?: Array<{ name: string; quantity: number }> }>;

  // UI Actions
  setLoading: (loading: boolean) => void;
  setProcessing: (processing: boolean) => void;
  setError: (error: string | null) => void;

  // Data Loading
  loadProducts: () => Promise<void>;
}

export const usePOSStore = create<POSStore>((set, get) => ({
  selectedTableId: null,
  cart: [],
  currentOrder: null,
  isLoading: false,
  isProcessing: false,
  error: null,

  addToCart: (product) => {
    const { cart } = get();
    const existingItem = cart.find(item => item.productId === product.id);

    if (existingItem) {
      set({
        cart: cart.map(item =>
          item.productId === product.id
            ? { ...item, quantity: item.quantity + 1 }
            : item
        )
      });
    } else {
      set({
        cart: [...cart, {
          productId: product.id,
          name: product.name,
          price: product.selling_price,
          quantity: 1
        }]
      });
    }
  },

  updateQuantity: (productId, quantity) => {
    if (quantity <= 0) {
      get().removeFromCart(productId);
      return;
    }

    const { cart } = get();
    set({
      cart: cart.map(item =>
        item.productId === productId
          ? { ...item, quantity }
          : item
      )
    });
  },

  removeFromCart: (productId) => {
    const { cart } = get();
    set({
      cart: cart.filter(item => item.productId !== productId)
    });
  },

  clearCart: () => {
    set({ cart: [], currentOrder: null });
  },

  selectTable: (tableId) => {
    const { cart, currentOrder } = get();
    set({ selectedTableId: tableId, error: null });

    if (!tableId) {
      // User cleared table selection
      if (cart.length > 0 && !currentOrder) {
        // Keep the draft cart (quick sale / counter mode)
        return;
      }
      get().clearCart();
      return;
    }

    // Real table selected.
    // If we already have a draft cart that has never been saved to an order,
    // we MUST NOT destroy it. loadOrderForTable will now respect this.
    get().loadOrderForTable(tableId);
  },

  loadOrderForTable: async (tableId, orderId) => {
    set({ isLoading: true, error: null });
    try {
      let existingOrder: any = null;

      if (orderId) {
        // Preferred path for explicit cashout from Orders page: load the exact order (even if 'served')
        // getById always returns normalized items (including remote QR snapshot + local prices)
        try {
          existingOrder = await api.orders.getById(orderId);
          if (existingOrder && existingOrder.table_id !== tableId) {
            existingOrder = null; // safety
          }
        } catch (e) {
          console.warn('[POS] Failed to load specific orderId', orderId, e);
        }
      }

      if (!existingOrder) {
        // Fallback: find the current active order on the table via the normal list
        const response = (await api.orders.getAll({ table_id: tableId })) as any;
        const activeOrders = Array.isArray(response)
          ? response
          : (response?.activeOrders || response?.orders || []);

        existingOrder = (Array.isArray(activeOrders)
          ? (activeOrders as any[]).find((order: any) => order.table_id === tableId && order.status !== 'paid' && order.status !== 'cancelled')
          : null) as any;
      }

      const { cart: currentCart, currentOrder: existingCurrentOrder } = get();
      const hasUnsavedDraft = currentCart.length > 0 && !existingCurrentOrder;

      if (existingOrder) {
        // Table already has an open order in the database
        if (hasUnsavedDraft) {
          // Professional behavior: keep the user's draft items.
          // Do NOT wipe the cart. We only attach the knowledge that an order already exists.
          // The user can later decide to merge (future enhancement) or finish the draft first.
          set({
            currentOrder: existingOrder as POSOrder,
            isLoading: false
          });
          // cart stays untouched
        } else {
          // Normal case: no draft, just load the existing order's items
          set({
            currentOrder: existingOrder as POSOrder,
            cart: (existingOrder as any).items || [],
            isLoading: false
          });
        }
      } else {
        // No existing order on this table
        if (hasUnsavedDraft) {
          // Keep the beautiful draft the user just built.
          // We only record that future "Open Ticket" will target this table.
          set({ currentOrder: null, isLoading: false });
        } else {
          // Clean state
          set({ currentOrder: null, cart: [], isLoading: false });
        }
      }
    } catch (err: any) {
      console.error('Failed to load order for table', err);
      set({ error: err.message || 'Failed to load order', isLoading: false });
    }
  },

  saveOrder: async () => {
    const { selectedTableId, cart, currentOrder } = get();
    
    // Better way: get from auth store
    const { useAuthStore } = await import('./useAuthStore');
    const authUser = useAuthStore.getState().user;

    if (!selectedTableId || cart.length === 0) {
      set({ error: 'Please select a table and add items to cart' });
      return false;
    }

    set({ isProcessing: true, error: null });

    try {
      const orderData = {
        table_id: selectedTableId,
        waiter_id: authUser?.id || 1,
        items: cart,
        total: cart.reduce((sum, item) => sum + (item.price * item.quantity), 0),
        status: 'pending' as const
      };

      if (currentOrder) {
        // Update existing order
        const role = authUser?.role;
        await api.orders.updateItems(currentOrder.id!, cart, role);
      } else {
        // Create new order
        const role = authUser?.role;
        const newOrder = await api.orders.create(orderData, role);
        if (newOrder) {
          set({ currentOrder: newOrder });
        }
      }

      set({ isProcessing: false });
      return true;
    } catch (err: any) {
      console.error('Failed to save order', err);
      set({ error: err.message || 'Failed to save order', isProcessing: false });
      return false;
    }
  },

  checkout: async (paymentMethod) => {
    const { currentOrder } = get();
    const { useAuthStore } = await import('./useAuthStore');
    const authUser = useAuthStore.getState().user;

    if (!currentOrder) {
      return { success: false, error: 'No active order to checkout' };
    }

    set({ isProcessing: true, error: null });

    try {
      if (currentOrder?.id) {
        const role = authUser?.role;
        await api.orders.updateItems(currentOrder.id, get().cart, role);
        set({
          currentOrder: {
            ...currentOrder,
            items: get().cart,
            total: get().cart.reduce((sum, item) => sum + item.price * item.quantity, 0)
          }
        });
      }

      const checkoutData = {
        order_id: currentOrder.id,
        items: get().cart,
        payment_method: paymentMethod,
        user_id: authUser?.id || 1,
        discount: currentOrder.discount || 0,
        tax: currentOrder.tax || 0
      };

      const role = authUser?.role;
      const result = (await api.sales.checkout(checkoutData, role)) as any;
      const soldItems = Array.isArray(result.soldItems) && result.soldItems.length > 0
        ? result.soldItems
        : get().cart.map(item => ({
            name: item.name,
            quantity: item.quantity,
            price: item.price,
            totalPrice: item.price * item.quantity
          }));

      const subtotal = soldItems.reduce((sum: number, item: any) => sum + Number(item.price) * Number(item.quantity), 0);
      const discount = result.partial ? Math.round((subtotal / (get().cart.reduce((sum, item) => sum + (item.price * item.quantity), 0) || 1)) * (currentOrder.discount || 0)) : (currentOrder.discount || 0);
      const tax = result.partial ? Math.round((subtotal / (get().cart.reduce((sum, item) => sum + (item.price * item.quantity), 0) || 1)) * (currentOrder.tax || 0)) : (currentOrder.tax || 0);

      const receiptData = {
        business: {
          name: 'GREAT OLIVE',
          address: '123 Restaurant Street',
          phone: '+1 (555) 123-4567'
        },
        invoice: {
          number: result.invoiceNumber || `INV-${Date.now()}`,
          date: new Date().toISOString(),
          table: `Table ${currentOrder.table_id || 'N/A'}`,
          waiter: (currentOrder as any).waiter_name || authUser?.full_name || 'Staff',
          cashier: authUser?.full_name || 'Staff'
        },
        items: soldItems.map((item: any) => ({
          name: item.name,
          quantity: item.quantity,
          unitPrice: item.price,
          totalPrice: item.totalPrice
        })),
        totals: {
          subtotal,
          tax,
          discount,
          total: subtotal - discount + tax
        },
        payment: {
          method: paymentMethod.toUpperCase(),
          amount: subtotal - discount + tax
        },
        footer: 'Thank you for your visit!\nSee you soon at GREAT OLIVE'
      };

      if (result.partial && result.remainingOrder) {
        set({
          cart: result.remainingOrder.items,
          currentOrder: {
            ...currentOrder,
            items: result.remainingOrder.items,
            total: result.remainingOrder.total
          },
          isProcessing: false
        });
      } else {
        set({
          cart: [],
          currentOrder: null,
          selectedTableId: null,
          isProcessing: false
        });
      }

      useProductStore.getState().fetchProducts().catch((err) => {
        console.error('[POSStore] Failed to refresh products after checkout', err);
      });

      return {
        success: true,
        receipt: receiptData,
        partial: Boolean(result.partial),
        blockedItems: result.blockedItems || []
      };
    } catch (error: any) {
      console.error('Error in checkout process:', error);
      set({ error: error.message || 'Checkout failed', isProcessing: false });
      return { success: false, error: error.message || 'Checkout failed' };
    }
  },

  setLoading: (loading) => set({ isLoading: loading }),
  setProcessing: (processing) => set({ isProcessing: processing }),
  setError: (error) => set({ error }),

  loadProducts: async () => {
    // This is now handled by useProductStore and DataLoader
    console.log('[POSStore] loadProducts called (deprecated)');
  },
}));
