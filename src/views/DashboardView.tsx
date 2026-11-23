import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  Calendar,
  CalendarCheck2,
  CheckCircle2,
  ClipboardCheck,
  FileWarning,
  PhoneCall,
  Plus,
  UserCheck,
  Users,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { SafeChartContainer } from '../components/SafeChartContainer';
import { useSibk } from '../context/SibkContext';
import type { NavSection, Student } from '../types/sibk';
import { formatDateShort, getTodayISO } from '../utils/sibkLogic';
import {
  buildMonthlyAttendanceChart,
  buildMonthlyCasesChart,
  buildTopCaseCategories,
  buildTopStudentsByCases,
  computeDashboardAttentionItems,
  computeDashboardKpiMetrics,
  getUpcomingDashboardSchedules,
} from '../utils/dashboardLogic';

interface DashboardViewProps {
  onNavigate: (section: NavSection) => void;
  onSelectStudent: (student: Student) => void;
}

const DONUT_COLORS = ['#1E3A5F', '#0284C7', '#0EA5E9', '#D97706', '#DC2626', '#64748B'];

function getScheduleBadgeMeta(urgency: 'overdue' | 'today' | 'tomorrow' | 'upcoming') {
  switch (urgency) {
    case 'overdue':
      return {
        label: 'Terlewat',
        className: 'bg-red-50 text-red-700 border-red-200',
      };
    case 'today':
      return {
        label: 'Hari Ini',
        className: 'bg-amber-50 text-amber-800 border-amber-200',
      };
    case 'tomorrow':
      return {
        label: 'Besok',
        className: 'bg-sky-50 text-sky-800 border-sky-200',
      };
    default:
      return {
        label: 'Mendatang',
        className: 'bg-slate-100 text-slate-700 border-slate-200',
      };
  }
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  onNavigate,
  onSelectStudent,
}) => {
  const {
    currentUser,
    students,
    classes,
    attendance,
    cases,
    counselingLogs,
    parentCalls,
    schedules,
    settings,
    isCounselor,
    canViewCounseling,
  } = useSibk();

  const [monthlyTab, setMonthlyTab] = useState<'cases' | 'attendance'>('cases');
  const [focusTab, setFocusTab] = useState<'categories' | 'students'>('categories');

  const todayISO = getTodayISO();

  const kpis = useMemo(
    () =>
      computeDashboardKpiMetrics({
        students,
        classes,
        attendance,
        cases,
        counselingLogs,
        parentCalls,
        schedules,
        settings,
        todayISO,
        canViewCounseling,
      }),
    [
      students,
      classes,
      attendance,
      cases,
      counselingLogs,
      parentCalls,
      schedules,
      settings,
      todayISO,
      canViewCounseling,
    ]
  );

  const attention = useMemo(
    () =>
      computeDashboardAttentionItems({
        students,
        attendance,
        cases,
        parentCalls,
        settings,
      }),
    [students, attendance, cases, parentCalls, settings]
  );

  const upcomingSchedules = useMemo(
    () => getUpcomingDashboardSchedules(schedules, todayISO, 5),
    [schedules, todayISO]
  );

  const monthlyCasesData = useMemo(() => buildMonthlyCasesChart(cases), [cases]);
  const monthlyAttendanceData = useMemo(
    () => buildMonthlyAttendanceChart(attendance),
    [attendance]
  );
  const categorySlices = useMemo(() => buildTopCaseCategories(cases, 6), [cases]);
  const topStudents = useMemo(
    () => buildTopStudentsByCases(cases, students, 5),
    [cases, students]
  );

  const urgentTotal = kpis.pendingParentCallCount + kpis.urgentScheduleCount;

  return (
    <div className="space-y-6">
      {/* Row 1: Greeting Header & Quick Daily Actions */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900">
            Selamat datang, {currentUser?.name || 'Guru BK'}
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            {settings.schoolName} · Tahun Ajaran {settings.activeAcademicYear} · Semester{' '}
            {settings.activeSemester}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onNavigate('cases')}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-semibold text-white bg-[#1E3A5F] hover:bg-[#162C49] rounded-lg transition-colors whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            Catat Kasus
          </button>
          <button
            type="button"
            onClick={() => onNavigate('attendance')}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap"
          >
            <ClipboardCheck className="w-4 h-4 text-sky-700" />
            Absensi Harian
          </button>
          <button
            type="button"
            onClick={() => onNavigate('schedules')}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap"
          >
            <CalendarCheck2 className="w-4 h-4 text-amber-600" />
            Jadwal BK
          </button>
        </div>
      </div>

      {/* Row 2: 4 Clickable Executive KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <button
          type="button"
          onClick={() => onNavigate('students')}
          className="text-left bg-white border border-slate-200 hover:border-sky-300 hover:shadow-xs rounded-xl p-4 transition-all group"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-medium text-slate-500">Siswa Aktif</div>
              <div className="text-2xl sm:text-3xl font-bold text-slate-900 font-mono tabular-nums mt-1.5">
                {kpis.totalStudents}
              </div>
            </div>
            <div className="w-9 h-9 rounded-lg bg-sky-50 border border-sky-100 flex items-center justify-center shrink-0">
              <Users className="w-4 h-4 text-[#1E3A5F]" />
            </div>
          </div>
          <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
            <span>Tersebar di {kpis.activeClassesCount} kelas aktif</span>
            <ArrowRight className="w-3.5 h-3.5 text-slate-400 group-hover:text-[#1E3A5F] transition-colors" />
          </div>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('attendance-recap')}
          className="text-left bg-white border border-slate-200 hover:border-sky-300 hover:shadow-xs rounded-xl p-4 transition-all group"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-medium text-slate-500">
                Ketidakhadiran ({kpis.refDate ? formatDateShort(kpis.refDate) : 'Terbaru'})
              </div>
              <div className="text-2xl sm:text-3xl font-bold text-slate-900 font-mono tabular-nums mt-1.5">
                {kpis.absentCount}
              </div>
            </div>
            <div className="w-9 h-9 rounded-lg bg-amber-50 border border-amber-100 flex items-center justify-center shrink-0">
              <UserCheck className="w-4 h-4 text-amber-700" />
            </div>
          </div>
          <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500 font-mono tabular-nums">
            <span>
              Sakit {kpis.sakit} · Izin {kpis.izin} · Alpa {kpis.alpa}
            </span>
            <ArrowRight className="w-3.5 h-3.5 text-slate-400 group-hover:text-[#1E3A5F] transition-colors" />
          </div>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('cases')}
          className="text-left bg-white border border-slate-200 hover:border-sky-300 hover:shadow-xs rounded-xl p-4 transition-all group"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-medium text-slate-500">Kasus Aktif</div>
              <div className="text-2xl sm:text-3xl font-bold text-slate-900 font-mono tabular-nums mt-1.5">
                {kpis.activeCasesCount}
              </div>
            </div>
            <div className="w-9 h-9 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center shrink-0">
              <FileWarning className="w-4 h-4 text-[#1E3A5F]" />
            </div>
          </div>
          <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500 font-mono tabular-nums">
            <span>
              Bulan ini {kpis.casesThisMonth} · Perhatian {kpis.caseAttentionCount}
            </span>
            <ArrowRight className="w-3.5 h-3.5 text-slate-400 group-hover:text-[#1E3A5F] transition-colors" />
          </div>
        </button>

        <button
          type="button"
          onClick={() =>
            onNavigate(
              isCounselor && kpis.pendingParentCallCount > 0 ? 'parent-calls' : 'schedules'
            )
          }
          className="text-left bg-white border border-slate-200 hover:border-sky-300 hover:shadow-xs rounded-xl p-4 transition-all group"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-medium text-slate-500">
                Panggilan &amp; Agenda Mendesak
              </div>
              <div
                className={`text-2xl sm:text-3xl font-bold font-mono tabular-nums mt-1.5 ${
                  urgentTotal > 0 ? 'text-red-700' : 'text-slate-900'
                }`}
              >
                {urgentTotal}
              </div>
            </div>
            <div
              className={`w-9 h-9 rounded-lg border flex items-center justify-center shrink-0 ${
                urgentTotal > 0
                  ? 'bg-red-50 border-red-100 text-red-700'
                  : 'bg-emerald-50 border-emerald-100 text-emerald-700'
              }`}
            >
              <PhoneCall className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500 font-mono tabular-nums">
            <span>
              Ortu {kpis.pendingParentCallCount} · Jadwal {kpis.urgentScheduleCount}
            </span>
            <ArrowRight className="w-3.5 h-3.5 text-slate-400 group-hover:text-[#1E3A5F] transition-colors" />
          </div>
        </button>
      </div>

      {/* Row 3: Today's Action Hub (2 Balanced Columns, max 5 items each) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Immediate Attention Queue */}
        <section
          aria-label="Perlu Perhatian Segera"
          className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col"
        >
          <div className="flex items-center justify-between gap-2 pb-3 border-b border-slate-100">
            <div className="flex items-center gap-2 min-w-0">
              <AlertCircle
                className={`w-4 h-4 shrink-0 ${
                  attention.totalCount > 0 ? 'text-amber-600' : 'text-emerald-600'
                }`}
              />
              <h2 className="text-base font-bold text-slate-900 truncate">
                Perlu Perhatian Segera
              </h2>
              {attention.totalCount > 0 && (
                <span className="px-2 py-0.5 text-xs font-bold font-mono tabular-nums rounded-full bg-amber-50 text-amber-800 border border-amber-200">
                  {attention.totalCount}
                </span>
              )}
            </div>
            {attention.totalCount > 5 && (
              <button
                type="button"
                onClick={() => onNavigate(isCounselor ? 'parent-calls' : 'cases')}
                className="text-sm font-semibold text-[#1E3A5F] hover:text-sky-700 inline-flex items-center gap-1 whitespace-nowrap"
              >
                Lihat Semua ({attention.totalCount})
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="flex-1 divide-y divide-slate-100">
            {attention.items.length === 0 ? (
              <div className="py-10 text-center space-y-2">
                <CheckCircle2 className="w-7 h-7 text-emerald-600 mx-auto" />
                <div className="text-sm font-medium text-slate-700">
                  Semua siswa terpantau aman
                </div>
                <p className="text-xs text-slate-500">
                  Tidak ada siswa yang melewati batas kasus atau ketidakhadiran saat ini.
                </p>
              </div>
            ) : (
              attention.items.slice(0, 5).map((item) => (
                <div
                  key={item.student.id}
                  className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-sm"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span
                        className={`px-2 py-0.5 text-xs font-semibold rounded border ${
                          item.priority === 'high'
                            ? 'bg-red-50 text-red-700 border-red-200'
                            : 'bg-amber-50 text-amber-800 border-amber-200'
                        }`}
                      >
                        {item.priority === 'high' ? 'Prioritas' : 'Tindak Lanjut'}
                      </span>
                      <span className="font-bold text-slate-900 truncate">
                        {item.student.fullName}
                      </span>
                      <span className="text-xs font-mono text-slate-500">
                        Kelas {item.student.className}
                      </span>
                    </div>
                    <div className="text-xs text-slate-600 line-clamp-1">
                      {item.reasons.join(' · ')}
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => onSelectStudent(item.student)}
                      className="px-2.5 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md whitespace-nowrap"
                    >
                      Profil
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        onNavigate(
                          !isCounselor && item.targetSection === 'parent-calls'
                            ? 'cases'
                            : item.targetSection
                        )
                      }
                      className={`px-2.5 py-1.5 text-xs font-semibold rounded-md whitespace-nowrap ${
                        isCounselor && item.targetSection === 'parent-calls'
                          ? 'text-red-700 bg-red-50 hover:bg-red-100 border border-red-200'
                          : 'text-[#1E3A5F] bg-sky-50 hover:bg-sky-100 border border-sky-200'
                      }`}
                    >
                      {!isCounselor && item.targetSection === 'parent-calls'
                        ? 'Tangani Kasus'
                        : item.actionLabel}
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        {/* Right: Upcoming BK Schedules */}
        <section
          aria-label="Agenda BK Hari Ini dan Terdekat"
          className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col"
        >
          <div className="flex items-center justify-between gap-2 pb-3 border-b border-slate-100">
            <div className="flex items-center gap-2 min-w-0">
              <Calendar className="w-4 h-4 text-[#1E3A5F] shrink-0" />
              <h2 className="text-base font-bold text-slate-900 truncate">
                Agenda BK Hari Ini &amp; Terdekat
              </h2>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('schedules')}
              className="text-sm font-semibold text-[#1E3A5F] hover:text-sky-700 inline-flex items-center gap-1 whitespace-nowrap"
            >
              Semua Jadwal
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="flex-1 divide-y divide-slate-100">
            {upcomingSchedules.length === 0 ? (
              <div className="py-10 text-center space-y-2">
                <CalendarCheck2 className="w-7 h-7 text-slate-400 mx-auto" />
                <div className="text-sm font-medium text-slate-600">
                  Tidak ada agenda mendesak
                </div>
                <p className="text-xs text-slate-400">
                  Jadwal konseling atau pemanggilan orang tua terbaru akan tampil di sini.
                </p>
              </div>
            ) : (
              upcomingSchedules.map(({ schedule: sch, urgency }) => {
                const badge = getScheduleBadgeMeta(urgency);
                return (
                  <div
                    key={sch.id}
                    className="py-3 flex items-start justify-between gap-3 text-sm"
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span
                          className={`px-2 py-0.5 text-xs font-semibold rounded border ${badge.className}`}
                        >
                          {badge.label}
                        </span>
                        <span className="font-semibold text-slate-900 truncate">
                          {sch.title}
                        </span>
                      </div>
                      <div className="text-xs text-slate-500 truncate">
                        {sch.type}
                        {sch.studentName ? ` · Siswa: ${sch.studentName}` : ''}
                      </div>
                    </div>
                    <div className="font-mono text-xs text-slate-600 whitespace-nowrap shrink-0 tabular-nums pt-0.5">
                      {formatDateShort(sch.date)} {sch.time || ''}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>
      </div>

      {/* Row 4: 2 Focused Analytical Panels with Clean Switcher Tabs */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left Analytics Panel: Statistik Bulanan */}
        <section
          aria-label="Statistik Bulanan"
          className="bg-white border border-slate-200 rounded-xl p-5 min-w-0"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 mb-4">
            <div>
              <h2 className="text-base font-bold text-slate-900">Statistik Bulanan</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                {monthlyTab === 'cases'
                  ? 'Perbandingan jumlah kasus masuk dan kasus selesai per bulan'
                  : 'Rekap bulanan ketidakhadiran siswa (Sakit, Izin, Alpa)'}
              </p>
            </div>
            <div
              className="inline-flex items-center p-0.5 bg-slate-100 rounded-lg self-start sm:self-auto"
              role="tablist"
              aria-label="Pilih statistik bulanan"
            >
              <button
                type="button"
                role="tab"
                aria-selected={monthlyTab === 'cases'}
                onClick={() => setMonthlyTab('cases')}
                className={`px-3 py-1.5 text-xs sm:text-sm font-medium rounded-md transition-colors whitespace-nowrap ${
                  monthlyTab === 'cases'
                    ? 'bg-white text-[#1E3A5F] font-semibold shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Kasus BK
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={monthlyTab === 'attendance'}
                onClick={() => setMonthlyTab('attendance')}
                className={`px-3 py-1.5 text-xs sm:text-sm font-medium rounded-md transition-colors whitespace-nowrap ${
                  monthlyTab === 'attendance'
                    ? 'bg-white text-[#1E3A5F] font-semibold shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Ketidakhadiran
              </button>
            </div>
          </div>

          <div className="h-64 min-w-0">
            {monthlyTab === 'cases' ? (
              monthlyCasesData.length === 0 ? (
                <div className="h-full flex items-center justify-center text-sm text-slate-400">
                  Belum ada data kasus BK untuk ditampilkan.
                </div>
              ) : (
                <SafeChartContainer height={256}>
                  <BarChart data={monthlyCasesData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                    <XAxis dataKey="month" tick={{ fontSize: 12, fill: '#64748B' }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: '#64748B' }} />
                    <Tooltip />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar
                      dataKey="jumlah"
                      name="Total Kasus"
                      fill="#1E3A5F"
                      maxBarSize={44}
                      radius={[4, 4, 0, 0]}
                    />
                    <Bar
                      dataKey="selesai"
                      name="Selesai"
                      fill="#0EA5E9"
                      maxBarSize={44}
                      radius={[4, 4, 0, 0]}
                    />
                  </BarChart>
                </SafeChartContainer>
              )
            ) : monthlyAttendanceData.length === 0 ? (
              <div className="h-full flex items-center justify-center text-sm text-slate-400">
                Belum ada data ketidakhadiran bulanan.
              </div>
            ) : (
              <SafeChartContainer height={256}>
                <BarChart data={monthlyAttendanceData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                  <XAxis dataKey="month" tick={{ fontSize: 12, fill: '#64748B' }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: '#64748B' }} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="Sakit" fill="#0284C7" maxBarSize={36} radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Izin" fill="#D97706" maxBarSize={36} radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Alpa" fill="#DC2626" maxBarSize={36} radius={[4, 4, 0, 0]} />
                </BarChart>
              </SafeChartContainer>
            )}
          </div>
        </section>

        {/* Right Analytics Panel: Fokus Permasalahan */}
        <section
          aria-label="Fokus Permasalahan"
          className="bg-white border border-slate-200 rounded-xl p-5 min-w-0"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 mb-4">
            <div>
              <h2 className="text-base font-bold text-slate-900">Fokus Permasalahan</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                {focusTab === 'categories'
                  ? 'Proporsi jenis permasalahan siswa yang paling sering muncul'
                  : '5 siswa dengan jumlah catatan kasus terbanyak (klik untuk lihat profil)'}
              </p>
            </div>
            <div
              className="inline-flex items-center p-0.5 bg-slate-100 rounded-lg self-start sm:self-auto"
              role="tablist"
              aria-label="Pilih fokus permasalahan"
            >
              <button
                type="button"
                role="tab"
                aria-selected={focusTab === 'categories'}
                onClick={() => setFocusTab('categories')}
                className={`px-3 py-1.5 text-xs sm:text-sm font-medium rounded-md transition-colors whitespace-nowrap ${
                  focusTab === 'categories'
                    ? 'bg-white text-[#1E3A5F] font-semibold shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Kategori Kasus
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={focusTab === 'students'}
                onClick={() => setFocusTab('students')}
                className={`px-3 py-1.5 text-xs sm:text-sm font-medium rounded-md transition-colors whitespace-nowrap ${
                  focusTab === 'students'
                    ? 'bg-white text-[#1E3A5F] font-semibold shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Siswa Terbanyak
              </button>
            </div>
          </div>

          {focusTab === 'categories' ? (
            categorySlices.length === 0 ? (
              <div className="h-64 flex items-center justify-center text-sm text-slate-400">
                Belum ada data kategori kasus.
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-12 items-center gap-4 min-h-64">
                <div className="sm:col-span-6 h-56 min-w-0">
                  <SafeChartContainer height={224}>
                    <PieChart>
                      <Pie
                        data={categorySlices}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        innerRadius={52}
                        outerRadius={80}
                        paddingAngle={2}
                      >
                        {categorySlices.map((_, index) => (
                          <Cell
                            key={index}
                            fill={DONUT_COLORS[index % DONUT_COLORS.length]}
                          />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </SafeChartContainer>
                </div>
                <div className="sm:col-span-6 space-y-2.5">
                  {categorySlices.map((slice, idx) => (
                    <div
                      key={slice.name}
                      className="flex items-center justify-between gap-2 text-sm"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className="w-2.5 h-2.5 rounded-full shrink-0"
                          style={{
                            backgroundColor: DONUT_COLORS[idx % DONUT_COLORS.length],
                          }}
                        />
                        <span className="text-slate-700 font-medium truncate">
                          {slice.name}
                        </span>
                      </div>
                      <span className="font-mono tabular-nums text-slate-900 font-semibold shrink-0">
                        {slice.value}{' '}
                        <span className="text-slate-400 font-normal text-xs">({slice.percent}%)</span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )
          ) : topStudents.length === 0 ? (
            <div className="h-64 flex items-center justify-center text-sm text-slate-400">
              Belum ada riwayat kasus siswa.
            </div>
          ) : (
            <div className="space-y-3 py-1">
              {topStudents.map((item, idx) => (
                <button
                  key={item.studentId}
                  type="button"
                  onClick={() => item.student && onSelectStudent(item.student)}
                  disabled={!item.student}
                  className="w-full text-left p-2.5 rounded-lg border border-slate-100 hover:border-sky-200 hover:bg-slate-50/70 transition-colors space-y-1.5"
                >
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="w-5 h-5 rounded-md bg-slate-100 text-slate-700 font-mono font-bold text-xs flex items-center justify-center shrink-0">
                        {idx + 1}
                      </span>
                      <span className="font-semibold text-slate-900 truncate">
                        {item.studentName}
                      </span>
                      <span className="text-xs font-mono text-slate-500 shrink-0">
                        {item.className}
                      </span>
                    </div>
                    <span className="font-mono tabular-nums font-bold text-[#1E3A5F] shrink-0 text-xs sm:text-sm">
                      {item.jumlah} kasus
                      {item.openCount > 0 ? (
                        <span className="text-amber-700 font-normal ml-1">
                          ({item.openCount} aktif)
                        </span>
                      ) : null}
                    </span>
                  </div>
                  <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-[#1E3A5F] rounded-full transition-all"
                      style={{ width: `${Math.max(item.percentOfMax, 8)}%` }}
                    />
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
};
