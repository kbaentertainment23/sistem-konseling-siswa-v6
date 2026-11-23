import React, { useState } from 'react';
import { Download, Share, WifiOff, X } from 'lucide-react';
import { useOnlineStatus, usePWAInstall } from '../hooks/usePWAInstall';
import { useModalDismiss } from '../utils/useModalDismiss';

interface PWAInstallButtonProps {
  variant?: 'sidebar' | 'compact';
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({ variant = 'sidebar' }) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);
  const iosGuideBackdropProps = useModalDismiss({
    open: showIOSGuide,
    onClose: () => setShowIOSGuide(false),
  });

  if (isInstalled) return null;

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={install}
        className={
          variant === 'sidebar'
            ? 'w-full flex items-center justify-center gap-2 px-3 py-2 text-sm font-semibold text-white bg-sky-600 hover:bg-sky-700 rounded-lg transition-colors'
            : 'inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-semibold text-white bg-[#1E3A5F] hover:bg-[#162C49] rounded-lg transition-colors'
        }
      >
        <Download className="w-4 h-4 shrink-0" />
        <span>Install Aplikasi SIBK</span>
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowIOSGuide(true)}
          className={
            variant === 'sidebar'
              ? 'w-full flex items-center justify-center gap-2 px-3 py-2 text-sm font-semibold text-sky-200 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg transition-colors'
              : 'inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors'
          }
        >
          <Share className="w-4 h-4 shrink-0" />
          <span>Install SIBK (iOS)</span>
        </button>

        {showIOSGuide && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
            role="dialog"
            aria-modal="true"
            {...iosGuideBackdropProps}
          >
            <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl border border-slate-200 text-slate-900">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-base font-bold">Install SIBK di iPhone / iPad</h3>
                <button
                  type="button"
                  onClick={() => setShowIOSGuide(false)}
                  aria-label="Tutup panduan"
                  title="Keluar"
                  className="p-1.5 text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors shrink-0"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <ol className="text-sm text-slate-600 space-y-2 list-decimal list-inside">
                <li>
                  Ketuk tombol <strong>Bagikan (Share)</strong> di bilah bawah Safari.
                </li>
                <li>
                  Gulir ke bawah lalu pilih <strong>Tambah ke Layar Utama (Add to Home Screen)</strong>.
                </li>
                <li>
                  Ketuk <strong>Tambah (Add)</strong> untuk memasang aplikasi <strong>SIBK</strong>.
                </li>
              </ol>
              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="mt-4 w-full rounded-lg bg-[#1E3A5F] hover:bg-[#162C49] py-2.5 text-sm font-semibold text-white transition-colors"
              >
                Mengerti
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
};

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();
  if (isOnline) return null;

  return (
    <div className="fixed bottom-4 left-4 z-50 flex items-center gap-2 rounded-lg bg-amber-600 px-3.5 py-2 text-xs font-medium text-white shadow-lg">
      <WifiOff className="w-3.5 h-3.5 shrink-0" />
      <span>Mode Offline — Menampilkan data tersimpan</span>
    </div>
  );
};
