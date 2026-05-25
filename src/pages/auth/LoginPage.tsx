import { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '../../stores/useAuthStore';
import { useNavigate } from 'react-router-dom';
import { useI18n } from '../../lib/i18n';
import { APP_NAME } from '../../lib/app-config';

const LoginPage = () => {
  const [identity, setIdentity]   = useState('');
  const [pin,      setPin]        = useState('');
  const [error,    setError]      = useState('');
  const [shaking,  setShaking]    = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const { login, isServerHealthy, checkServer } = useAuthStore();
  const navigate = useNavigate();
  const { t } = useI18n();

  useEffect(() => {
    checkServer();
    const iv = setInterval(checkServer, 10_000);
    return () => clearInterval(iv);
  }, [checkServer]);

  /* keyboard support */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key >= '0' && e.key <= '9') handleNumberClick(e.key);
      else if (e.key === 'Backspace') setPin(p => p.slice(0, -1));
      else if (e.key === 'Enter') handleSubmit();
      else if (e.key === 'Escape') handleClear();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  });

  const handleNumberClick = useCallback((num: string) => {
    setPin(prev => {
      if (prev.length < 4) { setError(''); return prev + num; }
      return prev;
    });
  }, []);

  const handleClear = useCallback(() => { setPin(''); setError(''); }, []);

  const handleSubmit = useCallback(async () => {
    if (pin.length < 4 || !isServerHealthy || submitting) return;
    setSubmitting(true);
    setError('');
    const success = await login(pin, identity || undefined);
    if (success) {
      navigate('/');
    } else {
      setShaking(true);
      setError('Accès refusé — vérifiez vos identifiants');
      setPin('');
      setTimeout(() => setShaking(false), 450);
    }
    setSubmitting(false);
  }, [pin, identity, isServerHealthy, submitting, login, navigate]);

  /* auto-submit when 4 digits entered */
  useEffect(() => {
    if (pin.length === 4) {
      const t = setTimeout(handleSubmit, 80);
      return () => clearTimeout(t);
    }
  }, [pin]);

  /* ════════════════════════════════════════════════════════════════════ */
  return (
    <div className="lp-root">
      {/* Background layers */}
      <div className="lp-grid" />
      <div className="lp-glow-a" />
      <div className="lp-glow-b" />
      <div className="lp-glow-c" />

      <div className="lp-card">

        {/* ── Brand header ── */}
        <div style={{ textAlign: 'center', marginBottom: 36 }}>
          {/* Security pill */}
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '5px 14px', borderRadius: 100, background: 'rgba(212,175,55,0.06)', border: '1px solid rgba(212,175,55,0.15)', marginBottom: 28 }}>
            {/* shield icon */}
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#d4af37" strokeWidth="2.5">
              <path d="M12 2l8 4v6c0 5-4 9.3-8 10C8 21.3 4 17 4 12V6l8-4z"/>
            </svg>
            <span style={{ fontSize: 9.5, fontWeight: 800, color: 'rgba(212,175,55,0.7)', letterSpacing: '0.22em', textTransform: 'uppercase' }}>
              Portail d'Accès Sécurisé
            </span>
          </div>

          {/* Logo + brand name */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14, marginBottom: 8 }}>
            <div className="lp-logo-mark">
              {/* lightning bolt */}
              <svg width="26" height="26" viewBox="0 0 24 24" fill="white" stroke="none">
                <path d="M13 2L4.5 13.5H11L10 22L19.5 10.5H13L13 2Z"/>
              </svg>
            </div>
            <div style={{ textAlign: 'left' }}>
              <h1 style={{ fontSize: 30, fontWeight: 300, color: '#eeeef5', margin: 0, letterSpacing: '-0.04em', lineHeight: 1, fontFamily: "'DM Sans', sans-serif" }}>
                GREAT <span style={{ fontWeight: 800, color: '#d4af37' }}>OLIVE</span>
              </h1>
              <p style={{ fontSize: 9.5, color: 'rgba(255,255,255,0.22)', margin: '3px 0 0', letterSpacing: '0.3em', textTransform: 'uppercase', fontWeight: 700 }}>
                Enterprise Management
              </p>
            </div>
          </div>
        </div>

        {/* ── Offline alert ── */}
        {!isServerHealthy && (
          <div className="lp-offline">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="1" y1="1" x2="23" y2="23"/><path d="M16.72 11.06A10.94 10.94 0 0119 12.55M5 12.55a10.94 10.94 0 015.17-2.39M10.71 5.05A16 16 0 0122.56 9M1.42 9a15.91 15.91 0 014.7-2.88M8.53 16.11a6 6 0 016.95 0M12 20h.01"/>
            </svg>
            <div>
               <p style={{ fontSize: 13, fontWeight: 700, margin: '0 0 1px' }}>{t('login.serverOffline')}</p>
               <p style={{ fontSize: 11, margin: 0, opacity: 0.7 }}>{t('login.checkConnection')}</p>
            </div>
          </div>
        )}

        {/* ── Glass panel ── */}
        <div className={`lp-panel ${shaking ? 'lp-shake' : ''}`}>

          {/* PIN dots */}
          <div style={{ display: 'flex', justifyContent: 'center', gap: 16, marginBottom: 28 }}>
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className={`pin-dot ${pin.length > i ? 'filled' : 'empty'}`} />
            ))}
          </div>

          {/* Error */}
          <div style={{ minHeight: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: error ? 20 : 0 }}>
            {error && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, color: '#ef4444' }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
                <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.01em' }}>{error}</span>
              </div>
            )}
          </div>

          {/* Identity input */}
          <div style={{ position: 'relative', marginBottom: 24 }}>
            <div style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'rgba(255,255,255,0.2)', pointerEvents: 'none' }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/>
              </svg>
            </div>
            <input
              className="lp-input"
              type="text"
              placeholder="Nom d'utilisateur (optionnel)"
              value={identity}
              onChange={e => setIdentity(e.target.value)}
              autoComplete="username"
              spellCheck={false}
            />
          </div>

          {/* Separator */}
          <div className="lp-sep" />

          {/* Keypad */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
            {[1,2,3,4,5,6,7,8,9].map(num => (
              <button key={num} className="kp" onClick={() => handleNumberClick(num.toString())}>
                {num}
              </button>
            ))}

            {/* Clear */}
            <button className="kp kp-clear" onClick={handleClear}>
              Eff.
            </button>

            {/* 0 */}
            <button className="kp" onClick={() => handleNumberClick('0')}>
              0
            </button>

            {/* Enter */}
            <button
              className="kp kp-enter"
              onClick={handleSubmit}
              disabled={!isServerHealthy || pin.length < 4 || submitting}
            >
              {submitting ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ animation: 'spin 0.7s linear infinite' }}>
                  <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
                </svg>
              ) : (
                <>
                  OK
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" style={{ marginLeft: 4 }}>
                    <path d="M5 12h14M12 5l7 7-7 7"/>
                  </svg>
                </>
              )}
            </button>
          </div>

          {/* Keyboard hint */}
          <p style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.15)', textAlign: 'center', marginTop: 18, letterSpacing: '0.05em' }}>
            Utilisez le clavier numérique · Entrée pour valider
          </p>
        </div>

        {/* ── Status indicators ── */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 20, marginTop: 28 }}>
          {/* server status */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: isServerHealthy ? '#10b981' : '#ef4444', boxShadow: isServerHealthy ? '0 0 6px rgba(16,185,129,0.5)' : 'none', display: 'block', animation: isServerHealthy ? 'live-pulse 2s ease-in-out infinite' : 'none' }} />
            <span style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.25)', fontWeight: 600 }}>
              {isServerHealthy ? 'Serveur en ligne' : 'Hors ligne'}
            </span>
          </div>
          <span style={{ width: 1, height: 12, background: 'rgba(255,255,255,0.07)' }} />
          <span style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.18)', fontWeight: 700, letterSpacing: '0.1em' }}>
            v2.4.0
          </span>
          <span style={{ width: 1, height: 12, background: 'rgba(255,255,255,0.07)' }} />
          <span style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.18)', fontWeight: 600 }}>
            © 2026 {APP_NAME}
          </span>
        </div>

      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes live-pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }
      `}</style>
    </div>
  );
};

export default LoginPage;