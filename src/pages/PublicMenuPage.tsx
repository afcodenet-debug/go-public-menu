import { useEffect, useState, useRef } from 'react';
import { useSearchParams, useLocation } from 'react-router-dom';
import { APP_NAME } from '../lib/app-config';
import { useI18n } from '../lib/i18n';  // for future full i18n; we use local override for public QR default EN
import { 
  UtensilsCrossed, 
  CheckCircle2, 
  XCircle, 
  Info, 
  Clock, 
  Check, 
  X, 
  Package, 
  ChefHat 
} from 'lucide-react';

/**
 * Robust API base URL resolver for the public QR menu.
 * Priority:
 * 1. Explicit VITE_API_BASE_URL at build time (Vercel env var)
 * 2. Smart runtime detection: localhost → local backend, otherwise production Render
 * This guarantees that a deployed Vercel build never accidentally calls localhost.
 */
function getApiBaseUrl(): string {
  const envBase =
    (typeof import.meta !== 'undefined' &&
      (import.meta as any).env &&
      (import.meta as any).env.VITE_API_BASE_URL) ||
    '';

  if (envBase) {
    return String(envBase).replace(/\/$/, '');
  }

  if (typeof window !== 'undefined') {
    const host = window.location.hostname;
    if (host === 'localhost' || host === '127.0.0.1' || host.includes('.local')) {
      return 'http://localhost:3001';
    }
  }

  // Production static deploy (Vercel, etc.) → the public Render backend
  return 'https://reat-olive-api.onrender.com';
}

const API_BASE_URL = getApiBaseUrl();

const apiUrl = (endpoint: string) => {
  const base = API_BASE_URL.replace(/\/$/, '');
  return `${base}${endpoint}`;
};

// ─── Local QR Menu Translator (default English, independent of staff settings) ───
import { translations } from '../lib/i18n';

function qrT(lang: 'en' | 'fr' | 'pt', key: string, params?: Record<string, any>): string {
  const qrMenuNs = (translations as any).qrMenu || {};
  
  // Allow calling with or without "qrMenu." prefix
  const cleanKey = key.startsWith('qrMenu.') ? key.slice(7) : key;
  const parts = cleanKey.split('.');
  let node: any = qrMenuNs;

  for (const part of parts) {
    if (node && typeof node === 'object' && part in node) {
      node = node[part];
    } else {
      return key; // fallback to raw key
    }
  }

  // Extract the translated string for the current lang (or en fallback)
  let text: string;
  if (node && typeof node === 'object') {
    text = (lang in node ? String(node[lang]) : ( 'en' in node ? String(node['en']) : key ));
  } else if (typeof node === 'string') {
    text = node;
  } else {
    text = key;
  }

  // Always apply param interpolation AFTER getting the text
  if (params) {
    text = text.replace(/\{(\w+)\}/g, (_, k) => {
      const v = params[k];
      if (v === undefined || v === null) return `{${k}}`;
      return String(typeof v === 'function' ? '' : v);
    });
  }

  return text;
}

// ─── Interfaces (inchangées) ──────────────────────────────────────────────────
interface MenuItem {
  id: number;
  name: string;
  description: string | null;
  price: number;
  currency: string | null;
  unit: string | null;
  image_url: string | null;
  is_available: number;
  in_stock?: boolean;
  stock_quantity?: number | null;
  minimum_stock?: number | null;
}
interface MenuCategory { id: number; name: string; description: string | null; items: MenuItem[]; }
interface TableInfo { id: number; table_number: string; capacity: number; }
interface CartItem { productId: number; quantity: number; price: number; currency: string | null; name: string; }

// ─── Design tokens ────────────────────────────────────────────────────────────
const T = {
  bg:          '#060f0a',
  bg2:         '#0b1a10',
  bg3:         '#0f2016',
  bg4:         '#142818',
  gold:        '#c8a84b',
  gold2:       '#e4c66a',
  gold3:       '#f0d68c',
  goldDim:     'rgba(200,168,75,0.12)',
  goldBorder:  'rgba(200,168,75,0.22)',
  text:        '#ece5d5',
  text2:       '#a8997e',
  text3:       '#5c5240',
  border:      'rgba(255,255,255,0.055)',
  red:         '#f08070',
  redBg:       'rgba(240,128,112,0.10)',
  redBorder:   'rgba(240,128,112,0.22)',
  amber:       '#d49040',
  amberBg:     'rgba(212,144,64,0.10)',
  amberBorder: 'rgba(212,144,64,0.22)',
  green:       '#4ab878',
  greenBg:     'rgba(74,184,120,0.10)',
  greenBorder: 'rgba(74,184,120,0.22)',
  serif:       "'Cormorant Garamond', Georgia, serif",
  mono:        "'DM Mono', monospace",
  sans:        "'Inter', sans-serif",
};

// ─── Fonts + CSS (injected once) ──────────────────────────────────────────────
const FONT_URL = 'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;0,700;1,300;1,400;1,600&family=DM+Mono:wght@400;500&family=Inter:wght@300;400;500;600&display=swap';
const CSS = `
  @keyframes qr-spin { to { transform: rotate(360deg); } }
  @keyframes toast-in {
    from { opacity: 0; transform: translateX(-50%) translateY(12px); }
    to { opacity: 1; transform: translateX(-50%) translateY(0); }
  }
  .qr-cat-nav::-webkit-scrollbar { display: none; }
  .qr-cat-nav { scrollbar-width: none; }
  .qr-scroll::-webkit-scrollbar { width: 3px; }
  .qr-scroll::-webkit-scrollbar-thumb { background: rgba(200,168,75,0.3); border-radius:10px; }
  .qr-item-card { transition: border-color 0.15s; }
  .qr-item-card:hover { border-color: rgba(255,255,255,0.12) !important; }
  .qr-step-btn:hover { background: rgba(200,168,75,0.12) !important; }
  .qr-add-btn:hover:not(:disabled) { background: rgba(200,168,75,0.18) !important; }
  .qr-cat-btn { transition: all 0.13s; }
  .qr-checkout-btn:hover { opacity: .9; }
  @media (max-width: 360px) {
    .qr-item-img { width: 52px !important; height: 52px !important; }
    .qr-hero-title { font-size: 42px !important; }
  }
`;

function injectAssets() {
  if (!document.getElementById('qr-fonts')) {
    const l = document.createElement('link');
    l.id = 'qr-fonts'; l.rel = 'stylesheet'; l.href = FONT_URL;
    document.head.appendChild(l);
  }
  if (!document.getElementById('qr-css')) {
    const s = document.createElement('style');
    s.id = 'qr-css'; s.textContent = CSS;
    document.head.appendChild(s);
  }
}

// ─── Shared style helpers ─────────────────────────────────────────────────────
const btnGoldSolid: React.CSSProperties = {
  padding: '9px 16px', background: T.gold, color: T.bg, border: 'none',
  borderRadius: 10, fontSize: 12, fontWeight: 700, letterSpacing: '0.06em',
  textTransform: 'uppercase', cursor: 'pointer', fontFamily: T.sans,
  whiteSpace: 'nowrap', touchAction: 'manipulation',
};
const btnGhost: React.CSSProperties = {
  padding: '9px 14px', background: 'transparent',
  border: '1px solid rgba(255,255,255,0.10)', borderRadius: 10,
  color: T.text2, fontSize: 12, fontWeight: 600, cursor: 'pointer',
  fontFamily: T.sans, whiteSpace: 'nowrap', touchAction: 'manipulation',
};
const btnLink: React.CSSProperties = {
  background: 'none', border: 'none', color: T.gold, fontSize: 11,
  textDecoration: 'underline', cursor: 'pointer', fontFamily: T.sans, padding: 0,
};

// ─── STATUS label map ─────────────────────────────────────────────────────────
const STATUS_LABELS: Record<string, string> = {
  pending: 'En attente', confirmed: 'Confirmée', preparing: 'En préparation',
  ready: 'Prête', served: 'Servie', paid: 'Montant total à payer',
  cancelled: 'Annulée', rejected: 'Rejetée',
};

// ─── Sub-components ───────────────────────────────────────────────────────────

const StatusChip = ({ status }: { status: string }) => {
  const label = STATUS_LABELS[status] || status;
  const color = ['paid','served'].includes(status) ? T.green
    : ['cancelled','rejected'].includes(status) ? T.red
    : T.gold2;
  const bg = ['paid','served'].includes(status) ? T.greenBg
    : ['cancelled','rejected'].includes(status) ? T.redBg
    : T.goldDim;
  const border = ['paid','served'].includes(status) ? T.greenBorder
    : ['cancelled','rejected'].includes(status) ? T.redBorder
    : T.goldBorder;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase',
      borderRadius: 20, padding: '4px 10px', background: bg, color, border: `1px solid ${border}`,
    }}>
      <span style={{ width: 4, height: 4, borderRadius: '50%', background: 'currentColor', flexShrink: 0 }} />
      {label}
    </span>
  );
};





