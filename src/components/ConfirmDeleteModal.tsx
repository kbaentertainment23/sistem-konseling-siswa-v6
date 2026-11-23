import React, { useState } from 'react';
import { AlertTriangle, Trash2, X } from 'lucide-react';
import { useModalDismiss } from '../utils/useModalDismiss';

interface ConfirmDeleteModalProps {
  open: boolean;
  title?: string;
  itemName?: string;
  description?: string;
  confirmLabel?: string;
  onConfirm: () => Promise<void> | void;
  onCancel: () => void;
}

export const ConfirmDeleteModal: React.FC<ConfirmDeleteModalProps> = ({
  open,
  title = 'Konfirmasi Penghapusan',
  itemName,
  description = 'Data yang sudah dihapus tidak dapat dikembalikan. Apakah Anda yakin ingin melanjutkan?',
  confirmLabel = 'Ya, Hapus',
  onConfirm,
  onCancel,
}) => {
  const [loading, setLoading] = useState(false);
  const backdropProps = useModalDismiss({
    open,
    onClose: onCancel,
    disabled: loading,
  });

  if (!open) return null;

  const handleConfirm = async () => {
    setLoading(true);
    try {
      await onConfirm();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/55 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      {...backdropProps}
    >
      <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-md overflow-hidden shadow-xl">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-red-50 text-red-600 flex items-center justify-center shrink-0">
              <AlertTriangle className="w-4 h-4" />
            </div>
            <h3 className="text-base font-bold text-slate-900">{title}</h3>
          </div>
          <button
            type="button"
            disabled={loading}
            aria-label="Tutup konfirmasi"
            title="Keluar"
            onClick={onCancel}
            className="p-1.5 text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors disabled:opacity-50 shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-2.5 text-sm text-slate-600">
          {itemName && (
            <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 font-semibold">
              {itemName}
            </div>
          )}
          <p className="leading-relaxed">{description}</p>
        </div>

        <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-100 flex items-center justify-end gap-2">
          <button
            type="button"
            disabled={loading}
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-100 rounded-lg disabled:opacity-50"
          >
            Batal
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={handleConfirm}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-red-600 hover:bg-red-700 rounded-lg disabled:opacity-50"
          >
            <Trash2 className="w-4 h-4" />
            {loading ? 'Menghapus...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
