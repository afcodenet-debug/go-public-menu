import { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useOrderStore } from '../stores/useOrderStore';
import { useTableStore } from '../stores/useTableStore';
import { useAuthStore } from '../stores/useAuthStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import { useI18n } from '../lib/i18n';
import { formatPrice } from '../lib/i18n/currency';
import { api } from '../lib/api-client';
import { printReceipt } from '../utils/receiptPrinter';
import {
  Clock, CheckCircle2, ChefHat, User, UtensilsCrossed,
  Search, Filter, DollarSign, Package, Timer,
  CreditCard, Eye, ShoppingCart, Plus, X, Calendar, Layers, Printer
} from 'lucide-react';
import { StatusToast } from '../components/StatusToast';

/* ─── Styles ─────────────────────────────────────────────────────────────── */
const STYLES = `
  .orders-root {
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
    background: var(--bg);
    min-height: 100vh;
  }

  .kpi-card {
    background: var(--card); border: 1px solid var(--border); border-radius: 16px;
    padding: 18px 20px; position: relative; overflow: hidden;
    transition: all 180ms ease;
  }
  .kpi-card:hover { border-color: var(--border-hi); transform: translateY(-2px); box-shadow: 0 12px 32px rgba(0,0,0,0.3); }

  .order-item {
    background: var(--surface); border: 1px solid var(--border); border-radius: 18px;
    overflow: hidden; transition: all 200ms ease;
    display: flex;
    flex-direction: column;
  }
  .order-item:hover { border-color: var(--border-hi); background: var(--card); }

  .status-badge {
    display: inline-flex; align-items: center; gap: 5px;
    padding: 3px 10px; border-radius: 20px; font-size: 9px; font-weight: 800;
    text-transform: uppercase; letter-spacing: 0.08em;
  }

  .action-btn {
    display: flex; align-items: center; justify-content: center; gap: 6px;
    padding: 10px 8px; min-height: 38px; border-radius: 10px; font-size: 11px; font-weight: 700;
    text-transform: uppercase; letter-spacing: 0.04em; transition: all 150ms ease;
    cursor: pointer; border: 1px solid transparent; white-space: nowrap;
  }
  
  .mono { font-family: 'JetBrains Mono', monospace; }
  
  .live-dot {
    width: 6px; height: 6px; border-radius: 50%; background: var(--green);
    box-shadow: 0 0 6px rgba(16,185,129,0.7);
    animation: live-pulse 2s ease-in-out infinite;
  }
  @keyframes live-pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }

  .custom-scroll::-webkit-scrollbar { width: 4px; }
  .custom-scroll::-webkit-scrollbar-track { background: transparent; }
  .custom-scroll::-webkit-scrollbar-thumb { background: var(--border-hi); border-radius: 10px; }

  .filter-input {
    background: var(--surface); border: 1px solid var(--border);
    border-radius: 12px; padding: 10px 14px 10px 38px;
    color: var(--text-1); font-size: 13px; transition: all 150ms ease;
    width: 100%; outline: none;
  }
  .filter-input:focus { border-color: var(--blue); background: var(--card); }

  @keyframes highlight-pulse {
    0%, 100% { box-shadow: 0 0 0 4px rgba(59, 130, 246, 0.1); }
    50% { box-shadow: 0 0 0 8px rgba(59, 130, 246, 0.2); }
  }
`;

