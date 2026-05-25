import React, { useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { FloorTablesSidebar } from '../features/pos/components/FloorTablesSidebar';
import { ProductsGrid } from '../features/pos/components/ProductsGrid';
import { OrderSummary } from '../features/pos/components/OrderSummary';
import { usePOSStore } from '../stores/usePOSStore';
import { useTableStore } from '../stores/useTableStore';
import { useProductStore } from '../features/products/hooks/useProductStore';
import { StatusToast } from '../components/StatusToast';

type POSCheckoutResult = {
  success: boolean;
  receipt?: any;
  error?: string;
  partial?: boolean;
  blockedItems?: Array<{ name: string; quantity: number }>;
};
// import { useAuthStore } from '../stores/useAuthStore';
import { useI18n } from '../lib/i18n';
import { useSettingsStore } from '../stores/useSettingsStore';
import { printReceipt } from '../utils/receiptPrinter';
import { EnterpriseTokens } from '../lib/design-system';

const { colors, typography } = EnterpriseTokens;

 const POS: React.FC = () => {
   const { t, lang } = useI18n();
   const { currency } = useSettingsStore();
   const {
     selectedTableId,
     saveOrder,
     checkout,
     cart,
     error: posError,
     setError,
     selectTable,
     loadOrderForTable,
     clearCart,
   } = usePOSStore();

  const navigate = useNavigate();

  const { error: tableError } = useTableStore();
   const [partialWarning, setPartialWarning] = React.useState<string | null>(null);
  const [partialBlocks, setPartialBlocks] = React.useState<Array<{ name: string; quantity: number }>>([]);

  // Auto-select table + specific order (when coming from "Encaisser" on a served QR order)
  // This guarantees the cart is filled with the exact items (normalized for remote orders).
  const [searchParams] = useSearchParams();
  useEffect(() => {
    const tableIdParam = searchParams.get('tableId');
    const orderIdParam = searchParams.get('orderId');
    if (tableIdParam) {
      const tableId = Number(tableIdParam);
      const orderId = orderIdParam ? Number(orderIdParam) : undefined;
      if (!Number.isNaN(tableId) && tableId > 0) {
        if (selectedTableId !== tableId) {
          selectTable(tableId);
        }
        // If we have an explicit orderId (from cashout link), load it directly for perfect item population
        if (orderId && !Number.isNaN(orderId)) {
          loadOrderForTable(tableId, orderId);
        }
      }
    }
  }, [searchParams, selectTable, selectedTableId]);

  const handleSaveOrder = async () => {
    await saveOrder();
  };

   const handleCheckout = async (paymentMethod: string) => {
      console.log('[POS] Checkout initiated with method:', paymentMethod);
      setPartialWarning(null);
      setPartialBlocks([]);

      const result = await checkout(paymentMethod) as POSCheckoutResult;
      console.log('[POS] Checkout result:', result);

      if (result.success) {
        if (result.partial && Array.isArray(result.blockedItems) && result.blockedItems.length > 0) {
          setPartialBlocks(result.blockedItems.map((item: any) => ({ name: item.name, quantity: Number(item.quantity || 0) })));

          const subtitle = result.blockedItems.length === 1
            ? t('pos.partialCheckoutSubtitleSingle', { product: result.blockedItems[0].name })
            : t('pos.partialCheckoutSubtitleMultiple', { count: result.blockedItems.length });

          setPartialWarning(subtitle);
        }

        if (result.receipt) {
          console.log('[POS] Attempting to print receipt...');
          const printResult = await printReceipt(result.receipt, currency, lang);
          console.log('[POS] Print result:', printResult);
          if (!printResult.success) {
            console.warn(t('pos.printFailed'), printResult.error);
          }
        } else {
          console.warn('[POS] No receipt data to print');
        }

        // Post-print behavior ONLY when we arrived via the specific cashout link from Orders page
        // (?tableId=...&orderId=...). Normal POS usage stays on the POS after checkout.
        const hadCashoutLink = searchParams.get('tableId') && searchParams.get('orderId');
        if (hadCashoutLink) {
          clearCart();
          navigate('/orders');
        }
      } else {
        setError(result.error || t('pos.invalidPayment'));
      }
    };

  const { products } = useProductStore();

  const clearErrors = () => {
    setError(null);
    setPartialWarning(null);
    setPartialBlocks([]);
    useTableStore.setState({ error: null });
  };

  const renderErrorToast = () => {
    const raw = String(posError || tableError || '').trim();
    if (!raw) return null;

    const normalize = (value: string) => {
      const trimmed = value.trim();
      if (!trimmed) return '';
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed?.error) return String(parsed.error);
        if (parsed?.message) return String(parsed.message);
      } catch {
        // ignore parse errors
      }
      const jsonMatch = trimmed.match(/\{.*\}/s);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]);
          if (parsed?.error) return String(parsed.error);
          if (parsed?.message) return String(parsed.message);
        } catch {
          // ignore
        }
      }
      return trimmed;
    };

    const message = normalize(raw);
    const isStockIssue = /insufficient stock/i.test(message);
    const itemMatch = message.match(/Insufficient stock for\s+(.+)/i);
    const subject = itemMatch?.[1]?.trim() ?? null;
    const trimmedSubject = subject?.toLowerCase() ?? '';

    const matchedCartItem = cart.find((item) => {
      const name = item.name.toLowerCase();
      return trimmedSubject && (name.includes(trimmedSubject) || trimmedSubject.includes(name));
    });

    const details = cart.map((item) => {
      const product = products.find((productItem) => productItem.id === item.productId);
      const stock = product?.stock_quantity ?? null;
      const badge = stock !== null ? `${stock} restantes` : undefined;
      const highlight = matchedCartItem?.productId === item.productId;
      return {
        label: item.name,
        value: `${item.quantity} dans le panier`,
        badge,
        highlight,
      };
    });

    const title = isStockIssue ? t('pos.stockIssueTitle') : t('pos.paymentErrorTitle');
    const subtitle = isStockIssue
      ? subject
        ? t('pos.stockIssueSubtitleSingle', { product: subject })
        : t('pos.stockIssueSubtitleMultiple')
      : t('pos.paymentErrorSubtitle');

    const footer = isStockIssue
      ? t('pos.stockIssueFooter')
      : t('pos.paymentErrorFooter');

    return (
      <StatusToast
        title={title}
        subtitle={subtitle}
        message={message}
        variant={isStockIssue ? 'warning' : 'error'}
        meta={t('pos.actionRequired')}
        details={details}
        footer={footer}
        onClose={clearErrors}
      />
    );
  };

  const renderPartialToast = () => {
    if (!partialWarning || partialBlocks.length === 0) return null;

    const details = partialBlocks.map((item) => ({
      label: item.name,
      value: `${item.quantity} remaining`,
      highlight: true,
    }));

    const actionButton = (
      <button
        type="button"
        onClick={clearErrors}
        style={{
          border: '1px solid rgba(255,255,255,0.12)',
          background: 'transparent',
          color: colors.text1,
          padding: '10px 14px',
          borderRadius: '10px',
          cursor: 'pointer',
          fontSize: '13px',
          fontWeight: 700,
          transition: 'background 0.2s ease'
        }}
        onMouseOver={(e) => {
          (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.06)';
        }}
        onMouseOut={(e) => {
          (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
        }}
      >
        {t('pos.partialCheckoutAction')}
      </button>
    );

    return (
      <StatusToast
        title={t('pos.partialCheckoutTitle')}
        subtitle={partialWarning}
        message={t('pos.partialCheckoutMessage')}
        variant="warning"
        meta={t('pos.partialCheckoutMeta')}
        details={details}
        footer={t('pos.partialCheckoutFooter')}
        actions={actionButton}
        onClose={clearErrors}
      />
    );
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100vh',
        overflow: 'hidden',
        background: colors.bg,
        fontFamily: typography.sans,
      }}
      className="animate-fade"
    >
      {/* ── Floor Navigation Bar ── */}
      <div style={{ flexShrink: 0, width: '100%' }}>
        <FloorTablesSidebar
          onTableSelect={() => {}}
          selectedTableId={selectedTableId}
          layout="horizontal"
        />
      </div>

      {/* ── Main POS Workspace ── */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'row',
          overflow: 'hidden',
        }}
      >
        <div style={{ flex: 1, minWidth: 0, minHeight: 0, overflow: 'hidden' }}>
          <ProductsGrid onProductClick={() => {}} />
        </div>

        <div style={{ flexShrink: 0, width: '360px', minHeight: 0, overflow: 'hidden', position: 'relative' }}>
          <OrderSummary
            onCheckout={handleCheckout}
            onSaveOrder={handleSaveOrder}
          />
        </div>
      </div>

      {/* ── Expert Error Toast ── */}
      {renderPartialToast()}
      {renderErrorToast()}
    </div>
  );
};

export default POS;