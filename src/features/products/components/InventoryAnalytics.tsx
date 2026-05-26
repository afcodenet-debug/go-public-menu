import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../../lib/api-client';
import { useI18n } from '../../../lib/i18n';
import { useSettingsStore } from '../../../stores/useSettingsStore';
import { formatPrice } from '../../../lib/i18n/currency';

/* ─── Types ──────────────────────────────────────────────────────────────── */
interface LowStockItem { product_id: number; product_name: string; category_name: string; stock: number; minimum_stock: number; urgency: 'critical' | 'warning'; }
interface TopSeller    { product_id: number; product_name: string; category_name: string; units_sold: number; revenue: number; estimated_cost: number; }
interface FastMoving   { product_id: number; product_name: string; category_name: string; units_sold_30d: number; turnover_days: number; }
interface DeadStock    { product_id: number; product_name: string; stock_quantity: number; minimum_stock: number; units_sold_90d: number; dead_stock_value: number; category_name: string; }
interface WasteItem    { reason: string; occurrences: number; total_qty: number; total_cost: number; }
interface AnalyticsData {
  valuation: { total_inventory_value: number; potential_gross_profit: number; actual_gross_profit: number; active_skus: number; };
  top_selling_products: TopSeller[];
  low_stock_alerts:     LowStockItem[];
  dead_stock:           DeadStock[];
  fast_moving_items:    FastMoving[];
  waste_analytics:      WasteItem[];
  stock_turnover_summary: FastMoving[];
}

/* ─── Styles ─────────────────────────────────────────────────────────────── */
const STYLES = `
  @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');

  .ia-root {
    --bg:          #09090f;
    --surface:     #111118;
    --card:        #16161f;
    --card-hi:     #1c1c27;
    --border:      #1e1e2e;
    --border-hi:   #28283a;
    --text-1:      #eeeef5;
    --text-2:      #88889a;
    --text-3:      #44445a;
    --amber:       #f59e0b;
    --amber-dim:   rgba(245,158,11,0.08);
    --blue:        #3b82f6;
    --blue-dim:    rgba(59,130,246,0.08);
    --green:       #10b981;
    --green-dim:   rgba(16,185,129,0.08);
    --red:         #ef4444;
    --red-dim:     rgba(239,68,68,0.08);
    --purple:      #a78bfa;
    --purple-dim:  rgba(167,139,250,0.08);
    --gold:        #d4af37;
    --gold-dim:    rgba(212,175,55,0.08);
    font-family: 'DM Sans', sans-serif;
    color: var(--text-1);
  }
  .ia-root * { box-sizing: border-box; }

  /* ── KPI card ── */
  .ia-kpi {
    background: var(--card); border: 1px solid var(--border); border-radius: 14px;
    padding: 20px 22px; position: relative; overflow: hidden;
    transition: border-color 180ms ease, transform 150ms ease;
  }
  .ia-kpi:hover { border-color: var(--border-hi); transform: translateY(-2px); }
  .ia-kpi::before {
    content: ''; position: absolute; top: 0; left: 0; right: 0; height: 1px;
    background: linear-gradient(90deg, rgba(255,255,255,0.07), transparent);
  }

  /* ── section card ── */
  .ia-sec {
    background: var(--card); border: 1px solid var(--border); border-radius: 14px; overflow: hidden;
  }
  .ia-sec-hd {
    display: flex; align-items: center; justify-content: space-between;
    padding: 14px 20px; border-bottom: 1px solid var(--border);
    background: rgba(255,255,255,0.012);
  }

  /* ── table row ── */
  .ia-tr {
    display: flex; align-items: center; padding: 0 16px; height: 52px;
    border-bottom: 1px solid var(--border); transition: background 120ms ease;
  }
  .ia-tr:last-child { border-bottom: none; }
  .ia-tr:hover { background: rgba(255,255,255,0.012); }
  .ia-th { height: 34px; background: rgba(255,255,255,0.018); border-bottom: 1px solid var(--border); cursor: default; }
  .ia-th:hover { background: rgba(255,255,255,0.018); }

  /* ── stock bar ── */
  .ia-bar { height: 4px; background: rgba(255,255,255,0.05); border-radius: 2px; margin-top: 4px; overflow: hidden; }
  .ia-bar-fill { height: 100%; border-radius: 2px; transition: width 600ms ease; }

  /* ── badge ── */
  .ia-badge {
    display: inline-flex; align-items: center; gap: 4px;
    padding: 3px 9px; border-radius: 20px;
    font-size: 10.5px; font-weight: 600; white-space: nowrap;
  }

  /* ── rank badge ── */
  .ia-rank {
    width: 24px; height: 24px; border-radius: 6px; flex-shrink: 0;
    display: flex; align-items: center; justify-content: center;
    font-size: 10.5px; font-weight: 700; font-family: 'JetBrains Mono', monospace;
  }

  /* ── refresh btn ── */
  .ia-refresh {
    display: flex; align-items: center; gap: 7px; padding: 8px 16px;
    background: var(--card); border: 1px solid var(--border); border-radius: 9px;
    color: var(--text-2); font-size: 12.5px; font-weight: 600; cursor: pointer;
    font-family: 'DM Sans', sans-serif; transition: all 140ms ease;
  }
  .ia-refresh:hover { border-color: var(--border-hi); color: var(--text-1); }
  .ia-refresh.spinning svg { animation: ia-spin 0.8s linear infinite; }

  /* ── mono ── */
  .mono { font-family: 'JetBrains Mono', monospace; }

  /* ── skeleton ── */
  @keyframes ia-sk { 0%,100%{opacity:.2} 50%{opacity:.45} }
  .ia-sk { animation: ia-sk 1.5s ease infinite; background: var(--border); border-radius: 4px; }

  /* ── spinner ── */
  @keyframes ia-spin { to { transform: rotate(360deg); } }

  /* ── fade in ── */
  @keyframes ia-fade { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:translateY(0)} }
  .ia-fade { animation: ia-fade 300ms ease both; }

  /* ── scrollbar ── */
  .ia-root ::-webkit-scrollbar { width: 3px; }
  .ia-root ::-webkit-scrollbar-track { background: transparent; }
  .ia-root ::-webkit-scrollbar-thumb { background: var(--border-hi); border-radius: 2px; }
`;

