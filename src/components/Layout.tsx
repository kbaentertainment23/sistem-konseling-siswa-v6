import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  LayoutDashboard,
  Users,
  School,
  ClipboardCheck,
  CalendarRange,
  FileWarning,
  Eye,
  PhoneCall,
  CalendarDays,
  FileBarChart2,
  UserCog,
  Settings,
  Search,
  LogOut,
  Menu,
  X,
  ShieldCheck,
} from 'lucide-react';
import { useSibk } from '../context/SibkContext';
import { PWAInstallButton } from './PWAInstallButton';
import type { NavSection, Student } from '../types/sibk';
import { getTodayISO } from '../utils/sibkLogic';
import { computeDashboardAttentionItems } from '../utils/dashboardLogic';
import { computeParentCallAttentionSummary } from '../utils/parentCallLogic';
import { computeCaseAttentionSummary } from '../utils/caseLogic';
import { computeScheduleAttentionSummary } from '../utils/scheduleLogic';
import { useModalDismiss } from '../utils/useModalDismiss';

interface LayoutProps {
  activeSection: NavSection;
  onNavigate: (section: NavSection) => void;
  onSelectStudent: (student: Student) => void;
  children: React.ReactNode;
}

const NAV_ITEMS: Array<{
  id: NavSection;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  adminOnly?: boolean;
  counselorOnly?: boolean;
}> = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'students', label: 'Data Siswa', icon: Users },
  { id: 'classes', label: 'Data Kelas', icon: School },
  { id: 'attendance', label: 'Absensi Harian', icon: ClipboardCheck },
  { id: 'attendance-recap', label: 'Rekap Absensi', icon: CalendarRange },
  { id: 'cases', label: 'Kasus & Konseling', icon: FileWarning },
  { id: 'monitoring', label: 'Pemantauan Siswa', icon: Eye, counselorOnly: true },
  { id: 'parent-calls', label: 'Pemanggilan Orang Tua', icon: PhoneCall, counselorOnly: true },
  { id: 'schedules', label: 'Jadwal BK', icon: CalendarDays },
  { id: 'reports', label: 'Laporan', icon: FileBarChart2 },
  { id: 'users', label: 'Pengguna', icon: UserCog, adminOnly: true },
  { id: 'settings', label: 'Pengaturan', icon: Settings, adminOnly: true },
];

