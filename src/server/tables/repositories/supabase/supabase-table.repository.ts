import { createClient } from '@supabase/supabase-js';
import { TableEntity, ITableRepository } from '../table.repository.interface';
import { env } from '../../../config/env';

export class SupabaseTableRepository implements ITableRepository {
  private supabase = createClient(env.SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false }
  });

  constructor() {
    console.log('[SupabaseTableRepository] Initialized', {
      hasUrl: !!env.SUPABASE_URL,
      hasServiceKey: !!env.SUPABASE_SERVICE_ROLE_KEY,
      urlHost: env.SUPABASE_URL ? new URL(env.SUPABASE_URL).host : null,
      USE_SUPABASE_TABLES: env.USE_SUPABASE_TABLES,
    });
  }

  async findByQrToken(qrToken: string, businessId?: string): Promise<TableEntity | null> {
    const tokenPreview = qrToken ? qrToken.slice(0, 8) + '...' + qrToken.slice(-4) : null;

    console.log('══════════════════════════════════════════════════════════════');
    console.log('[FORENSIC] SupabaseTableRepository.findByQrToken START');
    console.log('[FORENSIC] qrToken (FULL):', qrToken);
    console.log('[FORENSIC] qrToken preview:', tokenPreview);
    console.log('[FORENSIC] RENDER_CLOUD_MODE:', env.RENDER_CLOUD_MODE);
    console.log('[FORENSIC] SUPABASE_URL host:', env.SUPABASE_URL ? new URL(env.SUPABASE_URL).host : 'MISSING');

    // === FORENSIC MODE: Unfiltered read + JS filter (to bypass any RLS / filter issue) ===
    console.log('[FORENSIC] Executing unfiltered SELECT * from restaurant_tables (limited)');

    const { data: allRows, error: allError } = await this.supabase
      .from('restaurant_tables')
      .select('*')
      .limit(50);   // forensic safety limit

    if (allError) {
      console.error('[FORENSIC] ERROR reading restaurant_tables (no filter):', {
        code: allError.code,
        message: allError.message,
        details: allError.details,
        hint: allError.hint,
      });
      return null;
    }

    console.log('[FORENSIC] Total rows visible to this client (unfiltered):', allRows?.length ?? 0);

    // Try to find the token in JS
    const matchingRow = allRows?.find((row: any) => row.qr_token === qrToken);

    if (matchingRow) {
      console.log('[FORENSIC] ✓ FOUND via unfiltered + JS filter. Row:', matchingRow);
      console.log('══════════════════════════════════════════════════════════════');
      return matchingRow as TableEntity;
    }

    // Log all qr_token values we can see (for diagnosis)
    const visibleTokens = allRows?.map((r: any) => r.qr_token).filter(Boolean) ?? [];
    console.log('[FORENSIC] Visible qr_token values in first 50 rows:', visibleTokens);

    // Also try the original filtered query for comparison
    const { data: filteredData, error: filteredError } = await this.supabase
      .from('restaurant_tables')
      .select('*')
      .eq('qr_token', qrToken)
      .maybeSingle();

    console.log('[FORENSIC] Direct .eq(qr_token) result:', {
      hasData: !!filteredData,
      data: filteredData,
      error: filteredError ? {
        code: filteredError.code,
        message: filteredError.message,
        details: filteredError.details,
        hint: filteredError.hint,
      } : null,
    });

    console.log('[FORENSIC] → FINAL: Row not visible to this Supabase client');
    console.log('══════════════════════════════════════════════════════════════');

    return null;
  }
}
