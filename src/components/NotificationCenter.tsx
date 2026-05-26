import React from 'react';
import { useNotificationStore, AppNotification } from '../stores/useNotificationStore';
import { X, Bell } from 'lucide-react';

interface NotificationCenterProps {
  isOpen: boolean;
  onClose: () => void;
}

export const NotificationCenter: React.FC<NotificationCenterProps> = ({ isOpen, onClose }) => {
  const { notifications, unreadCount, markAsRead, markAllAsRead } = useNotificationStore();

  if (!isOpen) return null;

  const sorted = [...notifications].sort((a, b) => 
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  const handleMarkRead = (id: string) => {
    markAsRead(id);
  };

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      right: 0,
      bottom: 0,
      width: 380,
      background: '#111118',
      borderLeft: '1px solid #28283a',
      zIndex: 100000,
      display: 'flex',
      flexDirection: 'column',
      boxShadow: '-8px 0 30px rgba(0,0,0,0.4)'
    }}>
      {/* Header */}
      <div style={{
        padding: '16px 20px',
        borderBottom: '1px solid #28283a',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Bell size={20} />
          <div>
            <div style={{ fontWeight: 700, fontSize: 16 }}>Notifications</div>
            <div style={{ fontSize: 12, color: '#888' }}>{unreadCount} non lues</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {unreadCount > 0 && (
            <button 
              onClick={markAllAsRead}
              style={{ fontSize: 12, color: '#f59e0b', background: 'none', border: 'none', cursor: 'pointer' }}
            >
              Tout marquer lu
            </button>
          )}
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer' }}>
            <X size={20} />
          </button>
        </div>
      </div>

      {/* List */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
        {sorted.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#666' }}>
            Aucune notification
          </div>
        ) : (
          sorted.map((notif: AppNotification) => (
            <div 
              key={notif.id}
              onClick={() => {
                if (!notif.readAt) handleMarkRead(notif.id);
                if (notif.link) {
                  // Simple navigation - in real app use router
                  window.location.href = notif.link;
                }
              }}
              style={{
                padding: '14px 20px',
                borderBottom: '1px solid #1e1e2e',
                cursor: 'pointer',
                background: notif.readAt ? 'transparent' : 'rgba(245, 158, 11, 0.05)',
                opacity: notif.readAt ? 0.7 : 1
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{notif.title}</div>
                <div style={{ fontSize: 10, color: '#666' }}>
                  {new Date(notif.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
              <div style={{ fontSize: 13, color: '#aaa', marginTop: 4 }}>{notif.message}</div>
              {notif.priority === 'high' || notif.priority === 'critical' ? (
                <div style={{ fontSize: 10, color: '#f59e0b', marginTop: 4 }}>Haute priorité</div>
              ) : null}
            </div>
          ))
        )}
      </div>

      {/* Footer */}
      <div style={{ padding: 12, borderTop: '1px solid #28283a', textAlign: 'center', fontSize: 12, color: '#666' }}>
        Les notifications sont conservées localement sur ce poste
      </div>
    </div>
  );
};
