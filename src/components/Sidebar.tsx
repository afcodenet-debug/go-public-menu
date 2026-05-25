import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/useAuthStore';
import { useI18n } from '../lib/i18n';
import { EnterpriseTokens } from '../lib/design-system';
import { APP_NAME } from '../lib/app-config';
import {
  LayoutDashboard,
  UtensilsCrossed,
  Table as TableIcon,
  History,
  Package,
  Users,
  BarChart3,
  Settings,
  LogOut,
  Wallet,
  DollarSign,
  ChevronRight,
  ShieldCheck,
  Zap,
  LineChart,
  Tag,
} from 'lucide-react';
import { SettingsSelector } from './SettingsSelector';

const MENU = [
  { path: '/',         labelKey: 'sidebar.dashboard',    icon: LayoutDashboard, roles: ['admin', 'manager', 'cashier'] },
  { path: '/pos',      labelKey: 'sidebar.pos',          icon: UtensilsCrossed,  roles: ['admin', 'manager', 'cashier', 'waiter'] },
  { path: '/orders',   labelKey: 'sidebar.ordersLive',    icon: Wallet,           roles: ['admin', 'manager', 'cashier', 'waiter'] },
  { path: '/tables',   labelKey: 'sidebar.floorPlan',     icon: TableIcon,        roles: ['admin', 'manager', 'cashier', 'waiter'] },
  { path: '/sales',    labelKey: 'sidebar.salesHistory',  icon: History,          roles: ['admin', 'manager', 'cashier'] },
  { path: '/products', labelKey: 'sidebar.stock',         icon: Package,          roles: ['admin', 'manager'] },
  { path: '/categories', labelKey: 'sidebar.categories',  icon: Tag,              roles: ['admin', 'manager'] },
  { path: '/analytics',labelKey: 'sidebar.analytics',     icon: LineChart,        roles: ['admin', 'manager'] },
  { path: '/staff',    labelKey: 'sidebar.team',          icon: Users,            roles: ['admin', 'manager'] },
  { path: '/reports',  labelKey: 'sidebar.reports',       icon: BarChart3,        roles: ['admin', 'manager', 'cashier'] },
  { path: '/expenses', labelKey: 'sidebar.expenses',      icon: DollarSign,       roles: ['admin', 'manager', 'cashier'] },
  { path: '/users',    labelKey: 'sidebar.systemAccess',  icon: Settings,         roles: ['admin'] },
  { path: '/settings', labelKey: 'sidebar.settings',      icon: Settings,         roles: ['admin'] },
];

const SECTIONS = [
  { tKey: 'sidebar.operations', paths: ['/', '/pos', '/orders', '/tables'] },
  { tKey: 'sidebar.inventory',  paths: ['/sales', '/products', '/categories', '/analytics'] },
  { tKey: 'sidebar.pilotage',   paths: ['/staff', '/reports', '/expenses', '/users', '/settings'] },
];

