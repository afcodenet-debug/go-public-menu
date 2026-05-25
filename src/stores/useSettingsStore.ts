import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { api } from '../lib/api-client';
import { useAuthStore } from './useAuthStore';
import { APP_NAME } from '../lib/app-config';

export type Currency = 'ZMW' | 'CDF' | 'USD' | 'EUR';
export type Language = 'en' | 'fr' | 'pt';

export type Role = 'ADMIN' | 'MANAGER' | 'SERVER' | 'WAITER';
export type NotificationType = 
  | 'lowStock'
  | 'outOfStock'
  | 'inventory'
  | 'stockAdj'
  | 'sales'
  | 'newProduct'
  | 'productDeleted'
  | 'orderConfirm';

export interface RoleNotificationSettings {
  notifications: Partial<Record<NotificationType, boolean>>;
  emails: string[];
}


export interface RoleNotificationConfig {
  ADMIN: RoleNotificationSettings;
  MANAGER: RoleNotificationSettings;
  SERVER: RoleNotificationSettings;
  WAITER?: RoleNotificationSettings;
}


export interface SettingsState {
  language: Language;
  currency: Currency;
  currencySymbol: string;
  exchangeRates: Record<Currency, number>;
  isLoading: boolean;
  
  // Business & Regional
  businessName: string;
  address: string;
  phone: string;
  email: string;
  operatingCountry: string;
  
  // Financial
  taxRate: number;
  serviceCharge: number;
  
  // Receipt
  receiptFooter: string;
  autoPrint: boolean;
  showLogo: boolean;
  
  // Notifications (email)
  emailNotificationsEnabled: boolean;
  emailProvider: 'ethereal' | 'smtp2go' | 'custom';
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string;
  smtpPass: string;
  emailForwardTo: string;
  notifyStockAdjustment: boolean;
  notifyInventoryUpdate: boolean;
  notifyLowStock: boolean;
  notifyOutOfStock: boolean;
  notifyNewProduct: boolean;
  notifyProductDeleted: boolean;
  notifySales: boolean;


  // Role-based notifications
  roleNotificationConfig: RoleNotificationConfig;
  
  
  // Actions
  fetchSettings: () => Promise<void>;
  setLanguage: (lang: Language) => Promise<void>;
  setCurrency: (currency: Currency) => Promise<void>;
  updateSettings: (updates: Partial<SettingsState>) => Promise<boolean>;

}

