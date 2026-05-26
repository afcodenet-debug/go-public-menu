import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useOrderStore } from '../stores/useOrderStore';
import { useSettingsStore } from '../stores/useSettingsStore';

/**
 * GlobalQrOrderNotifier
 *
 * Mounted once at App root level.
 * - Watches centralised pendingQrCount from useOrderStore
 * - Shows a highly visible global toast for new QR pending orders
 * - Optional subtle "ding" sound (Web Audio API)
 * - Works from ANY page (Dashboard, POS, Tables, Reports, etc.)
 */
const GlobalQrOrderNotifier = () => {
  const { pendingQrCount } = useOrderStore();
  const { language } = useSettingsStore();
  const navigate = useNavigate();

  const [toast, setToast] = useState<{ newCount: number; total: number } | null>(null);
  const prevCountRef = useRef(pendingQrCount);
  const dismissTimeout = useRef<NodeJS.Timeout | null>(null);

  // Subtle "ding" using Web Audio (no asset needed)
  const playDing = () => {
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const oscillator = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      const filter = audioCtx.createBiquadFilter();

      oscillator.type = 'sine';
      oscillator.frequency.value = 880; // A5 - pleasant high ding

      filter.type = 'lowpass';
      filter.frequency.value = 1200;

      gain.gain.value = 0.08; // very quiet

      const t = audioCtx.currentTime;
      gain.gain.setValueAtTime(0.08, t);
      gain.gain.linearRampToValueAtTime(0.0001, t + 0.6);

      const merger = audioCtx.createGain();

      oscillator.connect(filter);
      filter.connect(gain);
      gain.connect(merger);
      merger.connect(audioCtx.destination);

      oscillator.start(t);
      oscillator.stop(t + 0.65);
    } catch {
      // Silent fail
    }
  };

  const dismissToast = () => {
    if (dismissTimeout.current) clearTimeout(dismissTimeout.current);
    setToast(null);
  };

  const handleToastClick = () => {
    dismissToast();
    navigate('/orders');
  };

  useEffect(() => {
    const prev = prevCountRef.current;
    const current = pendingQrCount;

    if (current > prev) {
      const newOnes = current - prev;

      playDing();
      setToast({ newCount: newOnes, total: current });

      // Auto-dismiss after 7s
      if (dismissTimeout.current) clearTimeout(dismissTimeout.current);
      dismissTimeout.current = setTimeout(() => {
        setToast(null);
      }, 7000);
    }

    prevCountRef.current = current;
  }, [pendingQrCount]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (dismissTimeout.current) clearTimeout(dismissTimeout.current);
    };
  }, []);

  // Inject animation styles once
  useEffect(() => {
    const styleId = 'qr-global-toast-style';
    if (!document.getElementById(styleId)) {
      const s = document.createElement('style');
      s.id = styleId;
      s.textContent = `
        @keyframes qr-toast-in {
          from { opacity:0; transform: translateY(-12px) scale(0.96); }
          to   { opacity:1; transform: translateY(0) scale(1); }
        }
      `;
      document.head.appendChild(s);
    }
  }, []);

  if (!toast) return null;

  const isFr = language === 'fr';
  const title = isFr ? 'Nouvelle commande QR' : 'New QR Order';
  const subtitle = isFr
    ? `${toast.newCount} nouvelle${toast.newCount > 1 ? 's' : ''} — ${toast.total} en attente`
    : `${toast.newCount} new — ${toast.total} pending`;

  return (
    <div
      onClick={handleToastClick}
      style={{
        position: 'fixed',
        top: 24,
        right: 24,
        zIndex: 99999,
        background: '#1f1f2e',
        border: '1px solid #f59e0b',
        borderRadius: 12,
        padding: 14,
        color: '#f1e9d2',
        fontFamily: "'DM Sans', system-ui, sans-serif",
        boxShadow: '0 10px 30px rgba(0,0,0,0.4)',
        minWidth: 320,
        maxWidth: 380,
        animation: 'qr-toast-in 220ms cubic-bezier(0.23, 1, 0.32, 1)',
        cursor: 'pointer',
      }}
      title="Cliquer pour aller sur la page Commandes"
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div style={{
          width: 28, height: 28, borderRadius: 8,
          background: '#f59e0b22', color: '#f59e0b', flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15
        }}>
          📣
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 14.5, letterSpacing: '-0.01em', color: '#f1e9d2' }}>
            {title}
          </div>
          <div style={{ fontSize: 12.5, color: '#b8b0a0', marginTop: 2 }}>
            {subtitle}
          </div>
          <div style={{ marginTop: 6, fontSize: 11, color: '#f59e0b', fontWeight: 600 }}>
            {isFr ? 'Cliquer pour valider →' : 'Click to review →'}
          </div>
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); dismissToast(); }}
          style={{
            background: 'none', border: 'none', color: '#888', fontSize: 18,
            lineHeight: 1, cursor: 'pointer', padding: '0 4px', marginTop: -4
          }}
          aria-label="Close"
        >
          ×
        </button>
      </div>
    </div>
  );
};

export default GlobalQrOrderNotifier;
