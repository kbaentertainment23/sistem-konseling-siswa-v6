import React, { useEffect } from 'react';
import { ArrowRight, FileWarning, MessageSquarePlus, PhoneCall, X } from 'lucide-react';
import type { NavSection } from '../types/sibk';
import type { RealtimeNotification } from '../utils/realtimeNotificationLogic';

interface RealtimeNotificationToastProps {
  notifications: RealtimeNotification[];
  onDismiss: (id: string) => void;
  onNavigate: (section: NavSection) => void;
  durationMs?: number;
}

const ToastItem: React.FC<{
  item: RealtimeNotification;
  onDismiss: (id: string) => void;
  onNavigate: (section: NavSection) => void;
  durationMs: number;
}> = ({ item, onDismiss, onNavigate, durationMs }) => {
  useEffect(() => {
    const timer = window.setTimeout(() => {
      onDismiss(item.id);
    }, durationMs);
    return () => window.clearTimeout(timer);
  }, [item.id, durationMs, onDismiss]);

  const meta =
    item.kind === 'parent-call'
      ? {
          icon: PhoneCall,
          iconWrap: 'bg-indigo-50 text-indigo-700 border-indigo-200',
          border: 'border-indigo-200',
          actionLabel: 'Buka Pemanggilan',
        }
      : item.kind === 'counseling'
        ? {
            icon: MessageSquarePlus,
            iconWrap: 'bg-sky-50 text-sky-700 border-sky-200',
            border: 'border-sky-200',
            actionLabel: 'Buka Konseling',
          }
        : {
            icon: FileWarning,
            iconWrap: 'bg-amber-50 text-amber-700 border-amber-200',
            border: 'border-amber-200',
            actionLabel: 'Buka Kasus',
          };

  const Icon = meta.icon;

  return (
    <div
      role="status"
      aria-live="polite"
      className={`pointer-events-auto bg-white border ${meta.border} rounded-xl shadow-lg p-4 flex items-start gap-3 text-sm transition-all`}
    >
      <div
        className={`w-8 h-8 rounded-lg border flex items-center justify-center shrink-0 ${meta.iconWrap}`}
      >
        <Icon className="w-4 h-4" />
      </div>

      <div className="flex-1 min-w-0 space-y-1">
        <div className="font-bold text-slate-900 leading-snug">{item.title}</div>
        <p className="text-xs sm:text-sm text-slate-600 leading-relaxed break-words">{item.message}</p>
        <div className="pt-0.5">
          <button
            type="button"
            onClick={() => {
              onNavigate(item.targetSection);
              onDismiss(item.id);
            }}
            className="inline-flex items-center gap-1 text-xs sm:text-sm font-semibold text-[#1E3A5F] hover:underline"
          >
            <span>{meta.actionLabel}</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <button
        type="button"
        onClick={() => onDismiss(item.id)}
        aria-label={`Tutup notifikasi ${item.title}`}
        className="p-1 text-slate-400 hover:text-slate-700 rounded shrink-0"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};

export const RealtimeNotificationToast: React.FC<RealtimeNotificationToastProps> = ({
  notifications,
  onDismiss,
  onNavigate,
  durationMs = 7000,
}) => {
  if (notifications.length === 0) return null;

  return (
    <div
      aria-label="Notifikasi pembaruan guru lain"
      className="fixed top-20 right-4 left-4 sm:left-auto sm:w-96 z-[85] space-y-2.5 pointer-events-none no-print"
    >
      {notifications.map((item) => (
        <ToastItem
          key={item.id}
          item={item}
          onDismiss={onDismiss}
          onNavigate={onNavigate}
          durationMs={durationMs}
        />
      ))}
    </div>
  );
};