const defaultRoleConfig: RoleNotificationConfig = {
  ADMIN: { notifications: { lowStock: true, inventory: true, stockAdj: true, sales: true, newProduct: true, orderConfirm: true, productDeleted: true, outOfStock: true }, emails: [] },
  MANAGER: { notifications: { lowStock: true, inventory: true, stockAdj: true, sales: true, orderConfirm: true, outOfStock: true }, emails: [] },
  SERVER: { notifications: { sales: true, orderConfirm: true }, emails: [] },
  WAITER: { notifications: { sales: true, orderConfirm: true, lowStock: true }, emails: [] }
};

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      language: 'en',
      currency: 'ZMW',
      currencySymbol: 'ZK',
      exchangeRates: { ZMW: 1, CDF: 100, USD: 0.04, EUR: 0.035 },
      isLoading: false,

      businessName: APP_NAME,
      address: '123 Mufulira Road, Lusaka',
      phone: '+260 97 123 4567',
      email: 'info@greatolive.zm',
      operatingCountry: 'ZM',
      
      taxRate: 16.0,
      serviceCharge: 5.0,
      
      receiptFooter: 'Thank you for dining with us • Visit us again soon',
      autoPrint: true,
      showLogo: true,

      // Email notifications
      emailNotificationsEnabled: true,
      emailProvider: 'ethereal',
      smtpHost: '',
      smtpPort: 587,
      smtpSecure: false,
      smtpUser: '',
      smtpPass: '',
      emailForwardTo: '',
      notifyStockAdjustment: true,
      notifyInventoryUpdate: true,
      notifyLowStock: true,
      notifyOutOfStock: true,
      notifyNewProduct: true,
      notifyProductDeleted: true,
      notifySales: true,
      
      // Role-based notifications with default configuration
      roleNotificationConfig: {
        ADMIN: {
          notifications: {
            lowStock: true,
            inventory: true,
            stockAdj: true,
            sales: true,
            newProduct: true,
            orderConfirm: true,
            productDeleted: true,
            outOfStock: true
          },
          emails: ['admin@olive.com']
        },
        MANAGER: {
          notifications: {
            lowStock: true,
            inventory: true,
            stockAdj: true,
            sales: true,
            newProduct: false,
            orderConfirm: true,
            productDeleted: false,
            outOfStock: true
          },
          emails: []
        },
        SERVER: {
          notifications: {
            lowStock: false,
            inventory: false,
            stockAdj: false,
            sales: true,
            newProduct: false,
            orderConfirm: true,
            productDeleted: false,
            outOfStock: false
          },
          emails: []
        }
      },

      fetchSettings: async () => {
        set({ isLoading: true });
        try {
          const role = useAuthStore.getState().user?.role;
          const normalizedRole =
            typeof role === 'string' ? role.toLowerCase() : undefined;

          // Backend expects x-user-role. Without it, requireAuth returns 403.
          const settings = await api.get<Record<string, any>>('/settings', { role: normalizedRole });
          
          const updates: Partial<SettingsState> = {};
          
          if (settings.app_language) {
            updates.language = settings.app_language as Language;
            i18n.changeLanguage(settings.app_language);
          }
          if (settings.app_currency) updates.currency = settings.app_currency as Currency;
          if (settings.currency_symbol) updates.currencySymbol = settings.currency_symbol;
          if (settings.exchange_rates) updates.exchangeRates = typeof settings.exchange_rates === 'string' ? JSON.parse(settings.exchange_rates) : settings.exchange_rates;
          
          if (settings.business_name) updates.businessName = settings.business_name;
          if (settings.address) updates.address = settings.address;
          if (settings.phone) updates.phone = settings.phone;
          if (settings.email) updates.email = settings.email;
          if (settings.operating_country) updates.operatingCountry = settings.operating_country;
          
          if (settings.tax_rate !== undefined) updates.taxRate = Number(settings.tax_rate);
          if (settings.service_charge !== undefined) updates.serviceCharge = Number(settings.service_charge);
          
          if (settings.receipt_footer) updates.receiptFooter = settings.receipt_footer;
          if (settings.auto_print !== undefined) updates.autoPrint = !!settings.auto_print;
          if (settings.show_logo !== undefined) updates.showLogo = !!settings.show_logo;
          
          if (settings.email_notifications_enabled !== undefined) updates.emailNotificationsEnabled = !!settings.email_notifications_enabled;
          if (settings.email_provider) updates.emailProvider = settings.email_provider as any;
          if (settings.smtp_host) updates.smtpHost = settings.smtp_host;
          if (settings.smtp_port !== undefined) updates.smtpPort = Number(settings.smtp_port);
          if (settings.smtp_secure !== undefined) updates.smtpSecure = !!settings.smtp_secure;
          if (settings.smtp_user) updates.smtpUser = settings.smtp_user;
          if (settings.smtp_pass) updates.smtpPass = settings.smtp_pass;
          if (settings.email_forward_to) updates.emailForwardTo = settings.email_forward_to;
          if (settings.notify_stock_adjustment !== undefined) updates.notifyStockAdjustment = !!settings.notify_stock_adjustment;
          if (settings.notify_inventory_update !== undefined) updates.notifyInventoryUpdate = !!settings.notify_inventory_update;
          if (settings.notify_low_stock !== undefined) updates.notifyLowStock = !!settings.notify_low_stock;
          if (settings.notify_out_of_stock !== undefined) updates.notifyOutOfStock = !!settings.notify_out_of_stock;
          if (settings.notify_new_product !== undefined) updates.notifyNewProduct = !!settings.notify_new_product;
          if (settings.notify_product_deleted !== undefined) updates.notifyProductDeleted = !!settings.notify_product_deleted;
          if (settings.notify_sales !== undefined) updates.notifySales = !!settings.notify_sales;
          
          // Handle role notification config - always ensure it's a valid object
          if (settings.role_notification_config !== undefined) {
            let parsedConfig: RoleNotificationConfig | null = null;
            
            if (typeof settings.role_notification_config === 'object') {
              parsedConfig = settings.role_notification_config as RoleNotificationConfig;
            } else if (typeof settings.role_notification_config === 'string') {
              try {
                parsedConfig = JSON.parse(settings.role_notification_config) as RoleNotificationConfig;
              } catch (e) {
                console.warn('[Settings] Failed to parse role_notification_config:', e);
              }
            }
            
            if (parsedConfig) {
              updates.roleNotificationConfig = {
                ...defaultRoleConfig,
                ...parsedConfig
              };
            }
          }

          // Parse role notification config
          if (settings.role_notification_config) {
            updates.roleNotificationConfig = {
              ...defaultRoleConfig,
              ...settings.role_notification_config
            };
          }
          
          set(updates);
        } catch (error: any) {
          // Completely silent on permission errors (403)
          if (error.message?.includes('403') || error.message?.includes('Insufficient permissions')) {
            return;
          }
          if (!error.message?.includes('404') && !error.message?.includes('Failed to fetch')) {
            console.warn('[Settings] Could not load from server, using local defaults.');
          }
        } finally {
          set({ isLoading: false });
        }
      },

      setLanguage: async (lang: Language) => {
        set({ language: lang });
        i18n.changeLanguage(lang);

        const role = useAuthStore.getState().user?.role;
        if (role === 'admin' || role === 'manager') {
          await get().updateSettings({ language: lang });
        }
      },


      setCurrency: async (currency: Currency) => {
        const symbols: Record<Currency, string> = {
          ZMW: 'ZK',
          CDF: 'FC',
          USD: '$',
          EUR: '€'
        };
        const symbol = symbols[currency];
        set({ currency, currencySymbol: symbol });

        const role = useAuthStore.getState().user?.role;
        if (role === 'admin' || role === 'manager') {
          await get().updateSettings({ currency, currencySymbol: symbol });
        }
      },

      updateSettings: async (updates) => {
        const role = useAuthStore.getState().user?.role;
        if (role !== 'admin' && role !== 'manager') {
          set(updates); // Still update locally
          return true;
        }

        // Prepare payload for backend (convert camelCase to snake_case where needed)
        const payload: Record<string, any> = { ...updates };
        
        if (updates.language) payload.app_language = updates.language;
        if (updates.currency) payload.app_currency = updates.currency;
        if (updates.currencySymbol) payload.currency_symbol = updates.currencySymbol;
        if (updates.exchangeRates) payload.exchange_rates = JSON.stringify(updates.exchangeRates);
        
        if (updates.businessName) payload.business_name = updates.businessName;
        if (updates.address) payload.address = updates.address;
        if (updates.phone) payload.phone = updates.phone;
        if (updates.email) payload.email = updates.email;
        if (updates.operatingCountry) payload.operating_country = updates.operatingCountry;
        
        if (updates.taxRate !== undefined) payload.tax_rate = updates.taxRate;
        if (updates.serviceCharge !== undefined) payload.service_charge = updates.serviceCharge;
        
        if (updates.receiptFooter) payload.receipt_footer = updates.receiptFooter;
        if (updates.autoPrint !== undefined) payload.auto_print = updates.autoPrint;
        if (updates.showLogo !== undefined) payload.show_logo = updates.showLogo;
        
        if (updates.emailNotificationsEnabled !== undefined) payload.email_notifications_enabled = updates.emailNotificationsEnabled;
        if (updates.emailProvider) payload.email_provider = updates.emailProvider;
        if (updates.smtpHost) payload.smtp_host = updates.smtpHost;
        if (updates.smtpPort !== undefined) payload.smtp_port = updates.smtpPort;
        if (updates.smtpSecure !== undefined) payload.smtp_secure = updates.smtpSecure;
        if (updates.smtpUser) payload.smtp_user = updates.smtpUser;
        if (updates.smtpPass) payload.smtp_pass = updates.smtpPass;
        if (updates.emailForwardTo) payload.email_forward_to = updates.emailForwardTo;
        if (updates.notifyStockAdjustment !== undefined) payload.notify_stock_adjustment = updates.notifyStockAdjustment;
        if (updates.notifyInventoryUpdate !== undefined) payload.notify_inventory_update = updates.notifyInventoryUpdate;
        if (updates.notifyLowStock !== undefined) payload.notify_low_stock = updates.notifyLowStock;
        if (updates.notifyOutOfStock !== undefined) payload.notify_out_of_stock = updates.notifyOutOfStock;
        if (updates.notifyNewProduct !== undefined) payload.notify_new_product = updates.notifyNewProduct;
        if (updates.notifyProductDeleted !== undefined) payload.notify_product_deleted = updates.notifyProductDeleted;
        if (updates.notifySales !== undefined) payload.notify_sales = updates.notifySales;
        
        // Role-based notification config → always stringify for DB
        if (updates.roleNotificationConfig !== undefined) {
          payload.role_notification_config = typeof updates.roleNotificationConfig === 'string'
            ? updates.roleNotificationConfig
            : JSON.stringify(updates.roleNotificationConfig);
          delete (payload as any).roleNotificationConfig;
        }

        set(updates); // Update locally immediately

        try {
          const response = await api.patch<{ success: boolean }>('/settings', payload, { role });
          return response?.success ?? true;
        } catch (error: any) {
          if (error.message?.includes('403')) {
            console.error('Failed to update settings:', error);
            return false;
          }
          if (error.message?.includes('404') || error.message?.includes('Failed to fetch')) {
            console.warn('[Settings] Backend not reachable — changes saved locally only.');
            return true;
          }
          console.error('Failed to update settings on server:', error);
          return false;
        }
      }
    }),
    { name: 'olive-pos-settings' }
  )
);