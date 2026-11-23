import React, { useEffect } from 'react';
import { AlertCircle, X } from 'lucide-react';

interface ErrorToastProps {
  message: string;
  onClose: () => void;
  durationMs?: number;
}

export const ErrorToast: React.FC<ErrorToastProps> = ({
  message,
  onClose,
  durationMs = 6500,
}) => {
  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(onClose, durationMs);
    return () => window.clearTimeout(timer);
  }, [message, durationMs, onClose]);

  if (!message) return null;

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="fixed bottom-4 right-4 left-4 sm:left-auto sm:max-w-md z-[90] flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900 shadow-lg"
    >
      <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
      <div className="flex-1 leading-relaxed font-medium">{message}</div>
      <button
        type="button"
        onClick={onClose}
        aria-label="Tutup notifikasi error"
        className="p-0.5 text-red-500 hover:text-red-800 rounded"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};