// ─── Main component ───────────────────────────────────────────────────────────
const PublicMenuPage = () => {
  const [searchParams] = useSearchParams();
  const location = useLocation();

  // Token can be provided either as:
  // 1) ?token=<qr_token> (query param)
  // 2) /menu/table/<qr_token> (path segment) — what the QR codes use
  const tokenFromQuery = searchParams.get('token') || '';
  const tokenLooksValid = (v: string) => {
    const s = String(v || '').trim();
    // QR token is hex/alphanum and long (example: e4dcff57ac52430a...)
    // Keep it permissive but avoid empty/malformed values.
    return s.length >= 12 && /^[a-zA-Z0-9]+$/.test(s);
  };

  const tokenFromPath = (() => {
    try {
      const parts = String(location.pathname || '').split('/').filter(Boolean);

      // expected tail: .../menu/table/:qr_token
      const tokenIndex = parts.lastIndexOf('table');
      if (tokenIndex >= 0 && tokenIndex + 1 < parts.length && tokenLooksValid(parts[tokenIndex + 1])) {
        return parts[tokenIndex + 1];
      }

      // fallback: if route is directly /menu/<anything>/<token>
      const last = parts[parts.length - 1] || '';
      return tokenLooksValid(last) ? last : '';
    } catch {
      return '';
    }
  })();

  const token = tokenFromQuery || tokenFromPath || '';

  // Local language for public QR Menu (independent of staff settings)
  // Default: English as requested
  const [qrLang, setQrLang] = useState<'en' | 'fr' | 'pt'>(() => {
    if (!token) return 'en';
    const saved = localStorage.getItem(`qr_lang_${token}`);
    return (saved as 'en' | 'fr' | 'pt') || 'en';
  });

  const changeQrLang = (l: 'en' | 'fr' | 'pt') => {
    setQrLang(l);
    localStorage.setItem(`qr_lang_${token}`, l);
  };

  // Bound translator for this public page (uses local qrLang, English default)
  const t = (key: string, params?: Record<string, string | number>) => qrT(qrLang, key, params);

  // Translate category names for the public QR menu
  const getCategoryName = (originalName: string): string => {
    const key = originalName.toLowerCase().replace(/\s+/g, '');
    // Map common variations + plurals
    const categoryKeyMap: Record<string, string> = {
      beer: 'beer',
      beers: 'beers',
      wine: 'wine',
      wines: 'wines',
      whisky: 'whisky',
      'soft drinks': 'softDrinks',
      softdrinks: 'softDrinks',
      cocktails: 'cocktails',
      coktails: 'cocktails',
      food: 'food',
      tequila: 'tequila',
      cognac: 'cognac',
      champagne: 'champagne',
      water: 'water',
    };
    const mappedKey = categoryKeyMap[key] || key;
    const translated = t(`qrMenu.categories.${mappedKey}`);
    // If no translation found (returns the key itself), fallback to original
    return translated.includes('qrMenu.categories.') ? originalName : translated;
  };

  const StockBadge = ({ item, onAlert }: { item: MenuItem; onAlert: () => void }) => {
    const dot = <span style={{ width: 4, height: 4, borderRadius: '50%', background: 'currentColor', flexShrink: 0 }} />;

    if (!item.in_stock) return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', borderRadius: 20, padding: '4px 10px', background: T.redBg, color: T.red, border: `1px solid ${T.redBorder}` }}>
        {dot}{t('qrMenu.outOfStock')}
        <button onClick={onAlert} style={{ ...btnLink, color: T.text3, fontSize: 10, paddingLeft: 4 }}>{t('qrMenu.notify')}</button>
      </span>
    );

    if (item.stock_quantity != null && item.stock_quantity <= (item.minimum_stock || 5)) return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', borderRadius: 20, padding: '4px 10px', background: T.amberBg, color: T.amber, border: `1px solid ${T.amberBorder}` }}>
        {dot}{t('qrMenu.lowStock', { qty: item.stock_quantity })}
      </span>
    );

    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', borderRadius: 20, padding: '4px 10px', background: T.greenBg, color: T.green, border: `1px solid ${T.greenBorder}` }}>
        {dot}{t('qrMenu.inStock')}
      </span>
    );
  };

  // ─── Beautiful Order Status Tracker (moved inside for t() access) ───────────
  const OrderStatusTracker = ({ status }: { status: string }) => {
    const steps = [
      { key: 'pending',    label: t('qrMenu.trackerReceived'),   icon: <Clock size={14} /> },
      { key: 'confirmed',  label: t('qrMenu.trackerConfirmed'),  icon: <CheckCircle2 size={14} /> },
      { key: 'preparing',  label: t('qrMenu.trackerPreparing'),  icon: <ChefHat size={14} /> },
      { key: 'ready',      label: t('qrMenu.trackerReady'),      icon: <Package size={14} /> },
      { key: 'served',     label: t('qrMenu.trackerServed'),     icon: <UtensilsCrossed size={14} /> },
    ];

    const currentIndex = steps.findIndex(s => s.key === status);
    const isFinal = ['paid', 'served'].includes(status);
    const isError = ['cancelled', 'rejected'].includes(status);

    if (isError) {
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: T.redBg, border: `1px solid ${T.redBorder}`, borderRadius: 12 }}>
          <X size={16} color={T.red} />
          <span style={{ fontSize: 13, fontWeight: 600, color: T.red }}>
            {STATUS_LABELS[status] || t('qrMenu.statusCancelled')}
          </span>
        </div>
      );
    }

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'space-between' }}>
          {steps.map((step, index) => {
            const isActive = index === currentIndex;
            const isDone = currentIndex > index || isFinal;

            return (
              <div key={step.key} style={{ 
                display: 'flex', 
                flexDirection: 'column', 
                alignItems: 'center', 
                flex: 1,
                opacity: isDone || isActive ? 1 : 0.4 
              }}>
                <div style={{
                  width: 28, height: 28,
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: isActive ? T.gold : (isDone ? T.green : T.bg3),
                  color: isActive ? T.bg : (isDone ? '#fff' : T.text3),
                  border: isActive ? '2px solid #fff' : '1px solid ' + (isDone ? T.green : T.goldBorder),
                  transition: 'all 0.2s ease',
                }}>
                  {isDone && !isActive ? <Check size={14} /> : step.icon}
                </div>
                <div style={{ 
                  fontSize: 9, 
                  fontWeight: isActive ? 700 : 500, 
                  color: isActive ? T.gold2 : T.text3, 
                  marginTop: 4,
                  textAlign: 'center',
                  letterSpacing: '0.02em'
                }}>
                  {step.label}
                </div>
              </div>
            );
          })}
        </div>

        {/* Progress bar */}
        <div style={{ height: 3, background: T.bg3, borderRadius: 2, overflow: 'hidden', marginTop: 6 }}>
          <div style={{
            height: '100%',
            width: `${Math.min(((currentIndex + 1) / steps.length) * 100, 100)}%`,
            background: isFinal ? T.green : T.gold,
            transition: 'width 0.4s ease',
          }} />
        </div>
      </div>
    );
  };

  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [table, setTable]     = useState<TableInfo | null>(null);
  const [menu, setMenu]       = useState<MenuCategory[]>([]);
  const [activecat, setActivecat] = useState<number | null>(null);

  const [cart, setCart]           = useState<Record<number, CartItem>>({});
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerPin, setCustomerPin]     = useState('');
  const [phoneInput, setPhoneInput]       = useState('');
  const [validationPinInput, setValidationPinInput] = useState('');
  const [isValidatingOrder, setIsValidatingOrder]   = useState(false);
  const [orderClientValidated, setOrderClientValidated] = useState(false);
  const [localOrderData, setLocalOrderData] = useState<any>(null);
  const [showAccountCreation, setShowAccountCreation] = useState(false);
  const [pinAttempts, setPinAttempts] = useState(0);
  const [isCartOpen, setIsCartOpen]   = useState(false);
  const [orderNotes, setOrderNotes]   = useState('');
  const [showPhoneForm, setShowPhoneForm] = useState(false);

  const [pendingOrderId, setPendingOrderId]       = useState<number | null>(null);
  const [activeOrderId, setActiveOrderId]         = useState<number | null>(null);
  const [pendingOrderMessage, setPendingOrderMessage] = useState<string | null>(null);
  const [pendingOrderStatus, setPendingOrderStatus]   = useState<string | null>(null);
  const [pendingOrderTotal, setPendingOrderTotal]     = useState<number | null>(null);
  const [pendingOrderItemCount, setPendingOrderItemCount] = useState<number>(0);
  const [pendingOrderItems, setPendingOrderItems] = useState<any[]>([]);
  const [showOrderItems, setShowOrderItems] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(false);

  // ─── Aesthetic Toast Notifications for QR Customer Experience ─────────────
  const [toast, setToast] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);

  const showToast = (type: 'success' | 'error' | 'info', message: string, duration = 4200) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), duration);
  };

  const cartItems = Object.values(cart);
  const cartTotal = cartItems.reduce((sum, it) => sum + it.price * it.quantity, 0);
  const cartQty   = cartItems.reduce((s, it) => s + it.quantity, 0);
  const currency  = cartItems[0]?.currency || 'ZMW';

  const categoryRefs = useRef<Record<number, HTMLElement | null>>({});

  useEffect(() => { injectAssets(); }, []);

  const scrollToCategory = (id: number) => {
    setActivecat(id);
    const el = categoryRefs.current[id];
    if (el) {
      const y = el.getBoundingClientRect().top + window.pageYOffset - 120;
      window.scrollTo({ top: y, behavior: 'smooth' });
    }
  };

  // ─── Persist helpers ──────────────────────────────────────────────────────
  const buildStatusMessage = (st: string) => {
    const num = pendingOrderId ?? '';
    switch (st) {
      case 'pending':   return `${t('qrMenu.orderNumber', { num })} · ${t('qrMenu.statusPending')}`;
      case 'confirmed': return `${t('qrMenu.orderNumber', { num })} · ${t('qrMenu.statusConfirmed')}`;
      case 'preparing': return `${t('qrMenu.orderNumber', { num })} · ${t('qrMenu.statusPreparing')}`;
      case 'ready':     return `${t('qrMenu.orderNumber', { num })} · ${t('qrMenu.statusReady')}`;
      case 'served':    return `${t('qrMenu.orderNumber', { num })} · ${t('qrMenu.statusServed')}`;
      case 'paid':      return `${t('qrMenu.orderNumber', { num })} · ${t('qrMenu.statusPaid')}`;
      case 'cancelled': return `${t('qrMenu.orderNumber', { num })} · ${t('qrMenu.statusCancelled')}`;
      case 'rejected':  return `${t('qrMenu.orderNumber', { num })} · ${t('qrMenu.statusRejected')}`;
      default:          return `${t('qrMenu.orderNumber', { num })} · ${t('qrMenu.statusPending')}`;
    }
  };

  const persistOrder = (id: number | null, msg: string | null, st: string | null, tot: number | null, activeId: number | null = null, itemCount: number | null = null, items?: any[]) => {
    if (!token) return;
    const key = `qr_pending_order_${token}`;
    if (id != null && msg) {
      localStorage.setItem(key, JSON.stringify({ 
        orderId: id, 
        activeOrderId: activeId || id, 
        message: msg, 
        status: st, 
        total: tot, 
        itemCount, 
        items: items || [] 
      }));
    } else { localStorage.removeItem(key); }
  };

  const persistCustomer = (phone: string, pin: string) => {
    if (!token) return;
    const key = `qr_customer_${token}`;
    if (phone) localStorage.setItem(key, JSON.stringify({ phone, pin, savedAt: Date.now() }));
    else localStorage.removeItem(key);
  };

  const persistLocalOrder = (data: any | null) => {
    if (!token) return;
    const key = `qr_local_order_${token}`;
    if (data) localStorage.setItem(key, JSON.stringify(data));
    else localStorage.removeItem(key);
  };

  // ─── Cart logic ───────────────────────────────────────────────────────────
  const addToCart = (item: MenuItem) => {
    setCart(prev => {
      const price = Number(item.price) || 0;
      const existing = prev[item.id];
      if (existing) return { ...prev, [item.id]: { ...existing, quantity: existing.quantity + 1, price, currency: item.currency ?? null, name: item.name } };
      return { ...prev, [item.id]: { productId: item.id, quantity: 1, price, currency: item.currency ?? null, name: item.name } };
    });
    showToast('success', `${item.name} ${t('qrMenu.addToCart').toLowerCase()}`);
  };

  const updateQty = (productId: number, delta: number) => {
    setCart(prev => {
      const existing = prev[productId];
      if (!existing) return prev;
      const nextQty = existing.quantity + delta;
      if (nextQty <= 0) { const { [productId]: _, ...rest } = prev; return rest; }
      return { ...prev, [productId]: { ...existing, quantity: nextQty } };
    });
  };

  const removeFromCart = (productId: number) => {
    setCart(prev => { const { [productId]: _, ...rest } = prev; return rest; });
  };

  // ─── Checkout ─────────────────────────────────────────────────────────────
  const checkout = () => {
    if (!token)        { showToast('error', 'Token de menu manquant.'); return; }
    if (!cartItems.length) { showToast('error', t('qrMenu.cartEmpty') + '.'); return; }
    if (customerPhone) {
      const d = customerPhone.replace(/\D/g, '');
      if (d.length < 9)  { showToast('error', 'Numéro minimum 9 chiffres.'); return; }
      if (d.length > 14) { showToast('error', 'Numéro maximum 14 chiffres.'); return; }
    }
    const localData = {
      items: cartItems.map(it => ({ 
        product_id: it.productId, 
        quantity: it.quantity,
        name: it.name   // for display in the PIN confirmation screen
      })),
      total: cartTotal, 
      customer_phone: customerPhone || undefined,
      notes: orderNotes.trim() || undefined,
    };
    setLocalOrderData(localData); persistLocalOrder(localData);
    setCart({}); setShowAccountCreation(false); setPinAttempts(0); setOrderNotes('');
    setActiveOrderId(null);
    setPendingOrderId(null);
      const msg = t('qrMenu.orderPrepared');
    setPendingOrderMessage(msg); setPendingOrderTotal(cartTotal);
    persistOrder(null, msg, null, cartTotal);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const alertStock = async (item: MenuItem, categoryName: string) => {
    try {
      await fetch(apiUrl('/api/menu/stock-alert'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_id: item.id,
          product_name: item.name,
          table_number: table?.table_number,
          message: `Table ${table?.table_number} — "${item.name}" (${categoryName}) hors stock.`,
        }),
      });
      showToast('success', t('qrMenu.notifyStock', { item: item.name }));
    } catch {
      showToast('info', t('qrMenu.notifyUnavailable', { item: item.name }));
    }
  };

  const associatePhone = async (phone: string) => {
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 9) {
      showToast('error', 'Minimum 9 chiffres.');
      return;
    }
    if (digits.length > 14) {
      showToast('error', 'Maximum 14 chiffres.');
      return;
    }
    try {
      const res = await fetch(apiUrl('/api/menu/register-customer'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone_number: digits }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) throw new Error(data?.error || 'Échec enregistrement');
      setCustomerPhone(data.phone_number);
      setCustomerPin(data.pin_code || digits.slice(-6));
      persistCustomer(data.phone_number, data.pin_code || digits.slice(-6));
      showToast(
        'success',
        data.alreadyExists
          ? 'Numéro déjà enregistré. Bienvenue !'
          : `${t('qrMenu.createAccount')}! ${t('qrMenu.phoneNumber')}: ${data.phone_number} — PIN: ${data.pin_code || digits.slice(-6)}`
      );
      setShowAccountCreation(false);
    } catch (e: any) {
      showToast('error', `Impossible d'enregistrer : ${e.message || 'Erreur serveur'}`);
    }
  };

  const validateOrderWithPin = async () => {
    if (!localOrderData) {
      showToast('error', t('qrMenu.error'));
      return;
    }
    if (!validationPinInput.trim()) {
      showToast('error', t('qrMenu.enterPin'));
      return;
    }
    setIsValidatingOrder(true);
    try {
      const pin = validationPinInput.trim();
      const coRes = await fetch(apiUrl('/api/menu/checkout'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          qr_token: token,
          customer_phone: localOrderData.customer_phone || customerPhone || undefined,
          pin_code: pin,
          items: localOrderData.items,
          notes: localOrderData.notes,
          order_id: activeOrderId || undefined,
          total: localOrderData.total,   // ensure total is sent at root level
        }),
      });
      const coData = await coRes.json().catch(() => ({}));
      if (!coRes.ok) {
        const err = coData?.error || t('qrMenu.pinIncorrect');
        if (coData?.pinNotFound || coData?.requiresRegistration) {
          const n = pinAttempts + 1;
          setPinAttempts(n);
          if (n >= 3) setShowAccountCreation(true);
        }
        const displayError = coData?.debug ? `${err} (détail: ${coData.debug})` : err;
        showToast('error', displayError);
        return;
      }
      if (!coData?.orderId) throw new Error(coData?.error || 'Échec création commande');
      const createdOrderId = Number(coData.orderId);
      if (coData.customerPhone) {
        setCustomerPhone(coData.customerPhone);
        persistCustomer(coData.customerPhone, pin);
      }
      setOrderClientValidated(true);
      setValidationPinInput('');
      setPinAttempts(0);
      const msg = `${t('qrMenu.orderNumber', { num: createdOrderId })} ${t('qrMenu.statusPending')}`;
      setPendingOrderId(createdOrderId);
      setBannerDismissed(false);
      const itemCount = Array.isArray(localOrderData?.items)
        ? localOrderData.items.reduce((s: number, it: any) => s + (Number(it.quantity) || 0), 0)
        : 0;
      setPendingOrderMessage(msg);
      setPendingOrderTotal(localOrderData?.total ?? null);
      setPendingOrderItemCount(itemCount);
      const itemsSnapshot = Array.isArray(localOrderData?.items) ? localOrderData.items : [];
      setPendingOrderItems(itemsSnapshot);
      persistOrder(createdOrderId, msg, null, localOrderData?.total ?? null, null, itemCount, itemsSnapshot);
      setLocalOrderData(null);
      persistLocalOrder(null);
      setCart({});
      showToast('success', t('qrMenu.orderSent'));
    } catch (e: any) {
      showToast('error', e?.message || 'Erreur lors de la validation');
    } finally {
      setIsValidatingOrder(false);
    }
  };

  // ─── Restore on refresh ───────────────────────────────────────────────────
  useEffect(() => {
    if (!token) return;
    try {
      const rawP = localStorage.getItem(`qr_pending_order_${token}`);
      let hasActive = false;
      if (rawP) {
        const p = JSON.parse(rawP);
        if (p?.orderId) {
          hasActive = true; setPendingOrderId(p.orderId); setBannerDismissed(false);
          setActiveOrderId(p.activeOrderId || p.orderId);             setPendingOrderMessage(p.message || t('qrMenu.orderSent'));
          setPendingOrderStatus(p.status || null); setPendingOrderTotal(p.total ?? null);
          setPendingOrderItemCount(p.itemCount ?? 0); 
          // Enrich from localStorage if possible (will be overwritten by first poll anyway)
          const restoredItems = Array.isArray(p.items) ? p.items : [];
          const enrichedRestored = restoredItems.map((it: any) => {
            const pid = it.product_id || it.productId || it.id;
            let foundPrice = Number(it.price || it.unit_price || 0);
            if (!foundPrice && pid && menu.length > 0) {
              for (const cat of menu) {
                const match = cat.items.find((m: any) => m.id === pid);
                if (match) { foundPrice = Number(match.price || 0); break; }
              }
            }
            return { ...it, price: foundPrice };
          });
          setPendingOrderItems(enrichedRestored);
          setOrderClientValidated(true);
        }
      }
      const rawL = localStorage.getItem(`qr_local_order_${token}`);
      if (rawL) {
        const l = JSON.parse(rawL);
        if (l) { setLocalOrderData(l); if (!hasActive) {             setPendingOrderMessage(t('qrMenu.orderPrepared')); setPendingOrderTotal(l.total ?? null); } }
      }
      const rawC = localStorage.getItem(`qr_customer_${token}`);
      if (rawC) { const c = JSON.parse(rawC); if (c?.phone) { setCustomerPhone(c.phone); setCustomerPin(c.pin || c.phone.replace(/\D/g, '').slice(-6)); } }
    } catch {}
  }, [token]);

  // ─── Poll order status (public QR customers) ─────────────────────────────
  useEffect(() => {
    if (!token || !pendingOrderId) return;

    let cancelled = false;
    let intervalId: any = null;
    let consecutiveErrors = 0;
    const MAX_ERRORS_BEFORE_STOP = 8;
    const POLL_INTERVAL = 7000; // less aggressive than before (was 3000)

    const isFinal = (s: string) => ['paid','served','cancelled','rejected'].includes(String(s));

    const fetchStatus = async () => {
      try {
        // Use the public menu endpoint that reads directly from Supabase for real-time customer visibility
        const res = await fetch(apiUrl(`/api/menu/order-status/${pendingOrderId}`));
        const data = await res.json().catch(() => ({}));

        if (cancelled) return;

        if (!res.ok) {
          consecutiveErrors++;
          if (consecutiveErrors >= MAX_ERRORS_BEFORE_STOP && intervalId) {
            clearInterval(intervalId);
            setPendingOrderMessage(t('qrMenu.statusPending') + '. ' + t('qrMenu.error') + ' (rafraîchir la page).');
          }
          return;
        }

        consecutiveErrors = 0; // success → reset

        const st = data?.status;
        if (!st) return;

        setPendingOrderStatus(st);
        setPendingOrderMessage(buildStatusMessage(st));

        if (data?.total != null) setPendingOrderTotal(Number(data.total));
        if (Array.isArray(data?.items)) {
          setPendingOrderItemCount(data.items.reduce((s: number, i: any) => s + (Number(i.quantity) || 0), 0));
          // Enrich raw Supabase items (which often lack price) with prices from the loaded menu
          const enriched = data.items.map((it: any) => {
            const pid = it.product_id || it.productId || it.id;
            let foundPrice = Number(it.price || it.unit_price || 0);
            if (!foundPrice && pid) {
              // lookup in loaded menu
              for (const cat of menu) {
                const match = cat.items.find((m: any) => m.id === pid);
                if (match) {
                  foundPrice = Number(match.price || 0);
                  break;
                }
              }
            }
            return { ...it, price: foundPrice };
          });
          setPendingOrderItems(enriched);
        }

        if (isFinal(st) && intervalId) {
          clearInterval(intervalId);
        }
      } catch {
        consecutiveErrors++;
        if (consecutiveErrors >= MAX_ERRORS_BEFORE_STOP && intervalId) {
          clearInterval(intervalId);
            setPendingOrderMessage(t('qrMenu.statusPending') + '. ' + t('qrMenu.error') + ' (rafraîchir la page).');
        }
      }
    };

    fetchStatus();
    intervalId = setInterval(fetchStatus, POLL_INTERVAL);

    return () => {
      cancelled = true;
      if (intervalId) clearInterval(intervalId);
    };
  }, [token, pendingOrderId, orderClientValidated]);

  // ─── Fetch menu with silent retries for Render cold starts (no user-facing message) ───
  const loadMenu = async (attempt: number = 1) => {
    if (!token) return;

    const MAX_ATTEMPTS = 5;
    const BASE_DELAY = 1500; // ms

    try {
      if (attempt === 1) {
        setLoading(true);
        setError(null);
      }

      const targetUrl = apiUrl(`/api/menu/table/${encodeURIComponent(token)}`);
      console.log(`[Frontend API URL] attempt ${attempt}`, targetUrl);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 25000); // 25s timeout for cold starts

      const res = await fetch(targetUrl, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        console.error('Menu fetch failed:', res.status, text);
        throw new Error(`Erreur serveur (${res.status})`);
      }

      const data = await res.json();
      setTable(data.table);
      const normalized = (data.menu || []).map((cat: any) => ({
        ...cat,
        items: (cat.items || []).map((it: any) => ({ ...it, price: Number(it.price) || 0 })),
      }));
      setMenu(normalized);
      setActivecat(normalized[0]?.id ?? null);
      setError(null);
      setLoading(false);
    } catch (err: any) {
      console.error(`[MENU FETCH ERROR] attempt ${attempt}`, err);

      const isNetworkError = err?.name === 'AbortError' ||
                             /network|fetch|failed to fetch|timeout/i.test(err?.message || '');

      if (isNetworkError && attempt < MAX_ATTEMPTS) {
        // Silent retry with exponential backoff (good for Render cold starts)
        const delay = BASE_DELAY * Math.pow(1.8, attempt - 1);
        console.log(`[MENU] Retrying in ${Math.round(delay)}ms (attempt ${attempt + 1}/${MAX_ATTEMPTS})`);
        setTimeout(() => loadMenu(attempt + 1), delay);
      } else {
        // Final failure after all retries
        setError(err instanceof Error ? err.message : 'Failed to fetch');
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }
    loadMenu();
  }, [token]);

  // ─── Loading ──────────────────────────────────────────────────────────────
  if (loading) return (
    <div style={{ minHeight: '100vh', background: T.bg, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 24 }}>
      <div style={{ width: 44, height: 44, border: `1.5px solid ${T.gold}`, borderTopColor: 'transparent', borderRadius: '50%', animation: 'qr-spin 0.9s linear infinite' }} />
      <p style={{ color: T.gold, fontSize: 10, letterSpacing: '0.28em', textTransform: 'uppercase', fontFamily: T.sans, fontWeight: 600 }}>
        {t('qrMenu.loading')}
      </p>
    </div>
  );

  // ─── Public landing (root visit, no token) or real error ────────────────
  if (!token) {
    // Beautiful public landing page for bare domain / direct visits
    return (
      <div style={{ minHeight: '100vh', background: T.bg, color: T.text, fontFamily: T.sans, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div style={{ maxWidth: 420, textAlign: 'center' }}>
          <div style={{ width: 72, height: 72, borderRadius: '50%', border: `2px solid ${T.gold}`, background: T.bg2, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 24px' }}>
            <UtensilsCrossed color={T.gold} size={32} />
          </div>
          <h1 style={{ fontFamily: T.serif, fontSize: 42, fontWeight: 700, color: T.text, marginBottom: 12, lineHeight: 1.05 }}>
            {APP_NAME}
          </h1>
          <p style={{ fontSize: 15, color: T.text2, marginBottom: 28, lineHeight: 1.5 }}>
            Bienvenue ! Scannez le QR code de votre table pour découvrir le menu et passer commande directement depuis votre téléphone.
          </p>
          <div style={{ fontSize: 12, color: T.text3, letterSpacing: '0.06em' }}>
            Le lien se trouve sur le sous-bock ou le présentoir de votre table.
          </div>
        </div>
      </div>
    );
  }

  if (error || !table) {
    // Simple error screen only — no special "cold start" message
    return (
      <div style={{ minHeight: '100vh', background: T.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 32, fontFamily: T.sans }}>
        <div style={{ maxWidth: 340, textAlign: 'center' }}>
          <div style={{ width: 60, height: 60, borderRadius: '50%', border: `1.5px solid ${T.goldBorder}`, background: T.bg2, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 24px' }}>
            <UtensilsCrossed color={T.gold} size={26} />
          </div>

          <h1 style={{ fontFamily: T.serif, fontSize: 34, fontWeight: 700, color: T.text, marginBottom: 12, lineHeight: 1.1 }}>
            Menu indisponible
          </h1>

          <p style={{ color: T.text2, fontSize: 15, marginBottom: 20, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
            {error || 'Impossible de charger le menu pour le moment.'}
          </p>

          <button
            onClick={() => window.location.reload()}
            style={{ ...btnGoldSolid, marginTop: 8 }}
          >
            Réessayer
          </button>

          <p style={{ color: T.text3, fontSize: 12, letterSpacing: '0.05em', lineHeight: 1.7, marginTop: 16 }}>
            Scannez le QR code de votre table ou demandez un nouveau code au personnel.
          </p>
        </div>
      </div>
    );
  }

  const showBanner = (pendingOrderMessage || localOrderData || pendingOrderId) && !(pendingOrderId && bannerDismissed);

  // ─── Main render ──────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: '100vh', background: T.bg, color: T.text, fontFamily: T.sans }}>

      {/* Language switcher for public QR Menu (default English) */}
      <div style={{ 
        position: 'fixed', top: 8, right: 12, zIndex: 100, 
        display: 'flex', gap: 4, background: 'rgba(0,0,0,0.4)', 
        borderRadius: 999, padding: 2, backdropFilter: 'blur(8px)'
      }}>
        <button onClick={() => changeQrLang('en')} style={{ padding: '2px 8px', fontSize: 10, borderRadius: 999, border: 'none', background: qrLang === 'en' ? T.gold : 'transparent', color: qrLang === 'en' ? T.bg : T.text2, fontWeight: 600, cursor: 'pointer' }}>
          {t('qrMenu.langEn')}
        </button>
        <button onClick={() => changeQrLang('fr')} style={{ padding: '2px 8px', fontSize: 10, borderRadius: 999, border: 'none', background: qrLang === 'fr' ? T.gold : 'transparent', color: qrLang === 'fr' ? T.bg : T.text2, fontWeight: 600, cursor: 'pointer' }}>
          {t('qrMenu.langFr')}
        </button>
        <button onClick={() => changeQrLang('pt')} style={{ padding: '2px 8px', fontSize: 10, borderRadius: 999, border: 'none', background: qrLang === 'pt' ? T.gold : 'transparent', color: qrLang === 'pt' ? T.bg : T.text2, fontWeight: 600, cursor: 'pointer' }}>
          {t('qrMenu.langPt')}
        </button>
      </div>

      {/* ══ STICKY BANNER ══════════════════════════════════════════════════ */}
      {showBanner && (
        <div style={{
          position: 'sticky', top: 0, zIndex: 70,
          background: 'rgba(6,15,10,0.97)', borderBottom: `1px solid ${T.goldBorder}`,
          padding: '14px 16px', backdropFilter: 'blur(16px)',
        }}>
          {/* Order ref - clean, no repetition */}
          {pendingOrderId && (
            <div style={{ fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', color: T.gold, fontWeight: 700, marginBottom: 2 }}>
              {t('qrMenu.orderNumber', { num: pendingOrderId })}
            </div>
          )}
          {/* Status message - simplified, no tautology */}
          <div style={{ fontSize: 12, fontWeight: 500, color: T.text, lineHeight: 1.4, marginBottom: 6 }}>
            {pendingOrderStatus 
              ? t(`qrMenu.status${pendingOrderStatus.charAt(0).toUpperCase() + pendingOrderStatus.slice(1)}`)
              : (pendingOrderMessage || t('qrMenu.statusPending'))
            }
          </div>

          {/* Beautiful Order Status Tracker + Items toggle */}
          {!localOrderData && pendingOrderId && pendingOrderStatus && (
            <div style={{ marginBottom: 10 }}>
              <OrderStatusTracker status={pendingOrderStatus} />

              {pendingOrderItemCount > 0 && pendingOrderTotal != null && (
                <div style={{ 
                  display: 'flex', 
                  justifyContent: 'space-between', 
                  alignItems: 'center', 
                  marginTop: 10,
                  fontSize: 12,
                  color: T.text2,
                  gap: 12
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span>{t('qrMenu.itemsCount', { 
                      count: pendingOrderItemCount, 
                      plural: pendingOrderItemCount > 1 ? 's' : '' 
                    })}</span>
                    <span style={{ fontFamily: T.mono, color: T.gold, fontWeight: 600 }}>
                      {pendingOrderTotal.toFixed(0)} {t('qrMenu.currency')}
                    </span>
                  </div>

                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    {/* Toggle Ma commande / Cacher commande */}
                    <button 
                      onClick={() => setShowOrderItems(!showOrderItems)} 
                      style={{ 
                        ...btnLink, 
                        fontSize: 11, 
                        padding: '4px 10px',
                        background: showOrderItems ? 'rgba(212,175,55,0.15)' : 'transparent',
                        borderRadius: 6,
                        border: showOrderItems ? `1px solid ${T.goldBorder}` : 'none'
                      }}
                    >
                      {showOrderItems ? t('qrMenu.hideOrder') : t('qrMenu.myOrder')}
                    </button>

                    <button 
                      onClick={() => setBannerDismissed(true)} 
                      style={{ ...btnLink, fontSize: 10, opacity: 0.7 }}
                    >
                      {t('qrMenu.hide')}
                    </button>
                  </div>
                </div>
              )}

              {/* Improved items list */}
              {showOrderItems && (
                pendingOrderItems.length > 0 ? (
                  <div style={{ 
                    marginTop: 8, 
                    padding: '10px 14px', 
                    background: 'rgba(0,0,0,0.35)', 
                    borderRadius: 10,
                    fontSize: 12,
                    color: T.text,
                    border: `1px solid ${T.goldBorder}`
                  }}>
                    {pendingOrderItems.map((it: any, idx: number) => {
                      const price = Number(it.price || it.unit_price || 0);
                      const qty = Number(it.quantity || 1);
                      return (
                         <div key={idx} style={{ 
                           display: 'flex', 
                           justifyContent: 'space-between', 
                           padding: '4px 0',
                           borderBottom: idx < pendingOrderItems.length - 1 ? `1px solid rgba(255,255,255,0.06)` : 'none',
                           fontSize: 12
                         }}>
                           <div>
                             <span>{qty} × {it.name || t('qrMenu.outOfStock')}</span>
                             <div style={{ fontSize: 10, color: T.text2, marginTop: 1 }}>
                               {price.toFixed(0)} {t('qrMenu.currency')} × {qty}
                             </div>
                           </div>
                           <span style={{ fontFamily: T.mono, color: T.gold, fontWeight: 600, alignSelf: 'center' }}>
                             {(price * qty).toFixed(0)} {t('qrMenu.currency')}
                           </span>
                         </div>
                      );
                    })}
                    <div style={{ 
                      marginTop: 8, 
                      paddingTop: 6, 
                      borderTop: `1px solid ${T.goldBorder}`, 
                      fontWeight: 700, 
                      display: 'flex', 
                      justifyContent: 'space-between',
                      color: T.gold
                    }}>
                      <span>{t('qrMenu.total')}</span>
                      <span style={{ fontFamily: T.mono }}>{pendingOrderTotal?.toFixed(0)} {t('qrMenu.currency')}</span>
                    </div>
                  </div>
                ) : (
                  <div style={{ marginTop: 6, fontSize: 11, color: T.text2, fontStyle: 'italic' }}>
                    Chargement des détails de la commande...
                  </div>
                )
              )}
            </div>
          )}

          {/* Validated confirmation */}
          {orderClientValidated && !localOrderData && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: T.green, fontWeight: 500, marginBottom: 8 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: T.green, display: 'inline-block' }} />
              {t('qrMenu.clientValidated')}
            </div>
          )}

          {/* PIN / Account section */}
          {localOrderData && (
            <>
              <div style={{ borderTop: `1px solid ${T.goldBorder}`, marginTop: 8, paddingTop: 10 }}>
                <div style={{ fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: T.gold, fontWeight: 700, marginBottom: 8 }}>
                   {showAccountCreation ? t('qrMenu.createAccount') : t('qrMenu.enterPin')}
                </div>

                {showAccountCreation ? (
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <input
                      type="tel" placeholder={t('qrMenu.phonePlaceholder')} value={phoneInput}
                      onChange={e => setPhoneInput(e.target.value)} maxLength={14}
                      style={{ flex: 1, minWidth: 140, padding: '9px 12px', borderRadius: 10, border: `1px solid ${T.goldBorder}`, background: T.bg2, color: T.text, fontSize: 13, fontFamily: T.mono, outline: 'none' }}
                    />
                    <button onClick={async () => { await associatePhone(phoneInput); setPhoneInput(''); }} style={btnGoldSolid}>Créer compte</button>
                    <button onClick={() => setShowAccountCreation(false)} style={btnLink}>{t('qrMenu.iHavePin')}</button>
                  </div>
                ) : (
                   <>
                     {/* Order summary before PIN entry */}
                     {localOrderData?.items?.length > 0 && (
                       <div style={{ 
                         background: T.bg2, 
                         border: `1px solid ${T.goldBorder}`, 
                         borderRadius: 10, 
                         padding: '10px 12px', 
                         marginBottom: 10,
                         fontSize: 12 
                       }}>
                          <div style={{ fontWeight: 600, color: T.gold, marginBottom: 6 }}>{t('qrMenu.yourOrder')} :</div>
                         {localOrderData.items.map((it: any, idx: number) => (
                           <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                             <span>{it.quantity} × {it.name || `Article #${it.product_id}`}</span>
                           </div>
                         ))}
                         <div style={{ 
                           marginTop: 6, 
                           paddingTop: 6, 
                           borderTop: `1px solid ${T.goldBorder}`, 
                           display: 'flex', 
                           justifyContent: 'space-between',
                           fontWeight: 700,
                           color: T.gold2
                         }}>
                           <span>Total</span>
                           <span>{Number(localOrderData.total || 0).toFixed(0)} ZMW</span>
                         </div>
                       </div>
                     )}

                     <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                       <input
                         type="text" inputMode="numeric" maxLength={6} placeholder="••••••"
                         value={validationPinInput} onChange={e => setValidationPinInput(e.target.value)}
                         onKeyDown={e => { if (e.key === 'Enter') validateOrderWithPin(); }}
                         style={{ width: 110, padding: '9px 12px', borderRadius: 10, border: `1px solid ${T.goldBorder}`, background: T.bg2, color: T.text, fontSize: 16, textAlign: 'center', fontFamily: T.mono, letterSpacing: '0.22em', outline: 'none' }}
                       />
                        <button onClick={validateOrderWithPin} disabled={isValidatingOrder}
                          style={{ ...btnGoldSolid, opacity: isValidatingOrder ? 0.7 : 1, cursor: isValidatingOrder ? 'wait' : 'pointer' }}>
                           {isValidatingOrder ? '…' : t('qrMenu.sendOrder')}
                        </button>

                        <button 
                          onClick={() => {
                            // Client cancels the prepared order before sending
                            setLocalOrderData(null);
                            persistLocalOrder(null);
                            setValidationPinInput('');
                            setPinAttempts(0);
                            setShowAccountCreation(false);
                            showToast('info', t('qrMenu.statusCancelled'));
                          }}
                          style={{ ...btnGhost, padding: '9px 14px', fontSize: 12 }}
                        >
                           {t('qrMenu.cancel')}
                        </button>
                      </div>
                    {pinAttempts >= 3 && (
                      <div style={{ marginTop: 6 }}>
                        <button onClick={() => setShowAccountCreation(true)} style={btnLink}>{t('qrMenu.createAccount')}</button>
                      </div>
                    )}
                  </>
                )}
              </div>
            </>
          )}

           {/* Clear / New order button (shown after served or paid) */}
           {(pendingOrderStatus === 'served' || pendingOrderStatus === 'livrée' || pendingOrderStatus === 'paid') && (
             <button
               onClick={() => {
                 // Clear states
                 setPendingOrderMessage(null); setPendingOrderId(null); setActiveOrderId(null);
                 setPendingOrderStatus(null); setPendingOrderTotal(null); setOrderClientValidated(false);
                 setValidationPinInput(''); setLocalOrderData(null); setShowAccountCreation(false);
                 setOrderNotes(''); persistOrder(null, null, null, null);

                 // Clear localStorage so customer can place a fresh new order
                 if (token) {
                   localStorage.removeItem(`qr_pending_order_${token}`);
                   localStorage.removeItem(`qr_local_order_${token}`);
                   localStorage.removeItem(`qr_customer_${token}`);
                 }
               }}
                style={{ position: 'absolute', top: 48, right: 14, ...btnGhost, padding: '6px 12px', fontSize: 11, zIndex: 10 }}
             >
               {pendingOrderStatus === 'paid' ? t('qrMenu.clear') : t('qrMenu.close')}
             </button>
           )}
        </div>
      )}

      {/* ══ HERO ════════════════════════════════════════════════════════════ */}
      <div style={{ background: T.bg2, position: 'relative', overflow: 'hidden' }}>
        {/* Decorative rings */}
        <svg aria-hidden="true" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0.055, pointerEvents: 'none' }} viewBox="0 0 390 170" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">
          <circle cx="345" cy="15" r="110" fill="none" stroke="#c8a84b" strokeWidth="1"/>
          <circle cx="345" cy="15" r="72"  fill="none" stroke="#c8a84b" strokeWidth=".5"/>
          <circle cx="345" cy="15" r="38"  fill="none" stroke="#c8a84b" strokeWidth=".4"/>
          <circle cx="48"  cy="148" r="62" fill="none" stroke="#c8a84b" strokeWidth=".5"/>
          <line x1="0" y1="85" x2="390" y2="85" stroke="#c8a84b" strokeWidth=".3"/>
          <line x1="195" y1="0" x2="195" y2="170" stroke="#c8a84b" strokeWidth=".25"/>
        </svg>

        <div style={{ position: 'relative', zIndex: 1, padding: '26px 18px 0' }}>
          {/* Top row */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap', marginBottom: 18 }}>
            {/* Brand */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
              <div style={{ width: 42, height: 42, borderRadius: '50%', border: `1.5px solid ${T.gold}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: T.serif, fontSize: 16, fontWeight: 700, color: T.gold, letterSpacing: '0.04em', flexShrink: 0 }}>
                GO
              </div>
              <div>
                 <div style={{ fontFamily: T.serif, fontSize: 20, fontWeight: 700, color: T.text, letterSpacing: '0.06em', lineHeight: 1.1 }}>{APP_NAME}</div>
                <div style={{ fontSize: 9, letterSpacing: '0.22em', textTransform: 'uppercase', color: T.text2, marginTop: 2 }}>Restaurant &amp; Bar</div>
              </div>
            </div>

            {/* Right: table + identity */}
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
              <div style={{ background: T.goldDim, border: `1px solid ${T.goldBorder}`, borderRadius: 20, padding: '7px 12px', textAlign: 'center', flexShrink: 0 }}>
                <div style={{ fontFamily: T.mono, fontSize: 12, fontWeight: 500, color: T.gold, letterSpacing: '0.06em' }}>TABLE {table.table_number}</div>
                <div style={{ fontSize: 9, letterSpacing: '0.16em', textTransform: 'uppercase', color: T.text3, marginTop: 1 }}>Votre table</div>
              </div>

              {!customerPhone ? (
                <button onClick={() => setShowPhoneForm(f => !f)}
                  style={{ background: T.goldDim, border: `1px solid ${T.goldBorder}`, borderRadius: 20, padding: '7px 13px', color: T.gold, fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', cursor: 'pointer', whiteSpace: 'nowrap', fontFamily: T.sans, touchAction: 'manipulation' }}>
                  S'identifier
                </button>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, background: 'rgba(200,168,75,0.07)', border: `1px solid ${T.goldBorder}`, borderRadius: 20, padding: '6px 10px' }}>
                  <span style={{ fontFamily: T.mono, fontSize: 12, color: T.gold }}>•••{customerPhone.slice(-4)}</span>
                  <span style={{ fontSize: 9, color: T.text3 }}>PIN {customerPin}</span>
                  <button onClick={() => { setCustomerPhone(''); setCustomerPin(''); persistCustomer('', ''); }}
                    style={{ background: 'transparent', border: 'none', color: T.text3, fontSize: 16, lineHeight: 1, cursor: 'pointer', padding: '0 2px' }} aria-label={t('qrMenu.changePhone')}>×</button>
                </div>
              )}
            </div>
          </div>

          {/* Phone registration form */}
          {showPhoneForm && !customerPhone && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', background: T.bg3, border: `1px solid ${T.goldBorder}`, borderRadius: 14, padding: '10px 14px', marginBottom: 14 }}>
              <input
                 type="tel" placeholder={t('qrMenu.phonePlaceholder')}
                value={phoneInput} onChange={e => setPhoneInput(e.target.value)} maxLength={14}
                onKeyDown={e => { if (e.key === 'Enter') associatePhone(phoneInput); }}
                style={{ flex: 1, minWidth: 150, background: T.bg2, border: `1px solid rgba(255,255,255,0.08)`, borderRadius: 10, padding: '9px 12px', color: T.text, fontSize: 13, fontFamily: T.mono, outline: 'none' }}
              />
              <button onClick={async () => { await associatePhone(phoneInput); setPhoneInput(''); setShowPhoneForm(false); }} style={btnGoldSolid}>Enregistrer</button>
              <button onClick={() => { setShowPhoneForm(false); setPhoneInput(''); }} style={{ ...btnGhost, padding: '9px 10px', fontSize: 11 }}>Annuler</button>
            </div>
          )}

          {/* Hero title */}
          <div className="qr-hero-title" style={{ fontFamily: T.serif, fontSize: 52, fontWeight: 300, lineHeight: 0.92, letterSpacing: '-0.01em', color: T.text, paddingBottom: 6, marginTop: showPhoneForm ? 0 : 14 }}>
                {t('qrMenu.ourMenu').split(' ')[0]}<br /><span style={{ fontStyle: 'italic', color: T.gold, fontWeight: 600 }}>{t('qrMenu.ourMenu').split(' ')[1] || 'Carte'}</span>
          </div>
          <div style={{ height: 1, marginTop: 18, background: `linear-gradient(90deg, ${T.gold} 0%, transparent 80%)`, opacity: 0.3 }} />
        </div>
      </div>

      {/* ══ CATEGORY NAV ════════════════════════════════════════════════════ */}
      {menu.length > 0 && (
         <div className="qr-cat-nav" style={{ 
           display: 'flex', 
           gap: 7, 
           overflowX: 'auto', 
           padding: '13px 16px', 
           background: T.bg2, 
           borderBottom: `1px solid rgba(255,255,255,0.04)`,
           position: 'sticky',
           top: 0,
           zIndex: 60,
           boxShadow: '0 4px 12px rgba(0,0,0,0.3)'
         }}>
          {menu.map(cat => (
            <button key={cat.id} className="qr-cat-btn"
              onClick={() => scrollToCategory(cat.id)}
              style={{ flexShrink: 0, padding: '7px 15px', borderRadius: 20, fontSize: 11, fontWeight: activecat === cat.id ? 700 : 500, letterSpacing: '0.08em', textTransform: 'uppercase', border: `1px solid ${activecat === cat.id ? T.gold : T.goldBorder}`, color: activecat === cat.id ? T.bg : T.text2, background: activecat === cat.id ? T.gold : 'transparent', cursor: 'pointer', fontFamily: T.sans, whiteSpace: 'nowrap', touchAction: 'manipulation' }}>
               {getCategoryName(cat.name)}
            </button>
          ))}
        </div>
      )}

      {/* ══ MENU BODY ═══════════════════════════════════════════════════════ */}
      <div style={{ padding: '0 14px 160px' }}>
        {menu.length === 0 && (
            <p style={{ color: T.text3, padding: '48px 0', textAlign: 'center', fontSize: 14, letterSpacing: '0.05em' }}>
              {t('qrMenu.noProductsAvailable')}
            </p>
        )}

        {menu.map(category => (
          <div key={category.id} ref={el => { categoryRefs.current[category.id] = el; }} style={{ marginTop: 30 }}>
            {/* Category heading */}
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, marginBottom: 14, paddingBottom: 10, borderBottom: `1px solid rgba(200,168,75,0.18)` }}>
              <div>
                <div style={{ fontFamily: T.serif, fontSize: 30, fontWeight: 600, fontStyle: 'italic', color: T.gold, letterSpacing: '0.02em', lineHeight: 1 }}>{getCategoryName(category.name)}</div>
                <div style={{ fontSize: 9, letterSpacing: '0.18em', textTransform: 'uppercase', color: T.text3, marginTop: 5 }}>
                   {t('qrMenu.itemsCount', { count: category.items.length, plural: category.items.length > 1 ? 's' : '' })}
                </div>
              </div>
              <div style={{ flex: 1, height: 1, background: 'rgba(200,168,75,0.1)', marginBottom: 5 }} />
            </div>

            {/* Items */}
            {category.items.map(item => (
              <div key={item.id} className="qr-item-card"
                style={{ background: T.bg3, border: `1px solid ${T.border}`, borderRadius: 16, padding: 14, marginBottom: 10, opacity: !item.in_stock ? 0.5 : 1 }}>
                {/* Top: image + name/price */}
                <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', marginBottom: 10 }}>
                  {/* Image */}
                  <div className="qr-item-img" style={{ width: 66, height: 66, borderRadius: 12, overflow: 'hidden', flexShrink: 0, border: `1px solid rgba(200,168,75,0.2)`, background: T.bg4, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {item.image_url ? (
                      <img src={item.image_url} alt={item.name} loading="lazy" onError={e => { e.currentTarget.style.display = 'none'; }} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                    ) : (
                      <span style={{ fontSize: 9, letterSpacing: '0.08em', textTransform: 'uppercase', color: T.text3 }}>Photo</span>
                    )}
                  </div>
                  {/* Info */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 600, color: T.text, lineHeight: 1.3, marginBottom: 5 }}>{item.name}</div>
                    <div style={{ fontFamily: T.mono, fontSize: 16, fontWeight: 500, color: T.gold2, letterSpacing: '0.03em' }}>{item.price?.toFixed(0)} {item.currency || 'ZMW'}</div>
                  </div>
                </div>

                {/* Description */}
                {item.description && (
                  <div style={{ fontSize: 12, color: T.text2, lineHeight: 1.55, marginBottom: 10 }}>{item.description}</div>
                )}

                {/* Footer */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                  <span style={{ fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: T.text3, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 5, padding: '2px 8px', whiteSpace: 'nowrap' }}>
                    {item.unit || 'pcs'}
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <button className="qr-add-btn"
                      onClick={() => addToCart(item)} disabled={!item.in_stock}
                      style={{ padding: '8px 14px', borderRadius: 10, border: `1px solid ${item.in_stock ? T.goldBorder : 'rgba(255,255,255,0.08)'}`, background: item.in_stock ? 'rgba(200,168,75,0.09)' : 'rgba(255,255,255,0.02)', color: item.in_stock ? T.gold : T.text3, fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', cursor: item.in_stock ? 'pointer' : 'not-allowed', fontFamily: T.sans, minHeight: 36, touchAction: 'manipulation' }}>
                       + {t('qrMenu.addToCart')}
                    </button>
                    <StockBadge item={item} onAlert={() => alertStock(item, category.name)} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* ══ CART FAB ════════════════════════════════════════════════════════ */}
      {cartItems.length > 0 && (
        <>
          {/* Floating pill */}
          <div onClick={() => setIsCartOpen(true)} style={{ position: 'fixed', bottom: 20, right: 16, zIndex: 65, background: T.bg2, border: `1px solid ${T.goldBorder}`, borderRadius: 999, padding: '9px 14px 9px 10px', display: 'flex', alignItems: 'center', gap: 9, cursor: 'pointer', boxShadow: '0 8px 28px rgba(0,0,0,0.45)', touchAction: 'manipulation' }}>
            <div style={{ width: 26, height: 26, borderRadius: '50%', background: T.gold, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800, color: T.bg }}>{cartQty}</div>
            <div>
              <div style={{ fontSize: 9, color: T.text3, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 1 }}>Panier</div>
              <div style={{ fontFamily: T.mono, fontSize: 14, fontWeight: 600, color: T.gold2, lineHeight: 1 }}>{cartTotal.toFixed(0)} {currency}</div>
            </div>
          </div>

          {/* Cart bottom sheet */}
          {isCartOpen && (
            <div style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'flex-end' }} onClick={() => setIsCartOpen(false)}>
              <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 860, margin: '0 auto', background: T.bg, borderTopLeftRadius: 22, borderTopRightRadius: 22, border: `1px solid ${T.goldBorder}`, maxHeight: '86vh', display: 'flex', flexDirection: 'column', boxShadow: '0 -10px 40px rgba(0,0,0,0.5)' }}>
                {/* Handle */}
                <div style={{ width: 36, height: 4, background: T.text3, borderRadius: 2, margin: '9px auto 4px', opacity: 0.4 }} />

                {/* Header */}
                <div style={{ padding: '8px 18px 14px', borderBottom: `1px solid ${T.goldBorder}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                     <div style={{ fontFamily: T.serif, fontSize: 20, fontWeight: 600, color: T.gold }}>{t('qrMenu.cartTitle')}</div>
                    <div style={{ fontSize: 10, color: T.text3, letterSpacing: '0.10em', marginTop: 2 }}>
                        {t('qrMenu.itemsCount', { count: cartQty, plural: cartQty > 1 ? 's' : '' })} · Table {table.table_number}
                      {activeOrderId ? ` · ${t('qrMenu.orderInProgress')} #${activeOrderId}` : ''}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                     <button onClick={() => { setCart({}); setIsCartOpen(false); }} style={{ background: 'none', border: 'none', color: T.text3, fontSize: 11, cursor: 'pointer', fontFamily: T.sans }}>{t('qrMenu.clear')}</button>
                    <button onClick={() => setIsCartOpen(false)} style={{ width: 32, height: 32, borderRadius: '50%', background: 'rgba(255,255,255,0.06)', border: 'none', color: T.text2, fontSize: 18, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
                  </div>
                </div>

                {/* Items */}
                <div className="qr-scroll" style={{ flex: 1, overflowY: 'auto', padding: '12px 18px 16px' }}>
                  {cartItems.slice().sort((a, b) => a.name.localeCompare(b.name)).map(it => {
                    const original = menu.flatMap(c => c.items).find(i => i.id === it.productId);
                    return (
                      <div key={it.productId} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                        {/* Mini image */}
                        <div style={{ width: 46, height: 46, borderRadius: 9, overflow: 'hidden', background: T.bg3, flexShrink: 0, border: `1px solid ${T.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          {original?.image_url ? (
                            <img src={original.image_url} alt={it.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          ) : (
                            <span style={{ fontSize: 9, color: T.text3, letterSpacing: '0.06em' }}>Photo</span>
                          )}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 600, fontSize: 14, color: T.text, lineHeight: 1.25, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.name}</div>
                          <div style={{ fontSize: 11, color: T.text3, fontFamily: T.mono, marginTop: 2 }}>{it.price.toFixed(0)} {it.currency || 'ZMW'}</div>
                        </div>
                        {/* Stepper */}
                        <div style={{ display: 'flex', alignItems: 'center', background: T.bg2, borderRadius: 999, border: `1px solid ${T.goldBorder}`, overflow: 'hidden', flexShrink: 0 }}>
                          <button className="qr-step-btn" onClick={() => updateQty(it.productId, -1)} style={{ width: 34, height: 34, border: 'none', background: 'transparent', color: T.gold, fontSize: 18, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>−</button>
                          <div style={{ minWidth: 28, textAlign: 'center', fontFamily: T.mono, fontWeight: 600, fontSize: 14, color: T.gold2 }}>{it.quantity}</div>
                          <button className="qr-step-btn" onClick={() => updateQty(it.productId, +1)} style={{ width: 34, height: 34, border: 'none', background: 'transparent', color: T.gold, fontSize: 18, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>+</button>
                        </div>
                        <div style={{ fontFamily: T.mono, fontWeight: 700, fontSize: 13, color: T.gold2, minWidth: 58, textAlign: 'right', flexShrink: 0 }}>{(it.price * it.quantity).toFixed(0)}</div>
                        <button onClick={() => { removeFromCart(it.productId); if (Object.keys(cart).length <= 1) setIsCartOpen(false); }} style={{ background: 'none', border: 'none', color: T.text3, fontSize: 16, cursor: 'pointer', width: 26, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
                      </div>
                    );
                  })}
                </div>

                {/* Notes */}
                <div style={{ padding: '0 18px 12px' }}>
                   <div style={{ fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: T.gold, fontWeight: 700, marginBottom: 6 }}>{t('qrMenu.specialInstructions')}</div>
                  <textarea
                    value={orderNotes} onChange={e => setOrderNotes(e.target.value)}
                           placeholder={t('qrMenu.notesPlaceholder2')} rows={2}
                    style={{ width: '100%', background: T.bg2, border: `1px solid ${T.goldBorder}`, borderRadius: 10, padding: '9px 11px', color: T.text, fontSize: 12, resize: 'none', fontFamily: T.sans, outline: 'none', lineHeight: 1.5 }}
                  />
                </div>

                {/* Footer */}
                <div style={{ padding: '16px 18px 24px', borderTop: `1px solid ${T.goldBorder}`, background: T.bg2 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, color: T.text3, marginBottom: 5, fontFamily: T.mono }}>
                    <span>Sous-total</span><span>{cartTotal.toFixed(0)} {currency}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, color: T.text3, marginBottom: 12, fontFamily: T.mono }}>
                    <span>Frais de service (10%)</span><span>{Math.round(cartTotal * 0.10)} {currency}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 14 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.10em', color: T.text2 }}>{t('qrMenu.total')}</span>
                    <span style={{ fontFamily: T.mono, fontSize: 20, fontWeight: 700, color: T.gold2 }}>{Math.round(cartTotal * 1.10).toFixed(0)} {currency}</span>
                  </div>
                  <button className="qr-checkout-btn" onClick={() => { setIsCartOpen(false); checkout(); }}
                    style={{ width: '100%', padding: '14px', borderRadius: 13, background: T.gold, color: T.bg, border: 'none', fontSize: 13, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', cursor: 'pointer', fontFamily: T.sans }}>
                    {t('qrMenu.checkoutBtn')}
                  </button>
                   <div style={{ textAlign: 'center', marginTop: 8, fontSize: 11, color: T.text3 }}>{t('qrMenu.enterPin')}</div>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* ══ FOOTER ══════════════════════════════════════════════════════════ */}
      <div style={{ textAlign: 'center', padding: '20px 16px 50px', borderTop: `1px solid rgba(255,255,255,0.05)`, marginTop: 8 }}>
        <div style={{ fontSize: 13, letterSpacing: '0.4em', color: T.text3, marginBottom: 7 }}>— ✦ —</div>
        <p style={{ fontSize: 10, letterSpacing: '0.16em', textTransform: 'uppercase', color: T.text3 }}>{t('qrMenu.menuFooter')}</p>
      </div>

      {/* ══ Aesthetic Toast Notifications (QR Customer) ═══════════════════════ */}
      {toast && (
        <div
          style={{
            position: 'fixed',
            bottom: 18,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 99999,
            background: T.bg3,
            border: `1px solid ${toast.type === 'success' ? T.gold : toast.type === 'error' ? T.red : T.goldBorder}`,
            color: T.text,
            padding: '11px 18px 11px 14px',
            borderRadius: 14,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            boxShadow: '0 10px 40px rgba(0,0,0,0.55)',
            maxWidth: '92vw',
            fontSize: 13.5,
            fontWeight: 500,
            letterSpacing: '0.01em',
            backdropFilter: 'blur(12px)',
            animation: 'toast-in 0.2s ease-out',
          }}
        >
          {toast.type === 'success' && <CheckCircle2 size={18} color={T.gold} />}
          {toast.type === 'error' && <XCircle size={18} color={T.red} />}
          {toast.type === 'info' && <Info size={18} color={T.gold2} />}
          <span style={{ lineHeight: 1.3 }}>{toast.message}</span>
        </div>
      )}
    </div>
  );
};

export default PublicMenuPage;