import { create } from 'zustand';
import { NotificationType, NotificationPriority } from '../constants/notificationTypes';

export interface AppNotification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  priority: NotificationPriority;
  createdAt: string;
  readAt?: string;
  metadata?: Record<string, any>;
  link?: string; // e.g. '/orders?highlight=123'
}

interface NotificationStore {
  notifications: AppNotification[];
  unreadCount: number;

  // Actions
  addNotification: (payload: Omit<AppNotification, 'id' | 'createdAt'>) => void;
  markAsRead: (id: string) => void;
  markAllAsRead: () => void;
  clearAll: () => void;

  // Used by watchers / pollers to inject server-side notifications
  ingestNotifications: (incoming: AppNotification[]) => void;

  // Future: load from backend (Phase 3 persistence)
  loadFromServer?: () => Promise<void>;

  // Role-based filtering helper (simple)
  getVisibleNotifications: (role?: string) => AppNotification[];
}

const MAX_NOTIFICATIONS = 100;

export const useNotificationStore = create<NotificationStore>((set, get) => ({
  notifications: [],
  unreadCount: 0,

  addNotification: (payload) => {
    const notif: AppNotification = {
      id: `notif_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      createdAt: new Date().toISOString(),
      ...payload,
    };

    set((state) => {
      const newList = [notif, ...state.notifications].slice(0, MAX_NOTIFICATIONS);
      return {
        notifications: newList,
        unreadCount: newList.filter((n) => !n.readAt).length,
      };
    });
  },

  markAsRead: (id) => {
    set((state) => {
      const updated = state.notifications.map((n) =>
        n.id === id ? { ...n, readAt: new Date().toISOString() } : n
      );
      return {
        notifications: updated,
        unreadCount: updated.filter((n) => !n.readAt).length,
      };
    });
  },

  markAllAsRead: () => {
    set((state) => {
      const updated = state.notifications.map((n) => ({
        ...n,
        readAt: n.readAt || new Date().toISOString(),
      }));
      return {
        notifications: updated,
        unreadCount: 0,
      };
    });
  },

  clearAll: () => set({ notifications: [], unreadCount: 0 }),

  ingestNotifications: (incoming) => {
    if (!incoming || incoming.length === 0) return;

    set((state) => {
      const existingIds = new Set(state.notifications.map((n) => n.id));
      const trulyNew = incoming.filter((n) => !existingIds.has(n.id));

      if (trulyNew.length === 0) return state;

      const merged = [...trulyNew, ...state.notifications].slice(0, MAX_NOTIFICATIONS);
      return {
        notifications: merged,
        unreadCount: merged.filter((n) => !n.readAt).length,
      };
    });
  },

  getVisibleNotifications: (role) => {
    const all = get().notifications;

    // Simple role-based filtering (can be expanded)
    if (!role) return all;

    return all.filter((n) => {
      // Example rules - can be made more sophisticated
      if (role === 'waiter') {
        return ['newQrOrder', 'orderAssigned', 'orderConfirm'].some((t) =>
          n.type.includes(t)
        );
      }
      if (role === 'cashier') {
        return ['paymentFailed', 'dailyClosure', 'newQrOrder'].some((t) =>
          n.type.includes(t)
        );
      }
      // admin + manager see everything
      return true;
    });
  },

  // UI state for the NotificationCenter drawer
  isCenterOpen: false,
  openCenter: () => set({ isCenterOpen: true }),
  closeCenter: () => set({ isCenterOpen: false }),
}));