/* ─── Helpers ─────────────────────────────────────────────────────────────── */
const TH: React.FC<{ label: string; flex?: number; align?: 'left'|'right'|'center' }> = ({ label, flex=1, align='left' }) => (
  <div style={{ flex, display:'flex', alignItems:'center', padding:'0 8px', justifyContent: align==='right'?'flex-end':align==='center'?'center':'flex-start' }}>
    <span style={{ fontSize:9, fontWeight:700, color:'var(--text-3)', textTransform:'uppercase', letterSpacing:'0.1em' }}>{label}</span>
  </div>
);

const RANK_THEMES = [
  { bg:'rgba(212,175,55,0.15)', color:'var(--gold)'  },
  { bg:'rgba(136,136,154,0.12)',color:'var(--text-2)'},
  { bg:'rgba(249,115,22,0.12)', color:'#f97316'      },
];

const SecHd: React.FC<{ icon: React.ReactNode; color: string; dim: string; title: string; sub?: string; right?: React.ReactNode }> = ({ icon, color, dim, title, sub, right }) => (
  <div className="ia-sec-hd">
    <div style={{ display:'flex', alignItems:'center', gap:10 }}>
      <div style={{ width:30, height:30, borderRadius:8, background:dim, display:'flex', alignItems:'center', justifyContent:'center', color, flexShrink:0 }}>{icon}</div>
      <div>
        <h3 style={{ fontSize:14, fontWeight:600, color:'var(--text-1)', margin:0 }}>{title}</h3>
        {sub && <p style={{ fontSize:11.5, color:'var(--text-3)', margin:0 }}>{sub}</p>}
      </div>
    </div>
    {right}
  </div>
);

const EmptyMsg: React.FC<{ icon?: string; msg: string }> = ({ icon='✅', msg }) => (
  <div style={{ padding:'40px 24px', textAlign:'center' }}>
    <p style={{ fontSize:24, marginBottom:8 }}>{icon}</p>
    <p style={{ fontSize:13, color:'var(--text-3)' }}>{msg}</p>
  </div>
);

/* ─── Icons ─────────────────────────────────────────────────────────────────── */
const IC = {
  pkg:     <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2l8 4-8 4-8-4 8-4zM2 6l8 4v10L2 16V6zM22 6l-8 4v10l8-4V6z"/></svg>,
  trend:   <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 7l-9.5 9.5-5-5L1 18"/><polyline points="16 7 22 7 22 13"/></svg>,
  dollar:  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>,
  alert:   <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 9v2m0 4h.01M6.938 16.938A9 9 0 1117.062 7.062 9 9 0 016.938 16.938z"/></svg>,
  bar:     <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 3v18h18M9 17V9m4 8V5m4 12v-4"/></svg>,
  x:       <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>,
  refresh: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>,
  box:     <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2"><path d="M12 2l8 4-8 4-8-4 8-4zM2 6l8 4v10L2 16V6zM22 6l-8 4v10l8-4V6z"/></svg>,
};