const OrdersPage = () => {
  const {
    allOrders, stats, filters,
    fetchAllOrders, updateOrderStatus, setUserContext, setFilters,
    deleteOrder
  } = useOrderStore();
  const { tables, fetchTables } = useTableStore();
  const { user } = useAuthStore();
  const { currency } = useSettingsStore();
  const { lang, t } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();
  const highlightOrderId = location.state?.highlightOrderId;

  // Local toast for QR menu pending orders
  const [pendingQrOrderIds, setPendingQrOrderIds] = useState<number[]>([]);
  const [toastKey, setToastKey] = useState(0);
  const [highlightOrderForToast, setHighlightOrderForToast] = useState<number | null>(null);

  // Permet à l'utilisateur de fermer le toast; il réapparaît uniquement si de nouveaux pending arrivent.
  const [toastDismissed, setToastDismissed] = useState(false);

  const [detailsModalOrderId, setDetailsModalOrderId] = useState<number | null>(null);
  const [detailsModalSaleId, setDetailsModalSaleId] = useState<number | null>(null);
  const [isCheckoutProcessing, setIsCheckoutProcessing] = useState(false);
  const [modalOrder, setModalOrder] = useState<any>(null);

  const [showFilters, setShowFilters] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [showTableSelector, setShowTableSelector] = useState(false);
  const [isCreatingOrder, setIsCreatingOrder] = useState(false);

  const localeMap: Record<string, string> = {
    en: 'en-US',
    fr: 'fr-FR',
    pt: 'pt-PT',
  };

  const timeLocale = localeMap[lang] ?? 'en-US';

  useEffect(() => {
    const id = 'orders-styles';
    if (!document.getElementById(id)) {
      const s = document.createElement('style');
      s.id = id;
      s.textContent = STYLES;
      document.head.appendChild(s);
    }
  }, []);

  useEffect(() => {
    if (user) {
      setUserContext(user.id, user.role);
      fetchAllOrders();
      if (user.role === 'waiter') {
        fetchTables();
      }
    }
    const interval = setInterval(fetchAllOrders, 10000);
    return () => clearInterval(interval);
  }, [fetchAllOrders, setUserContext, user, fetchTables]);

  useEffect(() => {
    setFilters({ search: searchTerm });
    fetchAllOrders();
  }, [searchTerm, setFilters, fetchAllOrders]);

  const handleCreateOrder = async (table: any) => {
    if (!user) return;
    setIsCreatingOrder(true);
    try {
      const result: any = await api.tables.open(table.id, user.id);
      navigate(`/pos?tableId=${table.id}&orderId=${result.orderId}`);
    } catch (error: any) {
      console.error('Failed to create order:', error);
    } finally {
      setIsCreatingOrder(false);
      setShowTableSelector(false);
    }
  };

  const getStatusConfig = (status: string) => {
    switch (status) {
      case 'pending':   return { label: t('orders.status.pending'),   color: 'var(--red)',    dim: 'var(--red-dim)',    icon: <Clock size={12}/> };
      case 'confirmed': return { label: t('orders.status.confirmed'), color: 'var(--blue)',   dim: 'var(--blue-dim)',   icon: <CheckCircle2 size={12}/> };
      case 'preparing': return { label: t('orders.status.preparing'), color: 'var(--amber)',  dim: 'var(--amber-dim)',  icon: <ChefHat size={12}/> };
      case 'ready':     return { label: t('orders.status.ready'),     color: 'var(--purple)', dim: 'var(--purple-dim)', icon: <Package size={12}/> };
      case 'served':    return { label: t('orders.status.served'),    color: 'var(--green)',  dim: 'var(--green-dim)',  icon: <UtensilsCrossed size={12}/> };
      case 'paid':      return { label: t('orders.status.paid'),      color: 'var(--text-3)', dim: 'rgba(255,255,255,0.04)', icon: <DollarSign size={12}/> };
      case 'cancelled': return { label: t('orders.status.cancelled'), color: 'var(--red)',    dim: 'var(--red-dim)',    icon: <X size={12}/> };
      case 'rejected':  return { label: t('orders.status.rejected') || 'Rejected', color: 'var(--red)', dim: 'var(--red-dim)', icon: <X size={12}/> };
      default:          return { label: status,                      color: 'var(--text-3)', dim: 'var(--surface)',    icon: <Layers size={12}/> };
    }
  };

  const getQuickActions = (order: any) => {
    const actions: Array<{ label: string; action: () => void; icon: any; style?: React.CSSProperties }> = [];
    const canManage = user?.role === 'admin' || user?.role === 'manager' ||
                     (user?.role === 'waiter' && order.waiter_id === user.id);

    if (!canManage) return actions;

    switch (order.status) {
      case 'pending': {
        // QR / new orders: two-step accept then print
        actions.push({
          label: t('orders.actions.validate') || 'Valider',
          action: async () => {
            if (!user) return;
            try {
              await updateOrderStatus(order.id, 'confirmed');
              await fetchAllOrders();
            } catch (e) {
              console.error('Validate failed', e);
            }
          },
          icon: CheckCircle2,
          style: { background: 'var(--green-dim)', color: 'var(--green)', border: '1px solid rgba(16,185,129,0.25)' }
        });

        actions.push({
          label: t('orders.actions.reject') || 'Rejeter',
          action: async () => {
            if (!user) return;
            try {
              await updateOrderStatus(order.id, 'rejected');
              await fetchAllOrders();
            } catch (e) {
              console.error('Reject failed', e);
            }
          },
          icon: X,
          style: { background: 'var(--red-dim)', color: 'var(--red)', border: '1px solid rgba(239,68,68,0.25)' }
        });

        break;
      }

      case 'confirmed':
        // QR/table orders after validation: offer clear progression so customers see the tracker advance
        actions.push({
          label: t('orders.actions.startPrep') || 'Cuisine',
          action: () => updateOrderStatus(order.id, 'preparing'),
          icon: ChefHat,
          style: { background: 'var(--amber-dim)', color: 'var(--amber)', border: '1px solid rgba(245,158,11,0.2)' }
        });
        actions.push({
          label: t('orders.actions.markReady') || 'Prête',
          action: () => updateOrderStatus(order.id, 'ready'),
          icon: Package,
          style: { background: 'var(--purple-dim)', color: 'var(--purple)', border: '1px solid rgba(167,139,250,0.2)' }
        });
        actions.push({
          label: t('orders.actions.serve') || 'Servir',
          action: () => updateOrderStatus(order.id, 'served'),
          icon: UtensilsCrossed,
          style: { background: 'var(--green-dim)', color: 'var(--green)', border: '1px solid rgba(16,185,129,0.2)' }
        });
        // Keep the detailed view + print
        actions.push({
          label: t('orders.actions.view') || 'Voir',
          action: async () => {
            if (!user) return;
            setDetailsModalOrderId(order.id);
            try {
              const full = await api.orders.getById(order.id);
              setModalOrder(full);
            } catch (e) {
              console.error('Failed to load order details', e);
              setModalOrder(order); // fallback to card data
            }
          },
          icon: Eye,
          style: { background: 'var(--blue-dim)', color: 'var(--blue)', border: '1px solid rgba(59,130,246,0.2)' }
        });
        break;
        case 'preparing':
          actions.push({
            label: t('orders.actions.markReady'),
            action: () => updateOrderStatus(order.id, 'ready'),
            icon: Package,
            style: { background: 'var(--purple-dim)', color: 'var(--purple)', border: '1px solid rgba(167,139,250,0.2)' }
          });
          break;
        case 'ready':
          actions.push({
            label: t('orders.actions.serve'),
            action: () => updateOrderStatus(order.id, 'served'),
            icon: UtensilsCrossed,
            style: { background: 'var(--green-dim)', color: 'var(--green)', border: '1px solid rgba(16,185,129,0.2)' }
          });
          break;
      case 'served':
        actions.push({
          label: t('orders.actions.cashout'),
          action: () => navigate(`/pos?tableId=${order.table_id}&orderId=${order.id}`),
          icon: CreditCard,
          style: { background: 'var(--gold-dim)', color: 'var(--gold)', border: '1px solid rgba(212,175,55,0.2)' }
        });
        break;
      default:
        break;
    }
      return actions;
    };

  const ordersList = Array.isArray(allOrders) ? allOrders : [];
  const availableTables = tables.filter(t => t.assigned_waiter_id === user?.id && t.status === 'available');

  // Keep showing toast while there are QR menu pending orders (no action yet)
  useEffect(() => {
    if (!user) return;

    const role = user.role;
    const shouldNotify = role === 'admin' || role === 'manager' || role === 'cashier';
    if (!shouldNotify) return;

    // NOTE: We currently treat ALL `pending` orders as QR-menu pending.
    // If you later add a `source` field for QR, we can filter only those.
    const currentPending = ordersList
      .filter((o: any) => o?.status === 'pending')
      .map((o: any) => Number(o.id))
      .filter((n: number) => Number.isFinite(n))
      .sort((a: number, b: number) => b - a);

    const prevKey = pendingQrOrderIds.join(',');
    const nextKey = currentPending.join(',');

    if (prevKey !== nextKey) {
      setPendingQrOrderIds(currentPending);
      setToastKey((k) => k + 1);

      // Quand il y a des changements (nouvelle pending), on remet le toast visible
      // et on sélectionne l'ordre le plus récent pour attirer l'attention.
      setToastDismissed(false);
      setHighlightOrderForToast(currentPending[0] ?? null);
    }
  }, [ordersList, user, pendingQrOrderIds]);

  return (
    <div className="orders-root">
      <div style={{ maxWidth: 1400, margin: '0 auto', padding: '36px 24px 60px' }}>
        {/* In-app alert: list of pending QR orders (reste visible jusqu'à fermeture, et revient si nouveaux pending) */}
        {pendingQrOrderIds.length > 0 && !toastDismissed && (
          <StatusToast
            key={toastKey}
            variant="info"
            title="Commandes en attente"
            subtitle="Action requise"
            message="Les commandes créées depuis le QR Menu ne sont pas encore confirmées/validées. Utilisez les actions sur la carte pour valider ou rejeter."
            details={pendingQrOrderIds.slice(0, 5).map((id) => {
              const o: any = ordersList.find((x: any) => Number(x.id) === id);
              const tableLabel = o?.table_number ? `Table ${o.table_number}` : 'Table --';
              return {
                label: `Commande #${id}`,
                value: tableLabel,
                highlight: true
              };
            })}
            actions={
              <button
                onClick={() => {
                  const targetId = highlightOrderForToast ?? pendingQrOrderIds[0];
                  if (!targetId) return;

                  // Ensure we scroll even if data-order-id lookup fails due to timing:
                  // also fallback to a plain id-based query.
                  const byData = document.querySelector(`[data-order-id="${targetId}"]`) as HTMLElement | null;
                  const byId = document.getElementById(`order-card-${targetId}`) as HTMLElement | null;

                  const el = byData || byId;
                  if (el && 'scrollIntoView' in el) {
                    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  }

                  // Force highlight so the user sees where it is.
                  setHighlightOrderForToast(targetId);
                }}
                style={{
                  padding: '10px 14px',
                  borderRadius: 12,
                  border: '1px solid rgba(59,130,246,0.28)',
                  background: 'rgba(59,130,246,0.10)',
                  color: '#cfe3ff',
                  fontWeight: 900,
                  cursor: 'pointer',
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  fontSize: 11,
                }}
                title="Voir la commande"
              >
                Voir
              </button>
            }
            onClose={() => {
              // L'utilisateur ferme explicitement; le toast disparaît.
              // Le highlight reste (pour attirer l'attention) et le toast revient
              // uniquement si de nouveaux pending apparaissent.
              setToastDismissed(true);
            }}
          />
        )}
        
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 32, gap: 20, flexWrap: 'wrap' }}>
          <div>
            <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 6 }}>{t('orders.sectionMgmt')}</p>
            <h1 style={{ fontSize: 28, fontWeight: 300, color: 'var(--text-1)', margin: '0 0 4px', letterSpacing: '-0.01em' }}>{t('orders.titles')}</h1>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
               <div className="live-badge" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: 'var(--green)', background: 'var(--green-dim)', padding: '2px 8px', borderRadius: 20, border: '1px solid rgba(16,185,129,0.2)' }}>
                  <span className="live-dot"/> {t('orders.liveOps')}
               </div>
               <span style={{ fontSize: 12, color: 'var(--text-3)' }}>•</span>
               <span style={{ fontSize: 12, color: 'var(--text-2)' }}>{ordersList.length} {t('orders.activeOrders')}</span>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ position: 'relative', width: 240 }}>
              <Search size={14} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-3)' }} />
              <input 
                className="filter-input" 
                placeholder={t('orders.searchPlaceholder')}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            
            <button 
              onClick={() => setShowFilters(!showFilters)}
              style={{ padding: '10px 16px', borderRadius: 12, background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--text-2)', fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}
            >
              <Filter size={14} /> {t('orders.filters')}
            </button>

            {user?.role === 'waiter' && (
              <button 
                onClick={() => setShowTableSelector(true)}
                style={{ padding: '10px 20px', borderRadius: 12, background: 'var(--blue)', border: 'none', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, boxShadow: '0 4px 12px rgba(59,130,246,0.3)' }}
              >
                <Plus size={16} /> {t('orders.newOrder')}
              </button>
            )}
          </div>
        </div>

        {/* KPI Strip */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 14, marginBottom: 32 }}>
          {[
            { label: t('orders.kpi.active'), value: stats.active_orders, color: 'var(--blue)', icon: <ShoppingCart size={14}/> },
            { label: t('orders.kpi.inKitchen'), value: stats.preparing_orders, color: 'var(--amber)', icon: <ChefHat size={14}/> },
            { label: t('orders.kpi.ready'), value: stats.ready_orders, color: 'var(--purple)', icon: <Package size={14}/> },
            { label: t('orders.kpi.served'), value: stats.served_orders, color: 'var(--green)', icon: <UtensilsCrossed size={14}/> },
            { label: t('orders.kpi.paidToday'), value: stats.paid_orders, color: 'var(--text-3)', icon: <CheckCircle2 size={14}/> },
            { label: t('orders.kpi.revenueTd'), value: `$${stats.revenue_today.toFixed(0)}`, color: 'var(--gold)', icon: <DollarSign size={14}/> },
          ].map((k, i) => (
            <div key={i} className="kpi-card">
               <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                  <div style={{ color: k.color }}>{k.icon}</div>
                  <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{k.label}</span>
               </div>
               <div className="mono" style={{ fontSize: 22, fontWeight: 300, color: 'var(--text-1)' }}>{k.value}</div>
            </div>
          ))}
        </div>

        {/* Orders Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 20 }}>
          {ordersList.map((order) => {
            const status = getStatusConfig(order.status);
            const actions = getQuickActions(order);
            
            const isHighlighted = highlightOrderId === order.id || highlightOrderForToast === order.id;

            return (
              <div
                key={order.id}
                id={`order-card-${order.id}`}
                data-order-id={order.id}
                className="order-item"
                style={{
                  ...(isHighlighted
                    ? {
                        border: '2px solid var(--blue)',
                        boxShadow: '0 0 0 4px rgba(59, 130, 246, 0.1)',
                        animation: 'highlight-pulse 2s ease-in-out',
                      }
                    : {}),
                }}
              >
                {/* Order Header */}
                <div style={{ padding: '20px', borderBottom: '1px solid var(--border)', background: 'rgba(255,255,255,0.01)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        <span className="mono" style={{ fontSize: 18, fontWeight: 600, color: 'var(--text-1)' }}>#{order.id}</span>
                        {(order.source === 'qr' || order.remote_id) && (
                          <span style={{
                            fontSize: 9, fontWeight: 800, padding: '1px 6px', borderRadius: 6,
                            background: 'rgba(59,130,246,0.15)', color: 'var(--blue)', border: '1px solid rgba(59,130,246,0.3)'
                          }}>QR</span>
                        )}
                         <div className="status-badge" style={{ background: status.dim, color: status.color, border: `1px solid ${status.color}33` }}>
                           {status.icon} {status.label}
                         </div>
                         {order.customer_id ? (
                           <div style={{
                             display: 'inline-flex',
                             alignItems: 'center',
                             gap: 4,
                             padding: '2px 8px',
                             borderRadius: 12,
                             fontSize: 9,
                             fontWeight: 700,
                             background: 'var(--green-dim)',
                             color: 'var(--green)',
                             border: '1px solid rgba(16,185,129,0.3)',
                             textTransform: 'uppercase',
                             letterSpacing: '0.05em'
                           }}>
                             ✓ Client Validé
                             {order.customer_phone ? ` (${order.customer_phone.slice(-4)})` : ''}
                           </div>
                         ) : null}
                       </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                         <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--text-2)' }}>
                            <Layers size={12} style={{ color: 'var(--blue)' }} /> {t('orders.table')} {order.table_number || '--'}
                         </div>
                         <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--text-3)' }}>
                            <User size={12} /> {order.waiter_name?.split(' ')[0]}
                         </div>
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div className="mono" style={{ fontSize: 20, fontWeight: 500, color: 'var(--text-1)' }}>{formatPrice(order.total, currency, lang)}</div>
                      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase' }}>{order.payment_status || t('orders.status.pending')}</div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 15, fontSize: 11, color: 'var(--text-3)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Calendar size={12}/> {new Date(order.created_at).toLocaleTimeString(timeLocale, { hour: '2-digit', minute: '2-digit' })}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Timer size={12}/> {order.duration_minutes || 0} min</div>
                  </div>
                </div>

                {/* Items Preview */}
                <div className="custom-scroll" style={{ flex: 1, padding: '12px 20px', maxHeight: 120, overflowY: 'auto', background: 'rgba(0,0,0,0.1)' }}>
                  {order.items?.map((item: any, idx: number) => (
                    <div key={idx} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span className="mono" style={{ fontSize: 11, color: 'var(--blue)', background: 'var(--blue-dim)', padding: '1px 6px', borderRadius: 4 }}>{item.quantity}x</span>
                        <span style={{ fontSize: 13, color: 'var(--text-2)' }}>{item.name}</span>
                      </div>
                      <span className="mono" style={{ fontSize: 12, color: 'var(--text-3)' }}>${(item.price * item.quantity).toFixed(2)}</span>
                    </div>
                  ))}
                </div>

                {/* Footer Actions — always visible, primary part of the card */}
                <div style={{ padding: '14px 18px', background: 'rgba(255,255,255,0.02)', borderTop: '1px solid var(--border)', flexShrink: 0 }}>
                  {actions.length > 0 ? (
                    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${actions.length}, 1fr)`, gap: 8 }}>
                      {actions.map((act, i) => (
                        <button
                          key={i}
                          className="action-btn"
                          onClick={act.action}
                          style={{ ...act.style, padding: '11px 8px', fontSize: 11 }}
                          title={act.label}
                          aria-label={act.label}
                        >
                          <act.icon size={14} /> {act.label}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, color: 'var(--text-3)', padding: '10px' }}>
                       {order.status === 'paid' ? <CheckCircle2 size={14} style={{ color: 'var(--green)' }}/> : <Eye size={14}/>}
                       <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                         {order.status === 'paid' ? t('orders.orderClosed') : t('orders.viewDetails')}
                       </span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Empty State */}
        {ordersList.length === 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '100px 0', color: 'var(--text-3)' }}>
            <ShoppingCart size={48} strokeWidth={1} style={{ marginBottom: 20, opacity: 0.3 }} />
            <p style={{ fontSize: 14, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em' }}>{t('orders.noResults')}</p>
            <p style={{ fontSize: 12, marginTop: 4 }}>{t('orders.ordersAppear')}</p>
          </div>
        )}
      </div>

      {/* Order Details Modal — Valider flow: view + print invoice */}
      {detailsModalOrderId && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(10px)', zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 20, width: '100%', maxWidth: 520, overflow: 'hidden', boxShadow: '0 32px 80px rgba(0,0,0,0.6)' }}>
            {/* Header */}
            <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.015)' }}>
              <div>
                <div style={{ fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Détails de la commande</div>
                <div style={{ fontSize: 20, fontWeight: 600, color: 'var(--text-1)', marginTop: 2 }}>
                  #{detailsModalOrderId} {modalOrder?.table_number ? `· Table ${modalOrder.table_number}` : ''}
                </div>
              </div>
              <button onClick={() => { setDetailsModalOrderId(null); setModalOrder(null); }} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 8, color: 'var(--text-2)', cursor: 'pointer' }} aria-label="Fermer">
                <X size={20} />
              </button>
            </div>

            {/* Body */}
            <div className="custom-scroll" style={{ maxHeight: 380, overflowY: 'auto', padding: '20px 24px', background: 'rgba(0,0,0,0.2)' }}>
              {modalOrder?.items && modalOrder.items.length > 0 ? (
                modalOrder.items.map((it: any, idx: number) => (
                  <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span className="mono" style={{ background: 'var(--blue-dim)', color: 'var(--blue)', padding: '1px 7px', borderRadius: 4, fontSize: 11 }}>{it.quantity}x</span>
                      <span style={{ color: 'var(--text-1)', fontSize: 14 }}>{it.name}</span>
                    </div>
                    <span className="mono" style={{ color: 'var(--text-2)', fontSize: 13 }}>
                      {it.quantity} × {formatPrice(it.price || 0, currency, lang)} = {formatPrice((it.price || 0) * (it.quantity || 0), currency, lang)}
                    </span>
                  </div>
                ))
              ) : (
                <div style={{ color: 'var(--text-3)', fontSize: 13, padding: '20px 0' }}>Aucun article chargé.</div>
              )}
            </div>

            {/* Total + actions */}
            <div style={{ padding: '18px 24px 22px', borderTop: '1px solid var(--border)', background: 'var(--card)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
                <span style={{ color: 'var(--text-2)', fontSize: 13, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Total</span>
                <span className="mono" style={{ fontSize: 22, fontWeight: 600, color: 'var(--text-1)' }}>
                  {formatPrice(modalOrder?.total || 0, currency, lang)}
                </span>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <button
                  onClick={() => { setDetailsModalOrderId(null); setModalOrder(null); }}
                  style={{ padding: '12px 16px', borderRadius: 12, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-2)', fontSize: 12, fontWeight: 700, cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.05em' }}
                >
                  Fermer
                </button>

                <button
                  onClick={async () => {
                    if (!user || !detailsModalOrderId || isCheckoutProcessing) return;
                    setIsCheckoutProcessing(true);
                    try {
                      // Advance to 'served' first (if not already final) so the customer QR tracker
                      // visibly progresses to "Servie" when staff prints/delivers the order.
                      const currentStatus = modalOrder?.status || 'confirmed';
                      if (!['served', 'paid', 'cancelled', 'rejected'].includes(currentStatus)) {
                        await updateOrderStatus(detailsModalOrderId, 'served');
                      }

                      const checkoutRes: any = await api.sales.checkout(
                        {
                          order_id: detailsModalOrderId,
                           payment_method: 'cash',
                          user_id: user.id,
                          discount: 0,
                          tax: 0,
                          items: []
                        },
                        user.role
                      );
                      const saleId = checkoutRes?.saleId;
                      if (typeof saleId === 'number') {
                        const receipt: any = await api.sales.getReceipt(saleId);
                        await printReceipt(receipt, currency, lang);
                      }
                      await fetchAllOrders();
                      setDetailsModalOrderId(null);
                      setModalOrder(null);
                    } catch (e) {
                      console.error('[OrdersPage] Print from modal failed:', e);
                    } finally {
                      setIsCheckoutProcessing(false);
                    }
                  }}
                  disabled={isCheckoutProcessing}
                  style={{ padding: '12px 16px', borderRadius: 12, border: '1px solid rgba(212,175,55,0.3)', background: 'var(--gold-dim)', color: 'var(--gold)', fontSize: 12, fontWeight: 800, cursor: isCheckoutProcessing ? 'wait' : 'pointer', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
                >
                  <Printer size={15} /> {isCheckoutProcessing ? 'Impression…' : 'Imprimer la facture'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Table Selector Modal (Stylisé) */}
      {showTableSelector && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(8px)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 24, width: '100%', maxWidth: 600, overflow: 'hidden', boxShadow: '0 24px 64px rgba(0,0,0,0.5)' }}>
            <div style={{ padding: '24px 30px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h2 style={{ fontSize: 20, fontWeight: 300, color: 'var(--text-1)', margin: 0 }}>Sélectionner une Table</h2>
                <p style={{ fontSize: 12, color: 'var(--text-3)', margin: '4px 0 0' }}>Choisissez une table libre pour démarrer le service</p>
              </div>
              <button
                onClick={() => setShowTableSelector(false)}
                style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, color: 'var(--text-3)', padding: 8, cursor: 'pointer' }}
                title="Fermer"
                aria-label="Fermer"
              >
                <X size={20}/>
              </button>
            </div>
            <div className="custom-scroll" style={{ padding: 30, maxHeight: 400, overflowY: 'auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', gap: 15 }}>
              {availableTables.map(table => (
                <button 
                  key={table.id}
                  onClick={() => handleCreateOrder(table)}
                  disabled={isCreatingOrder}
                  style={{ 
                    padding: '20px 10px', background: 'var(--surface)', border: '1px solid var(--border)', 
                    borderRadius: 16, cursor: 'pointer', transition: 'all 150ms ease',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8
                  }}
                  onMouseOver={(e) => { e.currentTarget.style.borderColor = 'var(--blue)'; e.currentTarget.style.background = 'var(--card)'; }}
                  onMouseOut={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.background = 'var(--surface)'; }}
                >
                  <span className="mono" style={{ fontSize: 24, fontWeight: 600, color: 'var(--text-1)' }}>{table.table_number}</span>
                  <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--green)', textTransform: 'uppercase' }}>{t('orders.free')}</span>
                </button>
              ))}
              {availableTables.length === 0 && (
                <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: '40px 0', color: 'var(--text-3)' }}>
                   <p style={{ fontSize: 13 }}>{t('orders.noFreeTable')}</p>
                </div>
              )}
            </div>
            <div style={{ padding: '20px 30px', background: 'rgba(255,255,255,0.01)', borderTop: '1px solid var(--border)', textAlign: 'right' }}>
              <button onClick={() => setShowTableSelector(false)} style={{ padding: '10px 20px', borderRadius: 10, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-2)', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>{t('orders.cancel')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default OrdersPage;
