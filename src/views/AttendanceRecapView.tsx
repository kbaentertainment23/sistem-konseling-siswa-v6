import React, { useMemo, useState } from 'react';
import { Download, FileText, Printer, School } from 'lucide-react';
import { useSibk } from '../context/SibkContext';
import type { AttendanceStatus } from '../types/sibk';
import { formatDateLong, formatDateShort, getTodayISO } from '../utils/sibkLogic';
import {
  buildSchoolKopTextLines,
  buildTablePdfSummaryText,
  extractCityPrefixFromAddress,
  resolveSignatureCounselorName,
} from '../utils/exportFormatLogic';
import { exportTableToPDF, exportToExcel } from '../utils/exportUtils';

const RECAP_COLUMNS = ['No', 'Tanggal', 'NIS', 'Nama Siswa', 'Kelas', 'Status', 'Keterangan', 'Pencatat'];

export const AttendanceRecapView: React.FC = () => {
  const { attendance, classes, settings, currentUser } = useSibk();
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [classFilter, setClassFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'absent' | AttendanceStatus>('absent');

  const filtered = useMemo(() => {
    return attendance
      .filter((a) => {
        if (startDate && a.date < startDate) return false;
        if (endDate && a.date > endDate) return false;
        if (classFilter !== 'all' && a.classId !== classFilter) return false;
        if (statusFilter === 'absent') return a.status !== 'Hadir';
        if (statusFilter !== 'all' && a.status !== statusFilter) return false;
        return true;
      })
      .sort((a, b) => b.date.localeCompare(a.date) || a.className.localeCompare(b.className));
  }, [attendance, startDate, endDate, classFilter, statusFilter]);

  const frequentAbsentees = useMemo(() => {
    const map = new Map<
      string,
      { name: string; nis: string; className: string; sakit: number; izin: number; alpa: number; total: number }
    >();
    attendance.forEach((a) => {
      if (a.status === 'Hadir' || a.status === 'Dispensasi') return;
      const curr = map.get(a.studentId) || {
        name: a.studentName,
        nis: a.nis,
        className: a.className,
        sakit: 0,
        izin: 0,
        alpa: 0,
        total: 0,
      };
      if (a.status === 'Sakit') curr.sakit++;
      if (a.status === 'Izin') curr.izin++;
      if (a.status === 'Alpa') curr.alpa++;
      curr.total++;
      map.set(a.studentId, curr);
    });
    return Array.from(map.values())
      .sort((a, b) => b.alpa - a.alpa || b.total - a.total)
      .slice(0, 6);
  }, [attendance]);

  const activeScopeSubtitle = useMemo(() => {
    const clsLabel =
      classFilter === 'all'
        ? 'Semua Kelas'
        : `Kelas ${classes.find((c) => c.id === classFilter)?.name || ''}`;
    const statusLabel =
      statusFilter === 'absent'
        ? 'Tidak Hadir (Sakit/Izin/Alpa)'
        : statusFilter === 'all'
        ? 'Semua Status'
        : statusFilter;
    const dateRange =
      startDate || endDate
        ? `Periode ${startDate ? formatDateShort(startDate) : '...'} s/d ${
            endDate ? formatDateShort(endDate) : '...'
          }`
        : 'Semua Periode';
    return `${clsLabel} · ${statusLabel} · ${dateRange} · ${filtered.length} catatan`;
  }, [classFilter, classes, statusFilter, startDate, endDate, filtered.length]);

  const kop = useMemo(() => buildSchoolKopTextLines(settings), [settings]);
  const todayISO = getTodayISO();
  const formattedToday = formatDateLong(todayISO);
  const cityPrefix = extractCityPrefixFromAddress(settings.schoolAddress);
  const signatureDateLine = cityPrefix ? `${cityPrefix}, ${formattedToday}` : formattedToday;
  const counselorSignatureName = resolveSignatureCounselorName(currentUser?.name);

  const tableRows = useMemo(
    () =>
      filtered.map((a, idx) => [
        idx + 1,
        formatDateShort(a.date),
        a.nis,
        a.studentName,
        a.className,
        a.status,
        a.note || '-',
        a.recordedBy || '-',
      ]),
    [filtered]
  );

  const summaryText = useMemo(
    () => buildTablePdfSummaryText(RECAP_COLUMNS, tableRows),
    [tableRows]
  );

  const handleExportExcel = () => {
    const rows = filtered.map((a, idx) => ({
      No: idx + 1,
      Tanggal: formatDateShort(a.date),
      NIS: a.nis,
      'Nama Siswa': a.studentName,
      Kelas: a.className,
      Status: a.status,
      Keterangan: a.note || '-',
      Pencatat: a.recordedBy || '-',
    }));
    exportToExcel(rows, `Rekap_Absensi_${settings.activeAcademicYear.replace('/', '-')}`, 'Absensi', {
      title: 'Rekapitulasi Absensi Seluruh Kelas',
      subtitle: activeScopeSubtitle,
      settings,
      counselorName: currentUser?.name,
      columns: RECAP_COLUMNS,
    });
  };

  const handleExportPDF = () => {
    exportTableToPDF(
      'Rekapitulasi Absensi Seluruh Kelas',
      activeScopeSubtitle,
      RECAP_COLUMNS,
      tableRows,
      settings,
      `Rekap_Absensi_${settings.activeAcademicYear.replace('/', '-')}`,
      { counselorName: currentUser?.name }
    );
  };

  const handlePrint = () => {
    window.print();
  };

  const addressDisplay =
    kop.line4 && kop.line4 !== '-'
      ? kop.line4
      : 'Jl. Alamat Lengkap Sekolah No. 1, Kab./Kota — Atur di Menu Pengaturan, Telp. (000) 000-0000';

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 no-print">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900">Rekap Absensi Seluruh Kelas</h1>
          <p className="text-sm text-slate-600 mt-1">
            Otomatis mengumpulkan data kehadiran dari seluruh kelas · {filtered.length} catatan
            ditampilkan
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
          <button
            type="button"
            onClick={handlePrint}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg whitespace-nowrap"
          >
            <Printer className="w-4 h-4" /> Cetak
          </button>
          <button
            type="button"
            onClick={handleExportExcel}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg whitespace-nowrap"
          >
            <Download className="w-4 h-4" /> Export Excel
          </button>
          <button
            type="button"
            onClick={handleExportPDF}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-[#1E3A5F] hover:bg-[#162C49] rounded-lg whitespace-nowrap"
          >
            <FileText className="w-4 h-4" /> Export PDF
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 grid grid-cols-1 sm:grid-cols-4 gap-3 text-sm no-print">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Dari Tanggal</label>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="w-full px-3 py-2 border border-slate-200 rounded-lg"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Sampai Tanggal</label>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="w-full px-3 py-2 border border-slate-200 rounded-lg"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Kelas</label>
          <select
            value={classFilter}
            onChange={(e) => setClassFilter(e.target.value)}
            className="w-full px-3 py-2 border border-slate-200 rounded-lg bg-white"
          >
            <option value="all">Semua Kelas</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                Kelas {c.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Status Kehadiran</label>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'all' | 'absent' | AttendanceStatus)}
            className="w-full px-3 py-2 border border-slate-200 rounded-lg bg-white"
          >
            <option value="absent">Tidak Hadir (Sakit / Izin / Alpa)</option>
            <option value="all">Semua Status</option>
            <option value="Sakit">Sakit</option>
            <option value="Izin">Izin</option>
            <option value="Alpa">Alpa</option>
            <option value="Dispensasi">Dispensasi</option>
            <option value="Hadir">Hadir</option>
          </select>
        </div>
      </div>

      {/* Formal Printable Attendance Recap Document */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4 print-sheet">
        {/* Formal School Kop Surat Header with Logo & Address Placeholders */}
        <div className="pb-3 border-b-2 border-slate-900">
          <div className="relative flex flex-col sm:flex-row items-center justify-center gap-3 min-h-[68px]">
            {settings.schoolLogoUrl ? (
              <img
                src={settings.schoolLogoUrl}
                alt={`Logo ${kop.line3}`}
                className="w-16 h-16 object-contain shrink-0 sm:absolute sm:left-0 sm:top-1/2 sm:-translate-y-1/2"
              />
            ) : (
              <div
                aria-label="Placeholder Logo Sekolah"
                className="w-16 h-16 rounded-lg border-2 border-dashed border-slate-300 bg-slate-50 flex flex-col items-center justify-center text-slate-400 shrink-0 sm:absolute sm:left-0 sm:top-1/2 sm:-translate-y-1/2"
              >
                <School className="w-6 h-6" />
                <span className="text-[9px] font-bold uppercase tracking-wider mt-0.5">Logo</span>
              </div>
            )}

            <div className="space-y-0.5 text-center sm:px-20">
              <div className="text-xs font-semibold tracking-wide text-slate-700 uppercase">
                {kop.line1}
              </div>
              <div className="text-xs font-bold tracking-wide text-slate-800 uppercase">
                {kop.line2}
              </div>
              <div className="text-base sm:text-lg font-extrabold text-slate-900 uppercase">
                {kop.line3}
              </div>
              <div className="text-xs text-slate-600">{addressDisplay}</div>
              {kop.line5 && (
                <div className="text-xs text-slate-500 italic">{kop.line5}</div>
              )}
            </div>
          </div>
        </div>
        <div className="border-t border-slate-900 -mt-3.5" />

        {/* Document Title & Metadata */}
        <div className="text-center space-y-1 pt-1">
          <h2 className="text-sm sm:text-base font-bold text-slate-900 uppercase tracking-wide">
            Rekapitulasi Absensi Seluruh Kelas
          </h2>
          <p className="text-xs text-slate-600">
            {activeScopeSubtitle} · Tahun Ajaran {settings.activeAcademicYear} (
            {settings.activeSemester}) · Dicetak: {formattedToday}
          </p>
        </div>

        {/* Formal Bordered Table with Consistent Cell Padding */}
        <div className="overflow-x-auto">
          <table className="w-full border-collapse border border-slate-400 text-xs sm:text-sm">
            <thead className="bg-[#1E3A5F] text-white text-xs uppercase tracking-wide">
              <tr>
                <th className="px-3 py-2.5 font-semibold text-center whitespace-nowrap border border-slate-400 w-12">
                  No
                </th>
                <th className="px-3 py-2.5 font-semibold text-center whitespace-nowrap border border-slate-400">
                  Tanggal
                </th>
                <th className="px-3 py-2.5 font-semibold text-center whitespace-nowrap border border-slate-400">
                  NIS
                </th>
                <th className="px-3 py-2.5 font-semibold text-left whitespace-nowrap border border-slate-400">
                  Nama Siswa
                </th>
                <th className="px-3 py-2.5 font-semibold text-center whitespace-nowrap border border-slate-400">
                  Kelas
                </th>
                <th className="px-3 py-2.5 font-semibold text-center whitespace-nowrap border border-slate-400">
                  Status
                </th>
                <th className="px-3 py-2.5 font-semibold text-left border border-slate-400">
                  Keterangan
                </th>
                <th className="px-3 py-2.5 font-semibold text-left whitespace-nowrap border border-slate-400">
                  Pencatat
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td
                    colSpan={RECAP_COLUMNS.length}
                    className="px-3 py-8 text-center italic text-slate-500 border border-slate-300 bg-white"
                  >
                    Tidak ada catatan absensi pada filter ini.
                  </td>
                </tr>
              ) : (
                filtered.map((a, idx) => (
                  <tr
                    key={a.id}
                    className={`${
                      idx % 2 === 1 ? 'bg-slate-50/70' : 'bg-white'
                    } hover:bg-slate-100/70`}
                  >
                    <td className="px-3 py-2.5 text-center font-mono tabular-nums text-slate-600 border border-slate-300">
                      {idx + 1}
                    </td>
                    <td className="px-3 py-2.5 text-center font-mono tabular-nums text-slate-700 whitespace-nowrap border border-slate-300">
                      {formatDateShort(a.date)}
                    </td>
                    <td className="px-3 py-2.5 text-center font-mono tabular-nums text-slate-700 whitespace-nowrap border border-slate-300">
                      {a.nis}
                    </td>
                    <td className="px-3 py-2.5 text-left font-semibold text-slate-900 border border-slate-300">
                      {a.studentName}
                    </td>
                    <td className="px-3 py-2.5 text-center text-slate-700 whitespace-nowrap border border-slate-300">
                      {a.className}
                    </td>
                    <td className="px-3 py-2.5 text-center font-semibold whitespace-nowrap border border-slate-300">
                      <span
                        className={
                          a.status === 'Alpa'
                            ? 'text-red-700'
                            : a.status === 'Sakit'
                            ? 'text-sky-700'
                            : a.status === 'Izin'
                            ? 'text-amber-700'
                            : 'text-emerald-700'
                        }
                      >
                        {a.status}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-left text-slate-700 border border-slate-300">
                      {a.note || '-'}
                    </td>
                    <td className="px-3 py-2.5 text-left text-slate-700 whitespace-nowrap border border-slate-300">
                      {a.recordedBy || '-'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Summary Strip */}
        <div className="px-3.5 py-2.5 rounded-lg bg-slate-50 border border-slate-300 text-xs font-semibold text-[#1E3A5F]">
          {summaryText}
        </div>

        {/* Print-only Dual Signature Block & Footer */}
        <div className="hidden print-only pt-6 space-y-6">
          <div className="grid grid-cols-2 gap-8 text-xs text-slate-900 text-center">
            <div>
              <div>Mengetahui,</div>
              <div>Kepala Sekolah,</div>
              <div className="h-16" />
              <div className="font-bold">
                {settings.principalName || '........................................'}
              </div>
              <div>NIP. {settings.principalNip || '-'}</div>
            </div>
            <div>
              <div>{signatureDateLine}</div>
              <div>Guru Bimbingan dan Konseling,</div>
              <div className="h-16" />
              <div className="font-bold">{counselorSignatureName}</div>
            </div>
          </div>

          <div className="pt-3 border-t border-slate-300 flex items-center justify-between text-[11px] text-slate-500">
            <span>{kop.line3} — Sistem Informasi Bimbingan dan Konseling (SIBK)</span>
            <span>Dicetak: {formattedToday}</span>
          </div>
        </div>
      </div>

      {/* Frequent Absentees (Screen Quick Reference) */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 no-print">
        <h2 className="text-base font-bold text-slate-900 mb-3">
          Siswa dengan Ketidakhadiran Terbanyak
        </h2>
        <div className="divide-y divide-slate-100 text-sm">
          {frequentAbsentees.length === 0 ? (
            <p className="text-slate-400 py-3">Belum ada data ketidakhadiran.</p>
          ) : (
            frequentAbsentees.map((item) => (
              <div key={item.nis} className="py-2.5 flex items-center justify-between gap-4">
                <div>
                  <span className="font-semibold text-slate-900">{item.name}</span>
                  <span className="text-slate-500 ml-2">
                    · Kelas {item.className} · NIS {item.nis}
                  </span>
                </div>
                <div className="font-mono tabular-nums text-slate-700 whitespace-nowrap">
                  Sakit {item.sakit} · Izin {item.izin} ·{' '}
                  <strong className="text-red-700">Alpa {item.alpa}</strong>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