const Sidebar = () => {
  const { user, logout } = useAuthStore();
  const { t } = useI18n();
  const location = useLocation();
  const navigate = useNavigate();
  const { colors, typography, radius } = EnterpriseTokens;

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const filteredMenu = MENU.filter(item => user && item.roles.includes(user.role));

  const grouped = SECTIONS.map(section => ({
    label: t(section.tKey),
    items: filteredMenu.filter(item => section.paths.includes(item.path)),
  })).filter(g => g.items.length > 0);

  return (
    <aside style={{
      width: '260px',
      minWidth: '260px',
      background: colors.surface,
      borderRight: `1px solid ${colors.border}`,
      display: 'flex',
      flexDirection: 'column',
      height: '100vh',
      zIndex: 100,
      position: 'relative'
    }}>
      {/* ── Brand Identity ── */}
      <div style={{
        padding: '32px 24px 28px',
        display: 'flex',
        alignItems: 'center',
        gap: '14px',
      }}>
        <div style={{
          width: '42px', height: '42px',
          background: `linear-gradient(135deg, ${colors.accent.gold}, #92400e)`,
          borderRadius: '12px',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 8px 20px rgba(212,175,55,0.15)',
          position: 'relative',
          overflow: 'hidden'
        }}>
          <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(rgba(255,255,255,0.2), transparent)', opacity: 0.5 }} />
          <Zap size={20} color="#fff" fill="#fff" />
        </div>
        <div>
          <div style={{ fontSize: '15px', fontWeight: 800, color: colors.text1, letterSpacing: '-0.02em', lineHeight: 1.2 }}>
            {APP_NAME}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: colors.accent.green, boxShadow: `0 0 6px ${colors.accent.green}` }} />
            <span style={{ fontSize: '10px', color: colors.text3, letterSpacing: '0.08em', fontWeight: 800, textTransform: 'uppercase' }}>
              {t('sidebar.enterpriseCloud')}
            </span>
          </div>
        </div>
      </div>

      {/* ── Navigation ── */}
      <nav style={{ flex: 1, overflowY: 'auto', padding: '10px 16px' }} className="custom-scroll">
        {grouped.map((group) => (
          <div key={group.label} style={{ marginBottom: '28px' }}>
            <div style={{
              fontSize: '10px', fontWeight: 800,
              color: colors.text3, letterSpacing: '0.12em',
              textTransform: 'uppercase',
              paddingLeft: '12px', marginBottom: '12px',
              display: 'flex', alignItems: 'center', gap: '8px'
            }}>
              <div style={{ width: '12px', height: '1px', background: colors.border }} />
              {group.label}
            </div>

            {group.items.map(item => {
              const Icon = item.icon;
              const isActive = location.pathname === item.path;

              return (
                <Link
                  key={item.path}
                  to={item.path}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '11px 12px',
                    borderRadius: radius.md,
                    marginBottom: '4px',
                    textDecoration: 'none',
                    background: isActive ? colors.accent.goldDim : 'transparent',
                    border: `1px solid ${isActive ? 'rgba(212,175,55,0.2)' : 'transparent'}`,
                    transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)'
                  }}
                  className="sidebar-link"
                  onMouseOver={(e) => { if (!isActive) e.currentTarget.style.background = 'rgba(255,255,255,0.02)'; }}
                  onMouseOut={(e) => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <Icon
                      size={18}
                      color={isActive ? colors.accent.gold : colors.text3}
                      strokeWidth={isActive ? 2.5 : 2}
                      style={{ transition: 'all 0.2s' }}
                    />
                    <span style={{
                      fontSize: '13px',
                      fontWeight: isActive ? 700 : 500,
                      color: isActive ? colors.text1 : colors.text2,
                      transition: 'all 0.2s',
                    }}>
                      {t(item.labelKey)}
                    </span>
                  </div>
                  {isActive && <ChevronRight size={14} color={colors.accent.gold} />}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      {/* ── Footer / User ── */}
      <div style={{
        padding: '10px 16px 24px',
        borderTop: `1px solid ${colors.border}`,
        background: 'rgba(0,0,0,0.1)',
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
      }}>
        {/* Settings / Language & Currency selector — always last before logout */}
        <SettingsSelector />

        {/* User context card */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          padding: '14px',
          background: colors.card,
          border: `1px solid ${colors.borderHi}`,
          borderRadius: radius.lg,
          boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
        }}>
          <div style={{
            width: '38px', height: '38px',
            borderRadius: '10px',
            background: colors.accent.blueDim,
            border: `1px solid ${colors.accent.blue}33`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}>
            <ShieldCheck size={20} color={colors.accent.blue} />
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{
              fontSize: '13px', fontWeight: 700, color: colors.text1,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              lineHeight: 1.2
            }}>
              {user?.full_name}
            </div>
            <div style={{
              fontSize: '10px', fontWeight: 800,
              color: colors.accent.gold, letterSpacing: '0.05em',
              textTransform: 'uppercase', marginTop: '3px',
            }}>
               {user?.role}
            </div>
          </div>
        </div>

        {/* Logout Action */}
        <button
          onClick={handleLogout}
          style={{
            width: '100%',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
            padding: '12px',
            background: 'transparent',
            border: `1px solid ${colors.accent.red}22`,
            borderRadius: radius.md,
            color: colors.text3,
            fontSize: '11px', fontWeight: 800, letterSpacing: '0.06em',
            textTransform: 'uppercase',
            cursor: 'pointer', fontFamily: typography.sans,
            transition: 'all 0.2s',
          }}
          onMouseEnter={e => {
            e.currentTarget.style.background = colors.accent.redDim;
            e.currentTarget.style.borderColor = `${colors.accent.red}66`;
            e.currentTarget.style.color = colors.accent.red;
          }}
          onMouseLeave={e => {
            e.currentTarget.style.background = 'transparent';
            e.currentTarget.style.borderColor = `${colors.accent.red}22`;
            e.currentTarget.style.color = colors.text3;
          }}
        >
          <LogOut size={14} />
          {t('sidebar.quitSession')}
        </button>
      </div>

      <style>{`
        .sidebar-link:active { transform: scale(0.98); }
        .custom-scroll::-webkit-scrollbar { width: 0px; }
      `}</style>
    </aside>
  );
};

export default Sidebar;