/* ════════════════════════════════════════════════════════════════════════════ */
export const InventoryAnalyticsPage: React.FC = () => {
  const { t }                   = useI18n();
  const { currency, language: lang } = useSettingsStore();
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['inventory-analytics'],
    queryFn:  () => api.inventory.getAnalytics() as Promise<AnalyticsData>,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  React.useEffect(() => {
    const id = 'ia-styles';
    if (!document.getElementById(id)) {
      const s = document.createElement('style'); s.id = id; s.textContent = STYLES;
      document.head.appendChild(s);
    }
  }, []);

  const fmt = (v: number) => formatPrice(v, currency, lang);

  /* ── Skeleton ── */
  if (isLoading) return (
    <div className="ia-root" style={{ padding:'36px 0 60px' }}>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:12, marginBottom:24 }}>
        {[1,2,3,4].map(i => <div key={i} className="ia-sk" style={{ height:110, borderRadius:14 }}/>)}
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>
        {[1,2,3,4].map(i => <div key={i} className="ia-sk" style={{ height:280, borderRadius:14 }}/>)}
      </div>
    </div>
  );

  /* ── Error ── */
  if (error || !data) return (
    <div className="ia-root" style={{ padding:'36px 0 60px' }}>
      <div style={{ textAlign:'center', padding:'60px 24px', background:'var(--card)', border:'1px solid var(--border)', borderRadius:14 }}>
        <div style={{ color:'var(--text-3)', marginBottom:14 }}>{IC.box}</div>
        <p style={{ fontSize:15, fontWeight:600, color:'var(--text-1)', marginBottom:6 }}>{t('analytics.unavailable')}</p>
        <p style={{ fontSize:13, color:'var(--text-3)' }}>{t('analytics.unavailableSub')}</p>
      </div>
    </div>
  );

  const { valuation, top_selling_products, low_stock_alerts, dead_stock, fast_moving_items, waste_analytics } = data;
  const wastedTotal = waste_analytics.reduce((s, w) => s + w.total_cost, 0);
  const maxRev = Math.max(...top_selling_products.map(p => p.revenue), 1);

  /* ════════════════════════════════════════════════════════════════════ */
  return (
    <div className="ia-root ia-fade" style={{ paddingBottom:80 }}>

      {/* ── Header ── */}
      <div style={{ display:'flex', alignItems:'flex-end', justifyContent:'space-between', marginBottom:28, flexWrap:'wrap', gap:16 }}>
        <div>
          <p style={{ fontSize:11, fontWeight:600, color:'var(--text-3)', textTransform:'uppercase', letterSpacing:'0.12em', marginBottom:6 }}>
            Inventaire
          </p>
          <h2 style={{ fontSize:26, fontWeight:300, color:'var(--text-1)', margin:'0 0 4px', letterSpacing:'-0.01em' }}>
            {t('analytics.inventoryAnalytics') || 'Analytique Inventaire'}
          </h2>
          <p style={{ fontSize:13.5, color:'var(--text-2)', margin:0 }}>
            {t('analytics.realTimeInsights') || 'Insights temps réel · valorisation · alertes'}
          </p>
        </div>
        <button className={`ia-refresh ${isFetching?'spinning':''}`} onClick={() => refetch()}>
          {IC.refresh}
          {t('analytics.refresh') || 'Actualiser'}
        </button>
      </div>

      {/* ── KPI strip ── */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:12, marginBottom:24 }}>
        {[
          { label: t('analytics.inventoryValue')   || 'Valeur inventaire',    value: fmt(valuation.total_inventory_value),  sub: `${valuation.active_skus} ${t('analytics.activeSkus')||'SKUs actifs'}`, color:'var(--blue)',  dim:'var(--blue-dim)',  icon:IC.pkg    },
          { label: t('analytics.potentialProfit')  || 'Profit potentiel',     value: fmt(valuation.potential_gross_profit), sub: t('analytics.potentialProfitSub')  || 'Si tout vendu',                   color:'var(--green)', dim:'var(--green-dim)', icon:IC.trend  },
          { label: t('analytics.realisedProfit')   || 'Profit réalisé',       value: fmt(valuation.actual_gross_profit),    sub: t('analytics.realisedProfitSub')   || 'Marge brute effective',            color:'var(--gold)',  dim:'var(--gold-dim)',  icon:IC.dollar },
          { label: t('analytics.lowStockAlerts')   || 'Alertes stock',        value: String(low_stock_alerts.length),       sub: t('analytics.lowStockAlertsSub')   || 'Articles sous seuil',              color: low_stock_alerts.length>0?'var(--red)':'var(--green)', dim:low_stock_alerts.length>0?'var(--red-dim)':'var(--green-dim)', icon:IC.alert  },
        ].map((k, i) => (
          <div key={i} className="ia-kpi" style={{ animationDelay:`${i*60}ms` }}>
            <div style={{ position:'absolute', top:0, left:0, right:0, height:2, background:`linear-gradient(90deg,${k.color}55,transparent)`, borderRadius:'14px 14px 0 0' }}/>
            {/* glow */}
            <div style={{ position:'absolute', top:'-20%', right:'-5%', width:100, height:100, background:`radial-gradient(circle,${k.color}12 0%,transparent 65%)`, filter:'blur(16px)', pointerEvents:'none' }}/>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:14 }}>
              <span style={{ fontSize:10, fontWeight:600, color:'var(--text-3)', textTransform:'uppercase', letterSpacing:'0.1em' }}>{k.label}</span>
              <div style={{ width:28, height:28, borderRadius:8, background:k.dim, display:'flex', alignItems:'center', justifyContent:'center', color:k.color }}>{k.icon}</div>
            </div>
            <p className="mono" style={{ fontSize:22, fontWeight:300, color:'var(--text-1)', margin:'0 0 4px', lineHeight:1 }}>{k.value}</p>
            {k.sub && <p style={{ fontSize:11, color:'var(--text-3)', margin:0 }}>{k.sub}</p>}
          </div>
        ))}
      </div>

      {/* ── 2×2 grid ── */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16, marginBottom:16 }}>

        {/* Top sellers */}
        <div className="ia-sec">
          <SecHd icon={IC.bar} color="var(--blue)" dim="var(--blue-dim)"
            title={t('analytics.topSellers') || 'Top Produits'}
            sub={`${top_selling_products.length} produit${top_selling_products.length!==1?'s':''}`}
            right={<span className="mono" style={{ fontSize:11, color:'var(--text-3)' }}>par revenus</span>}
          />
          {!top_selling_products.length ? <EmptyMsg icon="📦" msg={t('analytics.noSalesYet')||'Aucune vente enregistrée'}/> : (
            <>
              <div className="ia-tr ia-th">
                <TH label="#"         flex={0.4} align="center"/>
                <TH label="Produit"   flex={2}/>
                <TH label="Catégorie" flex={1.2}/>
                <TH label="Unités"    flex={0.8} align="right"/>
                <TH label="Revenus"   flex={1}   align="right"/>
              </div>
              {top_selling_products.map((p, i) => {
                const rk = RANK_THEMES[i] || { bg:'rgba(255,255,255,0.04)', color:'var(--text-3)' };
                return (
                  <div key={p.product_id} className="ia-tr">
                    <div style={{ flex:0.4, padding:'0 8px', display:'flex', justifyContent:'center' }}>
                      <div className="ia-rank" style={{ background:rk.bg, color:rk.color }}>
                        {i<3?['🥇','🥈','🥉'][i]:i+1}
                      </div>
                    </div>
                    <div style={{ flex:2, padding:'0 8px', minWidth:0 }}>
                      <p style={{ fontSize:13, fontWeight:500, color:'var(--text-1)', margin:'0 0 3px', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{p.product_name}</p>
                      <div style={{ height:2, background:'rgba(255,255,255,0.04)', borderRadius:1, overflow:'hidden' }}>
                        <div style={{ height:'100%', width:`${(p.revenue/maxRev)*100}%`, background:'var(--blue)', borderRadius:1, transition:'width 600ms ease' }}/>
                      </div>
                    </div>
                    <div style={{ flex:1.2, padding:'0 8px' }}>
                      <span style={{ fontSize:11.5, color:'var(--text-3)' }}>{p.category_name}</span>
                    </div>
                    <div style={{ flex:0.8, padding:'0 8px', display:'flex', justifyContent:'flex-end' }}>
                      <span className="mono" style={{ fontSize:13, color:'var(--text-1)' }}>{p.units_sold}</span>
                    </div>
                    <div style={{ flex:1, padding:'0 8px', display:'flex', justifyContent:'flex-end' }}>
                      <span className="mono" style={{ fontSize:13, fontWeight:600, color:'var(--green)' }}>{fmt(p.revenue)}</span>
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </div>

        {/* Low stock alerts */}
        <div className="ia-sec">
          <SecHd icon={IC.alert} color="var(--red)" dim="var(--red-dim)"
            title={t('analytics.lowStock') || 'Alertes Stock'}
            sub="Articles sous le seuil minimum"
            right={low_stock_alerts.length > 0
              ? <span style={{ padding:'3px 9px', borderRadius:20, fontSize:10.5, fontWeight:700, background:'var(--red-dim)', color:'var(--red)', border:'1px solid rgba(239,68,68,0.2)' }}>
                  {low_stock_alerts.length} alerte{low_stock_alerts.length!==1?'s':''}
                </span>
              : undefined
            }
          />
          {!low_stock_alerts.length ? <EmptyMsg msg={t('analytics.allStockHealthy')||'Tous les stocks sont OK'}/> : (
            <div style={{ padding:'12px' }}>
              {low_stock_alerts.map(item => {
                const isCrit = item.urgency === 'critical';
                const pct = Math.min(100, Math.round((item.stock / Math.max(item.minimum_stock,1))*100));
                return (
                  <div key={item.product_id} style={{ display:'flex', alignItems:'center', gap:12, padding:'11px 12px', background:'var(--surface)', border:`1px solid ${isCrit?'rgba(239,68,68,0.2)':'rgba(245,158,11,0.2)'}`, borderRadius:10, marginBottom:8 }}>
                    <div style={{ flex:1, minWidth:0 }}>
                      <p style={{ fontSize:13, fontWeight:500, color:'var(--text-1)', margin:'0 0 1px', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{item.product_name}</p>
                      <p style={{ fontSize:11, color:'var(--text-3)', margin:'0 0 5px' }}>{item.category_name}</p>
                      <div className="ia-bar">
                        <div className="ia-bar-fill" style={{ width:`${pct}%`, background:isCrit?'var(--red)':'var(--amber)' }}/>
                      </div>
                    </div>
                    <div style={{ textAlign:'right', flexShrink:0 }}>
                      <p className="mono" style={{ fontSize:20, fontWeight:300, color:isCrit?'var(--red)':'var(--amber)', margin:'0 0 1px' }}>{item.stock}</p>
                      <p style={{ fontSize:10, color:'var(--text-3)', margin:0 }}>min: {item.minimum_stock}</p>
                    </div>
                    <span className="ia-badge" style={{ background:isCrit?'var(--red-dim)':'var(--amber-dim)', color:isCrit?'var(--red)':'var(--amber)', border:`1px solid ${isCrit?'rgba(239,68,68,0.2)':'rgba(245,158,11,0.2)'}`, flexShrink:0, fontSize:9.5 }}>
                      {isCrit ? 'Critique' : 'Attention'}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Waste analytics */}
        <div className="ia-sec">
          <SecHd icon={IC.x} color="var(--red)" dim="var(--red-dim)"
            title={t('analytics.waste') || 'Gaspillages'}
            sub="Pertes et raisons enregistrées"
            right={waste_analytics.length > 0
              ? <span className="mono" style={{ fontSize:13, fontWeight:600, color:'var(--red)' }}>{fmt(wastedTotal)}</span>
              : undefined
            }
          />
          {!waste_analytics.length ? <EmptyMsg msg={t('analytics.noWasteRecorded')||'Aucun gaspillage enregistré'}/> : (
            <div style={{ padding:'12px' }}>
              {/* total loss banner */}
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'11px 14px', background:'var(--red-dim)', border:'1px solid rgba(239,68,68,0.2)', borderRadius:10, marginBottom:12 }}>
                <span style={{ fontSize:12.5, fontWeight:600, color:'var(--text-2)' }}>{t('analytics.totalLoss')||'Perte totale'}</span>
                <span className="mono" style={{ fontSize:18, fontWeight:500, color:'var(--red)' }}>{fmt(wastedTotal)}</span>
              </div>
              {waste_analytics.map(w => (
                <div key={w.reason} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'11px 0', borderBottom:'1px solid var(--border)' }}>
                  <div style={{ flex:1 }}>
                    <p style={{ fontSize:13, fontWeight:500, color:'var(--text-1)', margin:'0 0 2px', textTransform:'capitalize' }}>
                      {t(`products.reason.${w.reason}`)||w.reason}
                    </p>
                    <p style={{ fontSize:11, color:'var(--text-3)', margin:0 }}>
                      {w.occurrences} occurrence{w.occurrences!==1?'s':''} · qté: {w.total_qty}
                    </p>
                  </div>
                  <span className="mono" style={{ fontSize:13.5, fontWeight:600, color:'var(--red)', flexShrink:0 }}>{fmt(w.total_cost)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Fast-moving items */}
        <div className="ia-sec">
          <SecHd icon={IC.trend} color="var(--green)" dim="var(--green-dim)"
            title={t('analytics.fastMoving') || 'Articles Rapides'}
            sub="Rotation stock sur 30 jours"
          />
          {!fast_moving_items.length ? <EmptyMsg icon="📊" msg={t('analytics.insufficientData')||'Données insuffisantes'}/> : (
            <>
              <div className="ia-tr ia-th">
                <TH label="Produit"     flex={2}/>
                <TH label="Catégorie"   flex={1.2}/>
                <TH label="Unités 30j"  flex={0.9} align="right"/>
                <TH label="Rotation"    flex={0.9} align="right"/>
              </div>
              {fast_moving_items.map(p => (
                <div key={p.product_id} className="ia-tr">
                  <div style={{ flex:2, padding:'0 8px', minWidth:0 }}>
                    <p style={{ fontSize:13, fontWeight:500, color:'var(--text-1)', margin:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{p.product_name}</p>
                  </div>
                  <div style={{ flex:1.2, padding:'0 8px' }}>
                    <span style={{ fontSize:11.5, color:'var(--text-3)' }}>{p.category_name}</span>
                  </div>
                  <div style={{ flex:0.9, padding:'0 8px', display:'flex', justifyContent:'flex-end' }}>
                    <span className="mono" style={{ fontSize:13, color:'var(--text-1)' }}>{p.units_sold_30d}</span>
                  </div>
                  <div style={{ flex:0.9, padding:'0 8px', display:'flex', justifyContent:'flex-end' }}>
                    {p.turnover_days ? (
                      <span style={{ padding:'3px 9px', borderRadius:6, background:'var(--green-dim)', color:'var(--green)', fontSize:11.5, fontWeight:700, border:'1px solid rgba(16,185,129,0.2)' }} className="mono">
                        {p.turnover_days}j
                      </span>
                    ) : <span style={{ fontSize:12, color:'var(--text-3)' }}>—</span>}
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      </div>

      {/* Dead stock */}
      {dead_stock.length > 0 && (
        <div className="ia-sec">
          <SecHd icon={IC.x} color="var(--amber)" dim="var(--amber-dim)"
            title={t('analytics.deadStock') || 'Stock Mort'}
            sub="Produits sans rotation depuis 90 jours"
            right={<span className="mono" style={{ fontSize:11, color:'var(--text-3)' }}>{dead_stock.length} article{dead_stock.length!==1?'s':''}</span>}
          />
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(260px,1fr))', gap:10, padding:'14px' }}>
            {dead_stock.map(item => (
              <div key={item.product_id} style={{ padding:'13px 16px', background:'var(--surface)', border:'1px solid rgba(245,158,11,0.15)', borderRadius:11, display:'flex', alignItems:'center', gap:12 }}>
                <div style={{ flex:1, minWidth:0 }}>
                  <p style={{ fontSize:13, fontWeight:500, color:'var(--text-1)', margin:'0 0 2px', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{item.product_name}</p>
                  <p style={{ fontSize:11, color:'var(--text-3)', margin:0 }}>
                    Stock: {item.stock_quantity} · min: {item.minimum_stock}
                  </p>
                </div>
                <div style={{ textAlign:'right', flexShrink:0 }}>
                  <p className="mono" style={{ fontSize:15, fontWeight:500, color:'var(--amber)', margin:'0 0 1px' }}>{fmt(item.dead_stock_value)}</p>
                  <p style={{ fontSize:10, color:'var(--text-3)', margin:0 }}>{t('analytics.valueTiedUp')||'immobilisé'}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

    </div>
  );
};

export default InventoryAnalyticsPage;