export const Layout: React.FC<LayoutProps> = ({
  activeSection,
  onNavigate,
  onSelectStudent,
  children,
}) => {
  const {
    currentUser,
    logout,
    students,
    attendance,
    cases,
    counselingLogs,
    parentCalls,
    schedules,
    settings,
    isAdmin,
    isCounselor,
    isHomeroom,
    canViewCounseling,
  } = useSibk();

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const mobileDrawerBackdropProps = useModalDismiss({
    open: mobileMenuOpen,
    onClose: () => setMobileMenuOpen(false),
  });
  const [globalQuery, setGlobalQuery] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const mainScrollRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (mainScrollRef.current) {
      mainScrollRef.current.scrollTop = 0;
    }
  }, [activeSection]);

  const dashboardAlertCount = useMemo(
    () =>
      computeDashboardAttentionItems({
        students,
        attendance,
        cases,
        parentCalls,
        settings,
      }).totalCount,
    [students, attendance, cases, parentCalls, settings]
  );

  const urgentSchedulesCount = useMemo(
    () => computeScheduleAttentionSummary(schedules, getTodayISO()).totalUrgentCount,
    [schedules]
  );

  const parentCallAttentionCount = useMemo(
    () =>
      computeParentCallAttentionSummary({
        students,
        attendance,
        cases,
        parentCalls,
        settings,
        todayISO: getTodayISO(),
      }).totalAttentionCount,
    [students, attendance, cases, parentCalls, settings]
  );

  const caseAttentionCount = useMemo(
    () =>
      computeCaseAttentionSummary({
        cases,
        counselingLogs,
        students,
        parentCalls,
        settings,
        todayISO: getTodayISO(),
        canViewCounseling,
      }).totalAttentionCount,
    [cases, counselingLogs, students, parentCalls, settings, canViewCounseling]
  );

  const visibleNavItems = useMemo(() => {
    return NAV_ITEMS.filter((item) => {
      if (item.adminOnly && !isAdmin) return false;
      if (item.counselorOnly && !isCounselor) return false;
      return true;
    });
  }, [isAdmin, isCounselor]);

  const searchResults = useMemo(() => {
    const q = globalQuery.trim().toLowerCase();
    if (!q) return [];
    return students
      .filter(
        (s) =>
          s.fullName.toLowerCase().includes(q) ||
          s.nis.toLowerCase().includes(q) ||
          s.className.toLowerCase().includes(q)
      )
      .slice(0, 6);
  }, [globalQuery, students]);

  const activeNavLabel =
    NAV_ITEMS.find((n) => n.id === activeSection)?.label || 'Dashboard';

  return (
    <div className="h-screen supports-[height:100dvh]:h-dvh overflow-hidden bg-[#F4F7FB] flex print:h-auto print:overflow-visible">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:flex-col h-full w-[280px] bg-[#0F172A] text-slate-200 shrink-0 no-print">
        <div className="h-[72px] px-5 flex items-center gap-3.5 border-b border-slate-800/90">
          {settings.schoolLogoUrl ? (
            <div className="w-10 h-10 rounded-xl bg-white p-1 shadow-xs ring-1 ring-white/20 flex items-center justify-center shrink-0 overflow-hidden">
              <img
                src={settings.schoolLogoUrl}
                alt={`Logo ${settings.schoolName || 'Sekolah'}`}
                className="w-full h-full object-contain"
              />
            </div>
          ) : (
            <div className="w-10 h-10 rounded-xl bg-sky-500/20 border border-sky-400/30 flex items-center justify-center shrink-0">
              <ShieldCheck className="w-5 h-5 text-sky-300" />
            </div>
          )}
          <div className="min-w-0">
            <div className="text-base font-bold text-white tracking-tight truncate">SIBK</div>
            <div className="text-xs text-slate-400 truncate">
              {settings.activeAcademicYear} · {settings.activeSemester}
            </div>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto py-5 px-3 space-y-1" aria-label="Navigasi Utama">
          {visibleNavItems.map((item) => {
            const Icon = item.icon;
            const active = activeSection === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onNavigate(item.id)}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors text-left whitespace-nowrap ${
                  active
                    ? 'bg-sky-500/20 text-white'
                    : 'text-slate-300 hover:bg-slate-800/80 hover:text-white'
                }`}
              >
                <Icon
                  className={`w-[18px] h-[18px] shrink-0 ${
                    active ? 'text-sky-300' : 'text-slate-400'
                  }`}
                />
                <span className="truncate flex-1">{item.label}</span>
                {item.id === 'dashboard' && dashboardAlertCount > 0 && (
                  <span
                    title={`${dashboardAlertCount} notifikasi peringatan aktif`}
                    className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 text-xs font-bold font-mono tabular-nums rounded-full bg-red-600 text-white shrink-0"
                  >
                    {dashboardAlertCount}
                  </span>
                )}
                {item.id === 'cases' && caseAttentionCount > 0 && (
                  <span
                    title={`${caseAttentionCount} kasus atau evaluasi konseling perlu perhatian`}
                    className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 text-xs font-bold font-mono tabular-nums rounded-full bg-amber-500 text-white shrink-0"
                  >
                    {caseAttentionCount}
                  </span>
                )}
                {item.id === 'parent-calls' && parentCallAttentionCount > 0 && (
                  <span
                    title={`${parentCallAttentionCount} pemanggilan orang tua perlu perhatian`}
                    className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 text-xs font-bold font-mono tabular-nums rounded-full bg-red-600 text-white shrink-0"
                  >
                    {parentCallAttentionCount}
                  </span>
                )}
                {item.id === 'schedules' && urgentSchedulesCount > 0 && (
                  <span
                    title={`${urgentSchedulesCount} agenda BK terlewat atau jatuh hari ini`}
                    className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 text-xs font-bold font-mono tabular-nums rounded-full bg-amber-500 text-white shrink-0"
                  >
                    {urgentSchedulesCount}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-800/90 space-y-2.5">
          <div className="px-2">
            <div className="text-sm font-semibold text-white truncate">{currentUser?.name}</div>
            <div className="text-xs text-slate-400 mt-0.5 truncate">
              {isAdmin
                ? 'Administrator · Akses Penuh'
                : isHomeroom
                  ? 'Wali Kelas · Akses Terbatas'
                  : 'Guru BK · Akses Terbatas'}
            </div>
          </div>
          <PWAInstallButton variant="sidebar" />
          <button
            type="button"
            onClick={logout}
            className="w-full flex items-center justify-center gap-2 px-3.5 py-2.5 text-sm font-semibold text-white bg-red-600 hover:bg-red-700 rounded-xl transition-colors"
          >
            <LogOut className="w-4 h-4" />
            Keluar
          </button>
        </div>
      </aside>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex no-print">
          <div
            className="fixed inset-0 bg-slate-900/50"
            {...mobileDrawerBackdropProps}
          />
          <aside className="relative w-72 max-w-[85vw] h-dvh max-h-dvh bg-[#0F172A] text-slate-200 flex flex-col z-10">
            <div className="h-[72px] px-5 flex items-center justify-between border-b border-slate-800">
              <div className="flex items-center gap-2.5 min-w-0">
                {settings.schoolLogoUrl ? (
                  <div className="w-9 h-9 rounded-lg bg-white p-1 flex items-center justify-center shrink-0 overflow-hidden">
                    <img
                      src={settings.schoolLogoUrl}
                      alt={`Logo ${settings.schoolName || 'Sekolah'}`}
                      className="w-full h-full object-contain"
                    />
                  </div>
                ) : (
                  <div className="w-9 h-9 rounded-lg bg-sky-500/20 border border-sky-400/30 flex items-center justify-center shrink-0">
                    <ShieldCheck className="w-4 h-4 text-sky-300" />
                  </div>
                )}
                <span className="text-base font-bold text-white truncate">SIBK</span>
              </div>
              <button
                type="button"
                aria-label="Tutup menu"
                title="Keluar"
                onClick={() => setMobileMenuOpen(false)}
                className="p-1.5 text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-1">
              {visibleNavItems.map((item) => {
                const Icon = item.icon;
                const active = activeSection === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      onNavigate(item.id);
                      setMobileMenuOpen(false);
                    }}
                    className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-colors text-left ${
                      active
                        ? 'bg-sky-500/20 text-white'
                        : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span className="flex-1 truncate">{item.label}</span>
                    {item.id === 'dashboard' && dashboardAlertCount > 0 && (
                      <span
                        title={`${dashboardAlertCount} notifikasi peringatan aktif`}
                        className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 text-xs font-bold font-mono tabular-nums rounded-full bg-red-600 text-white shrink-0"
                      >
                        {dashboardAlertCount}
                      </span>
                    )}
                    {item.id === 'cases' && caseAttentionCount > 0 && (
                      <span
                        title={`${caseAttentionCount} kasus atau evaluasi konseling perlu perhatian`}
                        className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 text-xs font-bold font-mono tabular-nums rounded-full bg-amber-500 text-white shrink-0"
                      >
                        {caseAttentionCount}
                      </span>
                    )}
                    {item.id === 'parent-calls' && parentCallAttentionCount > 0 && (
                      <span
                        title={`${parentCallAttentionCount} pemanggilan orang tua perlu perhatian`}
                        className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 text-xs font-bold font-mono tabular-nums rounded-full bg-red-600 text-white shrink-0"
                      >
                        {parentCallAttentionCount}
                      </span>
                    )}
                    {item.id === 'schedules' && urgentSchedulesCount > 0 && (
                      <span
                        title={`${urgentSchedulesCount} agenda BK terlewat atau jatuh hari ini`}
                        className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 text-xs font-bold font-mono tabular-nums rounded-full bg-amber-500 text-white shrink-0"
                      >
                        {urgentSchedulesCount}
                      </span>
                    )}
                  </button>
                );
              })}
            </nav>
            <div className="p-4 border-t border-slate-800">
              <button
                type="button"
                onClick={logout}
                className="w-full flex items-center justify-center gap-2 px-3 py-2.5 text-sm font-semibold text-white bg-red-600 hover:bg-red-700 rounded-xl transition-colors"
              >
                <LogOut className="w-4 h-4" />
                Keluar
              </button>
            </div>
          </aside>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 h-full print:h-auto">
        {/* Top Bar */}
        <header className="h-[72px] shrink-0 bg-white border-b border-slate-200 px-5 lg:px-8 flex items-center justify-between gap-4 z-30 no-print">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              aria-label="Buka menu navigasi"
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden p-2 -ml-2 text-slate-600 hover:text-slate-900"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="text-base font-semibold text-slate-900 truncate">
              {activeNavLabel}
            </div>
          </div>

          {/* Integrated Global Search */}
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              value={globalQuery}
              onChange={(e) => setGlobalQuery(e.target.value)}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setTimeout(() => setSearchFocused(false), 180)}
              placeholder="Cari siswa berdasarkan nama atau NIS..."
              aria-label="Pencarian terpadu siswa"
              className="w-full pl-10 pr-4 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:bg-white focus:border-sky-600 transition-colors"
            />

            {searchFocused && globalQuery.trim().length > 0 && (
              <div className="absolute left-0 right-0 mt-1.5 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden z-40">
                {searchResults.length === 0 ? (
                  <div className="p-4 text-sm text-slate-500">
                    Tidak ditemukan siswa dengan kata kunci "{globalQuery}".
                  </div>
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {searchResults.map((stu) => (
                      <li key={stu.id}>
                        <button
                          type="button"
                          onMouseDown={() => {
                            onSelectStudent(stu);
                            setGlobalQuery('');
                          }}
                          className="w-full px-4 py-3 text-left hover:bg-slate-50 flex items-center justify-between gap-3"
                        >
                          <div className="min-w-0">
                            <div className="text-sm font-semibold text-slate-900 truncate">
                              {stu.fullName}
                            </div>
                            <div className="text-xs text-slate-500 font-mono tabular-nums mt-0.5">
                              NIS {stu.nis} · Kelas {stu.className}
                            </div>
                          </div>
                          <div className="text-xs font-mono text-slate-600 shrink-0 tabular-nums">
                            {stu.caseCount} kasus
                          </div>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>

          <div className="hidden md:flex items-center gap-3 text-sm text-slate-600 shrink-0">
            <span className="font-medium text-slate-800">{settings.schoolName}</span>
          </div>
        </header>

        <main
          ref={mainScrollRef}
          data-scroll-container="main"
          className="flex-1 overflow-y-auto overscroll-contain print:overflow-visible"
        >
          <div className="p-5 lg:p-8 max-w-[1440px] w-full mx-auto">{children}</div>
        </main>
      </div>
    </div>
  );
};
