import React, { useMemo, useState } from 'react';
import { Download, Eye, FileText, Printer } from 'lucide-react';
import { useSibk } from '../context/SibkContext';
import type { Student } from '../types/sibk';
import { formatDateShort } from '../utils/sibkLogic';
import { exportTableToPDF, exportToExcel } from '../utils/exportUtils';
import { extractCityPrefixFromAddress } from '../utils/exportFormatLogic';

const REPORT_TYPES = [
  { id: 'pleno-promotion', label: '1. Laporan Pertimbangan Rapat Pleno Kenaikan Kelas' },
  { id: 'student-absence', label: '2. Laporan Ketidakhadiran per Siswa' },
  { id: 'follow-ups', label: '3. Laporan Tindak Lanjut Kasus (Belum Selesai)' },
  { id: 'counseling-history', label: '4. Laporan Riwayat Konseling Siswa' },
  { id: 'parent-calls', label: '5. Laporan Pemanggilan Orang Tua' },
  { id: 'bk-activities', label: '6. Laporan Kegiatan BK' },
] as const;

type ReportId = (typeof REPORT_TYPES)[number]['id'];

type PlenoRecommendation =
  | 'Pembahasan Khusus Pleno'
  | 'Naik Bersyarat (Perjanjian)'
  | 'Layak Naik (Terbina)';

interface PlenoRowMeta {
  student: Student;
  recommendation: PlenoRecommendation;
  trend: string;
  urgencyScore: number;
}

interface ReportsViewProps {
  onSelectStudent?: (student: Student) => void;
}

