import { useState, useEffect } from 'react';
import { useAuthStore } from '../../stores/useAuthStore';
import { api } from '../../lib/api-client';
import { useI18n } from '../../lib/i18n';
import { Table as TableIcon, Check, X, Plus, Trash2 } from 'lucide-react';

interface Waiter {
  id: number;
  full_name: string;
  username: string;
  phone: string;
  role: string;
  is_active: number;
}

interface Table {
  id: number;
  table_number: string;
  status: string;
  assigned_waiter_id: number | null;
}

const StaffPage = () => {
  const { user: currentUser } = useAuthStore();
  const { t } = useI18n();
  const [waiters, setWaiters] = useState<Waiter[]>([]);
  const [allTables, setAllTables] = useState<Table[]>([]);
  const [loading, setLoading] = useState(true);

  const isAdmin = currentUser?.role === 'admin' || currentUser?.role === 'manager';

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [usersRes, tables] = await Promise.all([
        api.users.getAll(currentUser?.role),
        api.tables.getAll(undefined, currentUser?.role)
      ]);

      // Backend returns either raw array or { users: [...] }
      const usersArray = Array.isArray(usersRes) ? usersRes : (usersRes as any)?.users || [];
      const waitersList = usersArray.filter((u: any) => u.role === 'waiter');

      setWaiters(waitersList);
      setAllTables(tables as Table[]);
    } catch (err) {
      console.error('Failed to fetch data', err);
    } finally {
      setLoading(false);
    }
  };

  const getWaiterTables = (waiterId: number) => {
    return allTables.filter(t => t.assigned_waiter_id === waiterId);
  };

  const getAvailableTables = () => {
    return allTables.filter(t => t.assigned_waiter_id === null && t.status === 'available');
  };

  const assignTable = async (tableId: number, waiterId: number) => {
    try {
      await api.tables.update(tableId, { assigned_waiter_id: waiterId }, currentUser?.role);
      // Update local state
      setAllTables(prev => prev.map(t =>
        t.id === tableId ? { ...t, assigned_waiter_id: waiterId } : t
      ));
    } catch (err) {
      alert('Failed to assign table');
    }
  };

  const unassignTable = async (tableId: number) => {
    try {
      await api.tables.update(tableId, { assigned_waiter_id: null }, currentUser?.role);
      setAllTables(prev => prev.map(t =>
        t.id === tableId ? { ...t, assigned_waiter_id: null } : t
      ));
    } catch (err) {
      alert('Failed to unassign table');
    }
  };

  const toggleWaiterStatus = async (waiter: Waiter) => {
    try {
      await api.users.update(waiter.id, { is_active: waiter.is_active ? 0 : 1 }, currentUser?.role);
      setWaiters(prev => prev.map(w =>
        w.id === waiter.id ? { ...w, is_active: w.is_active ? 0 : 1 } : w
      ));
    } catch (err) {
      alert('Failed to update status');
    }
  };

  if (!isAdmin) {
    return (
      <div className="p-8">
        <div className="bg-red-900/20 border border-red-500/30 rounded-2xl p-6 text-center">
          <h2 className="text-xl font-black text-red-500">Access Denied</h2>
          <p className="text-olive-400 mt-2">Only administrators can manage staff assignments.</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return <div className="p-8 text-olive-400">Loading staff data...</div>;
  }

  return (
    <div className="p-8 max-w-7xl mx-auto h-full flex flex-col space-y-8">
      <header className="flex justify-between items-end">
        <div>
           <h1 className="text-4xl font-black text-white tracking-tighter uppercase">{t('staff.management')}</h1>
           <p className="text-olive-500 text-xs font-bold uppercase tracking-widest mt-1">
             {t('staff.assignTables')}
           </p>
        </div>
        <div className="flex gap-4">
          <div className="bg-olive-900/50 border border-olive-800 px-4 py-2 rounded-xl">
            <span className="text-sm font-bold text-olive-300">{waiters.length} Waiters</span>
          </div>
          <div className="bg-olive-900/50 border border-olive-800 px-4 py-2 rounded-xl">
            <span className="text-sm font-bold text-olive-300">{allTables.length} Tables</span>
          </div>
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {waiters.map((waiter) => {
          const assignedTables = getWaiterTables(waiter.id);
          const availableTables = getAvailableTables();

          return (
            <div key={waiter.id} className="bg-olive-900/50 border border-olive-800 rounded-2xl p-6 space-y-4">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center font-black text-lg ${
                    waiter.is_active
                      ? 'bg-green-500/20 text-green-500 border border-green-500/30'
                      : 'bg-red-500/20 text-red-500 border border-red-500/30'
                  }`}>
                    {waiter.full_name.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <h3 className="font-black text-white text-lg">{waiter.full_name}</h3>
                    <p className="text-xs text-olive-400 font-bold uppercase tracking-wider">{waiter.phone}</p>
                    {waiter.username && (
                      <p className="text-[10px] text-olive-500">@{waiter.username}</p>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => toggleWaiterStatus(waiter)}
                  className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${
                    waiter.is_active
                      ? 'bg-green-500/20 text-green-500 hover:bg-green-500/30'
                      : 'bg-red-500/20 text-red-500 hover:bg-red-500/30'
                  }`}
                  title={waiter.is_active ? 'Active' : 'Inactive'}
                >
                  {waiter.is_active ? <Check size={14} /> : <X size={14} />}
                </button>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-olive-400 font-bold uppercase tracking-wider">Assigned Tables</span>
                  <span className="text-gold-500 font-black">{assignedTables.length}</span>
                </div>

                {assignedTables.length > 0 ? (
                  <div className="space-y-2">
                    {assignedTables.map(table => (
                      <div key={table.id} className="flex items-center justify-between bg-olive-800/50 rounded-lg px-3 py-2">
                        <div className="flex items-center gap-2">
                          <TableIcon size={14} className="text-olive-400" />
                          <span className="font-bold text-white">Table {table.table_number}</span>
                        </div>
                        <button
                          onClick={() => unassignTable(table.id)}
                          className="text-red-400 hover:text-red-500 transition-colors"
                          title="Unassign"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-olive-500 italic">No tables assigned</p>
                )}
              </div>

              {isAdmin && (
                <div className="border-t border-olive-800 pt-4">
                  <p className="text-xs font-bold text-gold-600 uppercase tracking-wider mb-2">Assign New Table</p>
                  <div className="flex flex-wrap gap-2">
                    {availableTables
                      .filter(t => t.status === 'available')
                      .slice(0, 5) // Show max 5
                      .map(table => (
                        <button
                          key={table.id}
                          onClick={() => assignTable(table.id, waiter.id)}
                          className="px-3 py-1 bg-olive-800 hover:bg-gold-600/20 border border-olive-700 hover:border-gold-500/50 rounded-lg text-xs font-bold text-olive-300 hover:text-gold-500 transition-all"
                        >
                          T{table.table_number}
                        </button>
                      ))}
                    {availableTables.filter(t => t.status === 'available').length === 0 && (
                      <p className="text-[10px] text-olive-500">No available tables</p>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default StaffPage;