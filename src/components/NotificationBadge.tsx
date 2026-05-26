import React from 'react';
import { useNotificationStore } from '../stores/useNotificationStore';

interface NotificationBadgeProps {
  className?: string;
  onClick?: () => void;
  count?: number; // optional override (e.g. for merged pending QR + unread)
  color?: string; // optional background color (for Orders item to be orange)
}

export const NotificationBadge: React.FC<NotificationBadgeProps> = ({ className = '', onClick, count, color }) => {
  const { unreadCount } = useNotificationStore();
  const displayCount = count !== undefined ? count : unreadCount;

  if (displayCount === 0) return null;

  const bgColor = color || '#ef4444';
  const textColor = color ? '#0f0f0f' : 'white'; // dark text on orange, white on red

  return (
    <div
      onClick={onClick}
      className={`notification-badge ${className}`}
      style={{
        background: bgColor,
        color: textColor,
        fontSize: '10px',
        fontWeight: 700,
        padding: '1px 6px',
        borderRadius: '999px',
        minWidth: '18px',
        textAlign: 'center',
        lineHeight: '16px',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: onClick ? 'pointer' : 'default',
      }}
    >
      {displayCount > 99 ? '99+' : displayCount}
    </div>
  );
};
