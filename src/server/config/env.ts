// src/server/config/env.ts (minimal version for Products migration start)
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3001),

  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20).optional(),

  // Feature flags for incremental migration
  USE_SUPABASE_PRODUCTS: z.coerce.boolean().default(false),
  USE_SUPABASE_CATEGORIES: z.coerce.boolean().default(false),
  USE_SUPABASE_TABLES: z.coerce.boolean().default(false),
  USE_SUPABASE_ORDERS: z.coerce.boolean().default(false),

  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60000),
  RATE_LIMIT_MAX: z.coerce.number().default(100),
});

export const env = envSchema.parse(process.env);
export type Env = z.infer<typeof envSchema>;
