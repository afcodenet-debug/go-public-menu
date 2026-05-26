export const NOTIFICATION_TYPES = {
  // Existing
  LOW_STOCK: 'lowStock',
  INVENTORY: 'inventory',
  STOCK_ADJUSTMENT: 'stockAdj',
  SALES: 'sales',
  OUT_OF_STOCK: 'outOfStock',
  PRODUCT_DELETED: 'productDeleted',
  NEW_PRODUCT: 'newProduct',
  ORDER_CONFIRM: 'orderConfirm',

  // New in-app notification types (Phase 1)
  NEW_QR_ORDER: 'newQrOrder',
  ORDER_ASSIGNED: 'orderAssigned',
  STOCK_LOW: 'stockLow',
  PAYMENT_FAILED: 'paymentFailed',
  DAILY_CLOSURE: 'dailyClosure',
  SYSTEM_ERROR: 'systemError',
  PENDING_TOO_LONG: 'pendingTooLong',
} as const;

export type NotificationType =
  typeof NOTIFICATION_TYPES[keyof typeof NOTIFICATION_TYPES];

export type NotificationPriority = 'low' | 'medium' | 'high' | 'critical';
