// src/server/types/database.types.ts
// Placeholder for Supabase generated types.
// Run `npx supabase gen types typescript --project-id <your-project-id> > src/server/types/database.types.ts`
// once you have a Supabase project.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Database {
  public: {
    Tables: {
      products: {
        Row: {
          id: string;
          business_id: string;
          branch_id: string | null;
          category_id: string | null;
          name: string;
          description: string | null;
          sku: string | null;
          barcode: string | null;
          price: string;
          cost_price: string | null;
          stock_quantity: number;
          low_stock_threshold: number;
          image_url: string | null;
          is_available: boolean;
          is_featured: boolean;
          sort_order: number;
          metadata: Json | null;
          version: number;
          sync_status: string;
          created_at: string;
          updated_at: string;
          deleted_at: string | null;
        };
        Insert: {
          id?: string;
          business_id: string;
          branch_id?: string | null;
          category_id?: string | null;
          name: string;
          description?: string | null;
          sku?: string | null;
          barcode?: string | null;
          price: string;
          cost_price?: string | null;
          stock_quantity?: number;
          low_stock_threshold?: number;
          image_url?: string | null;
          is_available?: boolean;
          is_featured?: boolean;
          sort_order?: number;
          metadata?: Json | null;
          version?: number;
          sync_status?: string;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
        };
        Update: {
          id?: string;
          business_id?: string;
          branch_id?: string | null;
          category_id?: string | null;
          name?: string;
          description?: string | null;
          sku?: string | null;
          barcode?: string | null;
          price?: string;
          cost_price?: string | null;
          stock_quantity?: number;
          low_stock_threshold?: number;
          image_url?: string | null;
          is_available?: boolean;
          is_featured?: boolean;
          sort_order?: number;
          metadata?: Json | null;
          version?: number;
          sync_status?: string;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
        };
      };
      // Add other tables as needed during migration
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      [_ in never]: never;
    };
  };
}
