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
    console.log('[FORENSIC] qrToken (full):', qrToken);
    console.log('[FORENSIC] qrToken preview:', tokenPreview);
    console.log('[FORENSIC] businessId param:', businessId ?? '(ignored for public QR)');
    console.log('[FORENSIC] RENDER_CLOUD_MODE:', env.RENDER_CLOUD_MODE);
    console.log('[FORENSIC] SUPABASE_URL host:', env.SUPABASE_URL ? new URL(env.SUPABASE_URL).host : null);

    // 1) Exact lookup with full raw response logging
    const lookup = await this.supabase
      .from('restaurant_tables')
      .select('*')
      .eq('qr_token', qrToken)
      .maybeSingle();

    console.log('[FORENSIC] Supabase .maybeSingle() raw result:', {
      hasData: !!lookup.data,
      data: lookup.data,
      error: lookup.error ? {
        code: lookup.error.code,
        message: lookup.error.message,
        details: lookup.error.details,
        hint: lookup.error.hint,
      } : null,
    });

    if (lookup.data) {
      console.log('[FORENSIC] → ROW FOUND via .maybeSingle(), returning it');
      console.log('══════════════════════════════════════════════════════════════');
      return lookup.data as TableEntity;
    }

    // 2) Fallback: try to read the table at all (no filter) to detect RLS / schema / project issues
    const sample = await this.supabase
      .from('restaurant_tables')
      .select('id, table_number, qr_token, created_at')
      .limit(3);

    console.log('[FORENSIC] Sample read from restaurant_tables (no filter, limit 3):', {
      hasRows: !!(sample.data && sample.data.length > 0),
      rows: sample.data,
      error: sample.error ? {
        code: sample.error.code,
        message: sample.error.message,
      } : null,
    });

    // 3) Count with the exact token
    const countRes = await this.supabase
      .from('restaurant_tables')
      .select('*', { count: 'exact', head: true })
      .eq('qr_token', qrToken);

    console.log('[FORENSIC] COUNT for this exact qr_token:', {
      matchingRowCount: countRes.count ?? 0,
      countError: countRes.error ? countRes.error.message : null,
    });

    console.log('[FORENSIC] → FINAL DECISION: returning null (not found via app)');
    console.log('══════════════════════════════════════════════════════════════');

    return null;
  }
}