export const ReportsView: React.FC<ReportsViewProps> = ({ onSelectStudent }) => {
  const {
    students,
    classes,
    attendance,
    cases,
    counselingLogs,
    parentCalls,
    monitoringNotes,
    schedules,
    settings,
    currentUser,
  } = useSibk();

  const [reportId, setReportId] = useState<ReportId>('pleno-promotion');
  const [classFilter, setClassFilter] = useState('all');
  const [monthFilter, setMonthFilter] = useState('');

  const currentReport = REPORT_TYPES.find((r) => r.id === reportId) || REPORT_TYPES[0];

  const classFilterOptions = useMemo(() => {
    const activeClasses = classes.filter((c) => !c.archived);
    const levels = Array.from(new Set(activeClasses.map((c) => c.level))).filter(Boolean);
    return { activeClasses, levels };
  }, [classes]);

  const matchesClassOrLevel = (cid?: string) => {
    if (classFilter === 'all') return true;
    if (classFilter.startsWith('level:')) {
      const targetLevel = classFilter.slice(6);
      const cls = classes.find((c) => c.id === cid);
      return cls?.level === targetLevel;
    }
    return cid === classFilter;
  };

  const plenoAnalysis = useMemo(() => {
    const maxSick = settings.maxSickThreshold ?? 5;
    const maxPerm = settings.maxPermissionThreshold ?? 5;
    const maxAlpha = settings.maxAlphaThreshold ?? 3;
    const warn1 = settings.warningThreshold1 || 2;
    const warn2 = settings.warningThreshold2 || 4;
    const maxCase = settings.maxCaseThreshold || 6;

    const results: Array<{
      cells: Array<string | number>;
      meta: PlenoRowMeta;
    }> = [];

    students
      .filter((s) => s.status === 'Aktif' && matchesClassOrLevel(s.classId))
      .forEach((s) => {
        const stuAtt = attendance.filter((a) => a.studentId === s.id);
        const hadir = stuAtt.filter((a) => a.status === 'Hadir' || a.status === 'Dispensasi').length;
        const sakit = stuAtt.filter((a) => a.status === 'Sakit').length;
        const izin = stuAtt.filter((a) => a.status === 'Izin').length;
        const alpa = stuAtt.filter((a) => a.status === 'Alpa').length;
        const totalAtt = stuAtt.length;
        const hadirPct = totalAtt > 0 ? Math.round((hadir / totalAtt) * 100) : 100;

        const stuCases = cases.filter((c) => c.studentId === s.id);
        const totalCases = stuCases.length;
        const doneCases = stuCases.filter((c) => c.status === 'Selesai').length;
        const openCases = totalCases - doneCases;

        const sessionsCount = counselingLogs.filter((l) => l.studentId === s.id).length;

        const stuCalls = parentCalls.filter((p) => p.studentId === s.id);
        const callCount = stuCalls.length;
        const callAttended = stuCalls.filter(
          (p) => p.status === 'Hadir' || p.status === 'Selesai'
        ).length;
        const callAbsent = stuCalls.filter(
          (p) => p.status === 'Tidak hadir' || p.status === 'Perlu pemanggilan ulang'
        ).length;

        const stuNotes = monitoringNotes
          .filter((n) => n.studentId === s.id)
          .sort((a, b) => b.date.localeCompare(a.date));
        const latestTrend = stuNotes[0]?.progressLevel || 'Belum ada';

        const needsPlenoReview =
          totalCases >= warn1 ||
          openCases > 0 ||
          alpa >= maxAlpha ||
          sakit >= maxSick ||
          izin >= maxPerm ||
          callCount > 0 ||
          s.monitoringStatus === 'Perlu Perhatian' ||
          s.monitoringStatus === 'Dalam Pemantauan' ||
          s.monitoringStatus === 'Prioritas Tinggi' ||
          latestTrend === 'Perlu Perhatian' ||
          latestTrend === 'Menurun';

        if (!needsPlenoReview) return;

        let recommendation: PlenoRecommendation = 'Layak Naik (Terbina)';
        if (
          totalCases >= maxCase ||
          alpa >= maxAlpha * 2 ||
          (openCases > 0 && latestTrend === 'Menurun') ||
          callAbsent > 0 ||
          s.monitoringStatus === 'Prioritas Tinggi'
        ) {
          recommendation = 'Pembahasan Khusus Pleno';
        } else if (
          openCases > 0 ||
          alpa >= maxAlpha ||
          totalCases >= warn2 ||
          latestTrend === 'Perlu Perhatian' ||
          latestTrend === 'Menurun'
        ) {
          recommendation = 'Naik Bersyarat (Perjanjian)';
        }

        const urgencyScore =
          openCases * 15 +
          totalCases * 8 +
          alpa * 6 +
          callAbsent * 12 +
          (latestTrend === 'Menurun' ? 20 : latestTrend === 'Perlu Perhatian' ? 10 : 0) +
          (s.monitoringStatus === 'Prioritas Tinggi' ? 25 : 0);

        const callSummary =
          callCount === 0
            ? '0x'
            : `${callCount}x (${callAttended} hadir${callAbsent > 0 ? `, ${callAbsent} absen` : ''})`;

        results.push({
          cells: [
            0, // placeholder filled after sorting
            s.nis,
            s.fullName,
            s.className,
            `${hadir}/${sakit}/${izin}/${alpa}`,
            `${hadirPct}%`,
            `${totalCases} (${openCases} belum)`,
            `${sessionsCount}x`,
            callSummary,
            latestTrend,
            recommendation,
          ],
          meta: {
            student: s,
            recommendation,
            trend: latestTrend,
            urgencyScore,
          },
        });
      });

    results.sort((a, b) => b.meta.urgencyScore - a.meta.urgencyScore);
    results.forEach((item, idx) => {
      item.cells[0] = idx + 1;
    });

    const summary = {
      total: results.length,
      khusus: results.filter((r) => r.meta.recommendation === 'Pembahasan Khusus Pleno').length,
      bersyarat: results.filter((r) => r.meta.recommendation === 'Naik Bersyarat (Perjanjian)')
        .length,
      layak: results.filter((r) => r.meta.recommendation === 'Layak Naik (Terbina)').length,
    };

    return { results, summary };
  }, [
    students,
    attendance,
    cases,
    counselingLogs,
    parentCalls,
    monitoringNotes,
    settings,
    classFilter,
    classes,
  ]);

  const tableData = useMemo((): { columns: string[]; rows: Array<Array<string | number>> } => {
    switch (reportId) {
      case 'pleno-promotion':
        return {
          columns: [
            'No',
            'NIS',
            'Nama Siswa',
            'Kelas',
            'H/S/I/A',
            'Hadir',
            'Kasus',
            'Konseling',
            'Panggil Ortu',
            'Tren',
            'Rekomendasi Pleno',
          ],
          rows: plenoAnalysis.results.map((r) => r.cells),
        };

      case 'student-absence':
        return {
          columns: ['No', 'NIS', 'Nama Siswa', 'Kelas', 'Sakit', 'Izin', 'Alpa', 'Total'],
          rows: students
            .filter((s) => s.status === 'Aktif' && matchesClassOrLevel(s.classId))
            .map((s) => {
              const stAtt = attendance.filter(
                (a) => a.studentId === s.id && (!monthFilter || a.date.startsWith(monthFilter))
              );
              const sakit = stAtt.filter((a) => a.status === 'Sakit').length;
              const izin = stAtt.filter((a) => a.status === 'Izin').length;
              const alpa = stAtt.filter((a) => a.status === 'Alpa').length;
              return {
                row: [s.nis, s.fullName, s.className, sakit, izin, alpa, sakit + izin + alpa],
                total: sakit + izin + alpa,
              };
            })
            .filter((x) => x.total > 0)
            .sort((a, b) => b.total - a.total)
            .map((x, idx) => [idx + 1, ...x.row]),
        };

      case 'follow-ups':
        return {
          columns: ['Urutan', 'Tanggal', 'Siswa', 'Kategori', 'Status', 'Tindakan Awal'],
          rows: cases
            .filter(
              (c) =>
                c.status !== 'Selesai' &&
                matchesClassOrLevel(c.classId) &&
                (!monthFilter || c.date.startsWith(monthFilter))
            )
            .map((c) => [
              `Kasus ke-${c.caseNumber}`,
              formatDateShort(c.date),
              `${c.studentName} (${c.className})`,
              c.category,
              c.status,
              c.initialAction || '-',
            ]),
        };

      case 'counseling-history':
        return {
          columns: ['Tanggal', 'Siswa', 'Guru BK', 'Topik', 'Hasil', 'Status'],
          rows: counselingLogs
            .filter((l) => {
              const stu = students.find((s) => s.id === l.studentId);
              return (
                matchesClassOrLevel(stu?.classId) && (!monthFilter || l.date.startsWith(monthFilter))
              );
            })
            .map((l) => {
              const stu = students.find((s) => s.id === l.studentId);
              return [
                formatDateShort(l.date),
                stu ? `${stu.fullName} (${stu.className})` : l.studentId,
                l.counselorName,
                l.topic,
                l.result,
                l.progressStatus,
              ];
            }),
        };

      case 'parent-calls':
        return {
          columns: ['No. Surat', 'Tanggal', 'Siswa', 'Orang Tua', 'Jadwal', 'Status'],
          rows: parentCalls
            .filter((p) => {
              const stu = students.find((s) => s.id === p.studentId);
              return (
                matchesClassOrLevel(stu?.classId) &&
                (!monthFilter || p.callDate.startsWith(monthFilter))
              );
            })
            .map((p) => [
              p.letterNumber || '-',
              formatDateShort(p.callDate),
              `${p.studentName} (${p.className})`,
              p.parentName,
              p.meetingSchedule || '-',
              p.status,
            ]),
        };

      case 'bk-activities':
        return {
          columns: ['Tanggal', 'Waktu', 'Jenis Kegiatan', 'Judul', 'Status'],
          rows: schedules
            .filter((s) => !monthFilter || s.date.startsWith(monthFilter))
            .map((s) => [
              formatDateShort(s.date),
              s.time || '-',
              s.type,
              s.title,
              s.completed ? 'Selesai' : 'Terjadwal',
            ]),
        };
    }
  }, [
    reportId,
    classFilter,
    monthFilter,
    plenoAnalysis,
    students,
    classes,
    attendance,
    cases,
    counselingLogs,
    parentCalls,
    schedules,
  ]);

  const activeScopeLabel = useMemo(() => {
    const classPart =
      classFilter === 'all'
        ? 'Semua Kelas'
        : classFilter.startsWith('level:')
          ? `Tingkat ${classFilter.slice(6)}`
          : `Kelas ${classes.find((c) => c.id === classFilter)?.name || ''}`;
    if (monthFilter && reportId !== 'pleno-promotion') {
      return `${classPart} · Bulan ${monthFilter}`;
    }
    return classPart;
  }, [classFilter, monthFilter, reportId, classes]);

  const handleExportExcel = () => {
    const objects = tableData.rows.map((row) => {
      const obj: Record<string, unknown> = {};
      tableData.columns.forEach((col, i) => {
        obj[col] = row[i];
      });
      return obj;
    });
    exportToExcel(objects, `Laporan_SIBK_${reportId}`, 'Laporan', {
      title: currentReport.label,
      subtitle: `${activeScopeLabel} · Tahun Ajaran ${settings.activeAcademicYear}`,
      settings,
      counselorName: currentUser?.name,
      columns: tableData.columns,
    });
  };

  const handleExportPDF = () => {
    exportTableToPDF(
      currentReport.label,
      `${activeScopeLabel} · Tahun Ajaran ${settings.activeAcademicYear} (${settings.activeSemester})`,
      tableData.columns,
      tableData.rows,
      settings,
      `Laporan_SIBK_${reportId}`,
      { counselorName: currentUser?.name }
    );
  };

  const getRecommendationBadge = (rec: PlenoRecommendation) => {
    if (rec === 'Pembahasan Khusus Pleno') {
      return 'bg-red-50 text-red-700 border-red-200';
    }
    if (rec === 'Naik Bersyarat (Perjanjian)') {
      return 'bg-amber-50 text-amber-800 border-amber-200';
    }
    return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  };

  const getTrendBadge = (trend: string) => {
    if (trend === 'Menurun') return 'bg-red-50 text-red-700 border-red-200';
    if (trend === 'Perlu Perhatian') return 'bg-amber-50 text-amber-800 border-amber-200';
    if (trend === 'Membaik') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    return 'bg-slate-100 text-slate-700 border-slate-200';
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 no-print">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900">Pusat Laporan & Rekapitulasi BK</h1>
          <p className="text-sm text-slate-600 mt-1">
            {REPORT_TYPES.length} jenis laporan administrasi formal &amp; bahan rapat pleno siap
            cetak, Export Excel, dan Export PDF
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg"
          >
            <Printer className="w-4 h-4" /> Cetak
          </button>
          <button
            type="button"
            onClick={handleExportExcel}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg"
          >
            <Download className="w-4 h-4" /> Export Excel
          </button>
          <button
            type="button"
            onClick={handleExportPDF}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-[#1E3A5F] hover:bg-[#162C49] rounded-lg"
          >
            <FileText className="w-4 h-4" /> Export PDF
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm no-print">
        <div>
          <label className="block text-slate-600 font-medium mb-1">Jenis Laporan</label>
          <select
            value={reportId}
            onChange={(e) => setReportId(e.target.value as ReportId)}
            className="w-full px-3 py-2 border border-slate-200 rounded-lg bg-white font-medium"
          >
            {REPORT_TYPES.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-slate-600 font-medium mb-1">Filter Tingkat / Kelas</label>
          <select
            value={classFilter}
            onChange={(e) => setClassFilter(e.target.value)}
            className="w-full px-3 py-2 border border-slate-200 rounded-lg bg-white"
          >
            <option value="all">Semua Kelas</option>
            {classFilterOptions.levels.length > 0 && (
              <optgroup label="Per Tingkat / Angkatan">
                {classFilterOptions.levels.map((lvl) => (
                  <option key={lvl} value={`level:${lvl}`}>
                    Semua Kelas Tingkat {lvl}
                  </option>
                ))}
              </optgroup>
            )}
            <optgroup label="Per Kelas">
              {classFilterOptions.activeClasses.map((c) => (
                <option key={c.id} value={c.id}>
                  Kelas {c.name}
                </option>
              ))}
            </optgroup>
          </select>
        </div>
        <div>
          <label className="block text-slate-600 font-medium mb-1">Filter Bulan (Opsional)</label>
          <div className="flex items-center gap-1.5">
            <input
              type="month"
              value={monthFilter}
              onChange={(e) => setMonthFilter(e.target.value)}
              disabled={reportId === 'pleno-promotion'}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg disabled:bg-slate-50 disabled:text-slate-400"
            />
            {monthFilter && reportId !== 'pleno-promotion' && (
              <button
                type="button"
                onClick={() => setMonthFilter('')}
                className="px-3 py-2 text-sm font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg whitespace-nowrap"
              >
                Reset
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Summary Strip specifically for Rapat Pleno */}
      {reportId === 'pleno-promotion' && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 no-print">
          <div className="bg-white border border-slate-200 rounded-xl p-3.5">
            <div className="text-xs font-medium text-slate-500">Siswa Masuk Pertimbangan</div>
            <div className="text-xl sm:text-2xl font-bold text-slate-900 font-mono tabular-nums mt-0.5">
              {plenoAnalysis.summary.total}
            </div>
            <div className="text-xs text-slate-400 mt-0.5">{activeScopeLabel}</div>
          </div>
          <div className="bg-red-50/70 border border-red-200 rounded-xl p-3.5">
            <div className="text-xs text-red-700 font-medium">Pembahasan Khusus Pleno</div>
            <div className="text-xl sm:text-2xl font-bold text-red-800 font-mono tabular-nums mt-0.5">
              {plenoAnalysis.summary.khusus}
            </div>
            <div className="text-xs text-red-600 mt-0.5">Prioritas keputusan rapat</div>
          </div>
          <div className="bg-amber-50/70 border border-amber-200 rounded-xl p-3.5">
            <div className="text-xs text-amber-800 font-medium">Naik Bersyarat (Perjanjian)</div>
            <div className="text-xl sm:text-2xl font-bold text-amber-900 font-mono tabular-nums mt-0.5">
              {plenoAnalysis.summary.bersyarat}
            </div>
            <div className="text-xs text-amber-700 mt-0.5">Perlu pembinaan lanjutan</div>
          </div>
          <div className="bg-emerald-50/70 border border-emerald-200 rounded-xl p-3.5">
            <div className="text-xs text-emerald-800 font-medium">Layak Naik (Terbina)</div>
            <div className="text-xl sm:text-2xl font-bold text-emerald-900 font-mono tabular-nums mt-0.5">
              {plenoAnalysis.summary.layak}
            </div>
            <div className="text-xs text-emerald-700 mt-0.5">Kasus selesai / tren baik</div>
          </div>
        </div>
      )}

      {/* Formal Report Preview with 5-line Official Kop Surat */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
        <div className="pb-3 border-b-2 border-slate-900">
          <div className="relative flex items-center justify-center min-h-[60px]">
            {settings.schoolLogoUrl && (
              <img
                src={settings.schoolLogoUrl}
                alt="Logo Sekolah"
                className="w-14 h-14 object-contain shrink-0 sm:absolute sm:left-0 sm:top-1/2 sm:-translate-y-1/2 mr-3 sm:mr-0"
              />
            )}
            <div className="space-y-0.5 text-center sm:px-20">
              {settings.letterheadLine1 && (
                <div className="text-xs font-semibold tracking-wide text-slate-700 uppercase">
                  {settings.letterheadLine1}
                </div>
              )}
              {settings.letterheadLine2 && (
                <div className="text-xs font-bold tracking-wide text-slate-800 uppercase">
                  {settings.letterheadLine2}
                </div>
              )}
              <div className="text-base sm:text-lg font-extrabold text-slate-900 uppercase">
                {settings.schoolName}
              </div>
              <div className="text-xs text-slate-600">
                {settings.schoolAddress}
                {settings.schoolPhone ? `, Telp. ${settings.schoolPhone}` : ''}
              </div>
              {settings.schoolEmailSocial && (
                <div className="text-xs text-slate-500">{settings.schoolEmailSocial}</div>
              )}
            </div>
          </div>
        </div>
        <div className="border-t border-slate-900 -mt-3.5" />

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-1">
          <div>
            <div className="text-base font-bold text-slate-900">{currentReport.label}</div>
            <div className="text-sm text-slate-500">
              {activeScopeLabel} · Tahun Ajaran {settings.activeAcademicYear} · Semester{' '}
              {settings.activeSemester}
            </div>
          </div>
          {reportId === 'pleno-promotion' && (
            <div className="text-xs text-slate-500 no-print">
              Diurutkan otomatis dari tingkat urgensi tertinggi · Klik <strong>Profil / PDF</strong>{' '}
              untuk cetak riwayat 1 siswa
            </div>
          )}
        </div>

        <div className="overflow-x-auto">
          <table
            className={`w-full text-left border-collapse border border-slate-300 ${
              reportId === 'pleno-promotion' ? 'text-xs' : 'text-sm'
            }`}
          >
            <thead className="bg-[#1E3A5F] text-white text-xs">
              <tr>
                {tableData.columns.map((col) => (
                  <th
                    key={col}
                    className={`${
                      reportId === 'pleno-promotion' ? 'px-2 py-2.5' : 'px-3 py-2.5'
                    } font-semibold whitespace-nowrap border border-slate-400`}
                  >
                    {col}
                  </th>
                ))}
                {reportId === 'pleno-promotion' && onSelectStudent && (
                  <th className="px-2 py-2.5 font-semibold text-right whitespace-nowrap border border-slate-400 no-print">
                    Lampiran
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {tableData.rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={
                      tableData.columns.length +
                      (reportId === 'pleno-promotion' && onSelectStudent ? 1 : 0)
                    }
                    className="px-3 py-8 text-center text-slate-400 border border-slate-300"
                  >
                    {reportId === 'pleno-promotion'
                      ? 'Tidak ada siswa yang masuk kategori pertimbangan rapat pleno pada filter ini.'
                      : 'Tidak ada data untuk laporan ini.'}
                  </td>
                </tr>
              ) : reportId === 'pleno-promotion' ? (
                plenoAnalysis.results.map(({ cells, meta }, rIdx) => (
                  <tr
                    key={meta.student.id}
                    className={`${rIdx % 2 === 1 ? 'bg-slate-50/70' : 'bg-white'} hover:bg-slate-100/70`}
                  >
                    {cells.map((cell, ci) => {
                      if (ci === 9) {
                        return (
                          <td key={ci} className="px-2 py-2.5 whitespace-nowrap border border-slate-300">
                            <span
                              className={`inline-flex px-2 py-0.5 rounded border text-xs font-medium ${getTrendBadge(
                                String(cell)
                              )}`}
                            >
                              {cell}
                            </span>
                          </td>
                        );
                      }
                      if (ci === 10) {
                        return (
                          <td key={ci} className="px-2 py-2.5 whitespace-nowrap border border-slate-300">
                            <span
                              className={`inline-flex px-2 py-0.5 rounded border text-xs font-semibold ${getRecommendationBadge(
                                meta.recommendation
                              )}`}
                            >
                              {cell}
                            </span>
                          </td>
                        );
                      }
                      return (
                        <td
                          key={ci}
                          className={`px-2 py-2.5 text-slate-700 whitespace-nowrap border border-slate-300 ${
                            ci === 2 ? 'font-semibold text-slate-900' : ''
                          } ${ci === 0 || ci === 1 || ci === 4 || ci === 5 ? 'font-mono' : ''}`}
                        >
                          {cell}
                        </td>
                      );
                    })}
                    {onSelectStudent && (
                      <td className="px-2 py-2.5 text-right whitespace-nowrap border border-slate-300 no-print">
                        <button
                          type="button"
                          onClick={() => onSelectStudent(meta.student)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-[#1E3A5F] bg-sky-50 hover:bg-sky-100 border border-sky-200 rounded-md transition-colors"
                        >
                          <Eye className="w-3.5 h-3.5" /> Profil / PDF
                        </button>
                      </td>
                    )}
                  </tr>
                ))
              ) : (
                tableData.rows.map((row, idx) => (
                  <tr key={idx} className={idx % 2 === 1 ? 'bg-slate-50/70' : 'bg-white'}>
                    {row.map((cell, ci) => (
                      <td key={ci} className="px-3 py-2.5 text-slate-700 border border-slate-300">
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Print-only Dual Signature Block */}
        <div className="hidden print-only pt-8">
          <div className="grid grid-cols-2 gap-8 text-xs text-slate-900 text-center">
            <div>
              <div>Mengetahui,</div>
              <div>Kepala Sekolah,</div>
              <div className="h-16" />
              <div className="font-bold">{settings.principalName || '........................................'}</div>
              <div>NIP. {settings.principalNip || '-'}</div>
            </div>
            <div>
              <div>
                {(() => {
                  const city = extractCityPrefixFromAddress(settings.schoolAddress);
                  const dt = new Date().toLocaleDateString('id-ID', {
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                  });
                  return city ? `${city}, ${dt}` : dt;
                })()}
              </div>
              <div>Guru Bimbingan dan Konseling,</div>
              <div className="h-16" />
              <div className="font-bold">{currentUser?.name || '( ........................................ )'}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
