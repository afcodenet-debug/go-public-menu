import { Navigate, Route, Routes } from 'react-router-dom';
import { useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useSettingsStore } from './stores/useSettingsStore';
import { useAuthStore } from './stores/useAuthStore';
import { I18nProvider } from './lib/i18n';
import { SettingsSelector } from './components/SettingsSelector';
import Sidebar from './components/Sidebar';
import SettingsPage from './pages/SettingsPage';
import ErrorBoundary from './components/ErrorBoundary';
import { DataLoader } from './components/DataLoader';
import { GlobalStyles } from './lib/design-system';
import LoginPage from './pages/auth/LoginPage';
import Dashboard from './pages/Dashboard';
import TablesPage from './pages/TablesPage';
import POS from './pages/POS';
import OrdersPage from './pages/OrdersPage';
import SalesHistoryPage from './pages/SalesHistoryPage';
import ProductsPage from './features/products/ProductsPage';
import ProductDetailsPage from './features/products/pages/ProductDetailsPage';
import Staff from './pages/staff/StaffPage';
import Reports from './pages/Reports';
import Expenses from './pages/Expenses';
import UsersPage from './pages/users/UsersPage';
import InventoryAnalyticsPage from './features/products/components/InventoryAnalytics';
import CategoriesPage from './pages/CategoriesPage';
import PublicMenuPage from './pages/PublicMenuPage';
import GlobalQrOrderNotifier from './components/GlobalQrOrderNotifier';
import { GlobalNotificationToast } from './components/GlobalNotificationToast';
import { NotificationCenter } from './components/NotificationCenter';
import { useNotificationStore } from './stores/useNotificationStore';

const ProtectedRoute = ({ children, roles }: { children: React.ReactNode, roles?: string[] }) => {
  const { isAuthenticated, user } = useAuthStore();
  
  if (!isAuthenticated) return <Navigate to="/login" />;
  if (roles && user && !roles.includes(user.role)) return <Navigate to="/" />;
  
  return (
    <>
      <DataLoader />
      {children}
    </>
  );
};

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 60_000, retry: 1, refetchOnWindowFocus: false } },
});

function App() {
  const { language, currency } = useSettingsStore();

  useEffect(() => {
    const id = 'global-app-styles';
    if (!document.getElementById(id)) {
      const s = document.createElement('style');
      s.id = id;
      s.textContent = GlobalStyles;
      document.head.appendChild(s);
    }
  }, []);

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <I18nProvider lang={language}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/menu" element={<PublicMenuPage />} />
            <Route
              path="/*"
              element={
                <ProtectedRoute>
                  <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: '#09090f' }}>
                    <Sidebar />
                    <GlobalQrOrderNotifier />
                    <GlobalNotificationToast />
                    <NotificationCenter 
                      isOpen={useNotificationStore.getState().isCenterOpen} 
                      onClose={() => useNotificationStore.getState().closeCenter()} 
                    />
                    {/* SettingsSelector sits in the fixed sidebar column — footer area */}
                    <div style={{
                      position: 'fixed', left: 0, bottom: 0,
                      width: '260px', zIndex: 50,
                      pointerEvents: 'none',      // let clicks pass through empty areas
                    }}>
                      <div style={{ pointerEvents: 'auto' }}>
                        <SettingsSelector />
                      </div>
                    </div>
                    <main style={{ flex: 1, overflowY: 'auto', position: 'relative' }} className="custom-scroll">
                      <Routes>
                        <Route path="/" element={<Dashboard />} />
                        <Route path="/tables" element={<TablesPage />} />
                        <Route path="/staff" element={
                          <ProtectedRoute roles={['admin', 'manager']}>
                            <Staff />
                          </ProtectedRoute>
                        } />
                        <Route path="/pos" element={<POS />} />
                        <Route path="/orders" element={<OrdersPage />} />
                        <Route path="/sales" element={
                           <ProtectedRoute roles={['admin', 'manager', 'cashier']}>
                             <SalesHistoryPage />
                           </ProtectedRoute>
                         } />
                         <Route path="/analytics" element={
                           <ProtectedRoute roles={['admin', 'manager']}>
                             <InventoryAnalyticsPage />
                           </ProtectedRoute>
                         } />
                         <Route path="/categories" element={
                           <ProtectedRoute roles={['admin', 'manager']}>
                             <CategoriesPage />
                           </ProtectedRoute>
                         } />
                        <Route path="/products" element={
                          <ProtectedRoute roles={['admin', 'manager']}>
                            <ProductsPage />
                          </ProtectedRoute>
                        } />
                        <Route path="/products/:id" element={
                          <ProtectedRoute roles={['admin', 'manager']}>
                            <ProductDetailsPage />
                          </ProtectedRoute>
                        } />
<Route path="/reports" element={
                           <ProtectedRoute roles={['admin', 'manager', 'cashier']}>
                             <Reports />
                           </ProtectedRoute>
                         } />
                         <Route path="/expenses" element={
                           <ProtectedRoute roles={['admin', 'manager', 'cashier']}>
                             <Expenses />
                           </ProtectedRoute>
                         } />
                        <Route path="/users" element={
                          <ProtectedRoute roles={['admin']}>
                            <UsersPage />
                          </ProtectedRoute>
                        } />
                        <Route path="/settings" element={
                          <ProtectedRoute roles={['admin']}>
                            <SettingsPage />
                          </ProtectedRoute>
                        } />
                      </Routes>
                    </main>
                  </div>
                </ProtectedRoute>
              }
            />
          </Routes>
        </I18nProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
