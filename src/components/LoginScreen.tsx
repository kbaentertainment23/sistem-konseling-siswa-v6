import React, { useState } from 'react';
import { ShieldCheck, Eye, EyeOff, AlertCircle, Lock, User } from 'lucide-react';
import { useSibk } from '../context/SibkContext';
import { PWAInstallButton } from './PWAInstallButton';

export const LoginScreen: React.FC = () => {
  const { loginWithCredentials, settings } = useSibk();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setSubmitting(true);
    try {
      const result = await loginWithCredentials(username.trim(), password);
      if (!result.ok) {
        setErrorMsg(result.error || 'Username atau password tidak valid.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4 sm:p-6 lg:p-10">
      <div className="w-full max-w-4xl bg-white border border-slate-200 rounded-2xl overflow-hidden grid grid-cols-1 lg:grid-cols-12 shadow-sm">
        {/* Left Brand Panel */}
        <div className="lg:col-span-5 bg-[#0F172A] text-white p-6 sm:p-8 lg:p-10 flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-3.5 mb-8 sm:mb-10">
              {settings.schoolLogoUrl ? (
                <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-xl bg-white p-1.5 shadow-sm ring-1 ring-white/20 flex items-center justify-center shrink-0 overflow-hidden">
                  <img
                    src={settings.schoolLogoUrl}
                    alt={`Logo ${settings.schoolName || 'Sekolah'}`}
                    className="w-full h-full object-contain"
                  />
                </div>
              ) : (
                <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-xl bg-sky-500/20 border border-sky-400/30 flex items-center justify-center shrink-0">
                  <ShieldCheck className="w-6 h-6 sm:w-7 sm:h-7 text-sky-300" />
                </div>
              )}
              <div className="min-w-0">
                <div className="text-lg sm:text-xl font-bold tracking-tight leading-none truncate">
                  SIBK
                </div>
                <div className="text-xs text-slate-300 mt-1 truncate">
                  {settings.schoolName || 'Bimbingan & Konseling'}
                </div>
              </div>
            </div>

            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight leading-snug text-white mb-4">
              Sistem Informasi Bimbingan & Konseling
            </h1>
            <p className="text-sm text-slate-300 leading-relaxed">
              Kelola data siswa, absensi harian, pencatatan kasus otomatis, riwayat konseling,
              pemanggilan orang tua, dan laporan administrasi sekolah dalam satu ruang kerja yang
              rapi dan aman.
            </p>
          </div>

        </div>

        {/* Right Login Form */}
        <div className="lg:col-span-7 p-8 sm:p-12 flex flex-col justify-center">
          <div className="max-w-sm w-full mx-auto">
            <h2 className="text-2xl font-bold text-slate-900 mb-1.5">Selamat Datang</h2>
            <p className="text-sm text-slate-500 mb-7">
              Masuk menggunakan akun Administrator atau Guru BK Anda.
            </p>

            {errorMsg && (
              <div
                role="alert"
                className="mb-5 p-3.5 rounded-xl bg-red-50 border border-red-200 flex items-start gap-2.5 text-sm text-red-700"
              >
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{errorMsg}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label
                  htmlFor="login-username"
                  className="block text-sm font-medium text-slate-700 mb-1.5"
                >
                  Username
                </label>
                <div className="relative">
                  <User className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    id="login-username"
                    type="text"
                    required
                    autoComplete="username"
                    placeholder="Masukkan username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="w-full pl-10 pr-4 py-3 text-sm text-slate-900 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:bg-white focus:border-sky-600 focus:ring-2 focus:ring-sky-600/15 transition-all"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="login-password"
                  className="block text-sm font-medium text-slate-700 mb-1.5"
                >
                  Password
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    id="login-password"
                    type={showPassword ? 'text' : 'password'}
                    required
                    autoComplete="current-password"
                    placeholder="Masukkan password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full pl-10 pr-11 py-3 text-sm text-slate-900 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:bg-white focus:border-sky-600 focus:ring-2 focus:ring-sky-600/15 transition-all"
                  />
                  <button
                    type="button"
                    aria-label={showPassword ? 'Sembunyikan password' : 'Tampilkan password'}
                    onClick={() => setShowPassword((prev) => !prev)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 text-slate-400 hover:text-slate-700"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full py-3 px-4 text-sm font-semibold text-white bg-[#1E3A5F] hover:bg-[#162C49] disabled:opacity-60 rounded-xl transition-colors cursor-pointer"
              >
                {submitting ? 'Memeriksa akun...' : 'Masuk ke Sistem'}
              </button>
            </form>

            <div className="mt-4 flex justify-center">
              <PWAInstallButton variant="compact" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
