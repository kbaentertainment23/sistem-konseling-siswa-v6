import test from 'node:test';
import assert from 'node:assert/strict';
import type { ParentCall, SystemSettings } from '../types/sibk';
import {
  buildSchoolKopTextLines,
  buildTablePdfSummaryText,
  computeExcelColumnWidths,
  computeExcelRowHeight,
  computeExcelSummaryRow,
  extractCityPrefixFromAddress,
  getParentCallLetterMinutes,
  inferExcelColumnAlignments,
  inferPdfColumnStyles,
  resolveSignatureCounselorName,
  sanitizeExportFileName,
} from './exportFormatLogic';
import { buildStyledReportWorksheet } from './exportUtils';

const SAMPLE_SETTINGS: SystemSettings = {
  id: 'default',
  schoolName: 'SMP Negeri 6 Singaraja',
  schoolAddress: 'Jl. Bisma No. 5, Singaraja, Bali',
  schoolPhone: '(0362) 21234',
  schoolEmailSocial: 'bk@smpn6singaraja.sch.id | @smpn6singaraja',
  letterheadLine1: 'PEMERINTAH KABUPATEN BULELENG',
  letterheadLine2: 'DINAS PENDIDIKAN PEMUDA DAN OLAHRAGA',
  principalName: 'Drs. Made Wijaya, M.Pd.',
  principalNip: '196805121995121002',
  activeAcademicYear: '2026/2027',
  activeSemester: 'Ganjil',
  warningThreshold1: 2,
  warningThreshold2: 3,
  maxCaseThreshold: 5,
  reportNumberFormat: '{no}/BK/SMPN6/{bulan}/{tahun}',
  categories: ['Kehadiran / Kedisiplinan'],
};

test('computeExcelSummaryRow totals aggregable numeric columns while skipping NIS/No/Tahun Masuk', () => {
  const headers = ['No', 'NIS', 'Nama Siswa', 'Kelas', 'Sakit', 'Izin', 'Alpa', 'Total'];
  const rows = [
    { No: 1, NIS: '12345', 'Nama Siswa': 'Andi', Kelas: '8.1', Sakit: 2, Izin: 1, Alpa: 3, Total: 6 },
    { No: 2, NIS: '12346', 'Nama Siswa': 'Budi', Kelas: '8.2', Sakit: 1, Izin: 0, Alpa: 2, Total: 3 },
  ];

  const summary = computeExcelSummaryRow(headers, rows);
  assert.deepEqual(summary, [
    'TOTAL / REKAPITULASI (2 data)',
    '',
    '',
    '',
    3,
    1,
    5,
    9,
  ]);
});

test('computeExcelSummaryRow returns null when no aggregable numeric columns exist', () => {
  const headers = ['Tanggal', 'Nama Siswa', 'Uraian'];
  const rows = [{ Tanggal: '2026-11-21', 'Nama Siswa': 'Andi', Uraian: 'Terlambat' }];
  assert.equal(computeExcelSummaryRow(headers, rows), null);
});

test('buildTablePdfSummaryText and inferPdfColumnStyles align and summarize table reports', () => {
  const columns = ['No', 'Tanggal', 'NIS', 'Nama Siswa', 'Kelas', 'Status', 'Sakit', 'Alpa', 'Total'];
  const rows = [
    [1, '21 Nov 2026', '1001', 'Ani', '7.1', 'Alpa', 2, 1, 3],
    [2, '20 Nov 2026', '1002', 'Budi', '7.2', 'Sakit', 0, 4, 4],
  ];

  const text = buildTablePdfSummaryText(columns, rows);
  assert.ok(text.includes('Total Data: 2 baris'));
  assert.ok(text.includes('Sakit: 2'));
  assert.ok(text.includes('Alpa: 5'));
  assert.ok(text.includes('Total: 7'));

  const styles = inferPdfColumnStyles(columns);
  assert.equal(styles[0].halign, 'center');
  assert.equal(styles[1].halign, 'center');
  assert.equal(styles[2].halign, 'center');
  assert.equal(styles[2].cellWidth, 30);
  assert.equal(styles[4].halign, 'center');
  assert.equal(styles[5].halign, 'center');
  assert.equal(styles[6].halign, 'center');
  assert.equal(styles[8].halign, 'center');

  const recapSummary = buildTablePdfSummaryText(
    ['No', 'Tanggal', 'NIS', 'Nama Siswa', 'Kelas', 'Status', 'Keterangan', 'Pencatat'],
    [
      [1, '20/11/2026', '21836871263', 'ivan', '8.1', 'Alpa', '-', 'Administrator SIBK'],
      [2, '20/11/2026', '123123', 'meliana', '8.2', 'Sakit', '-', 'Administrator SIBK'],
    ]
  );
  assert.ok(recapSummary.includes('Total Data: 2 baris'));
  assert.ok(recapSummary.includes('Alpa: 1'));
  assert.ok(recapSummary.includes('Sakit: 1'));
});

test('buildSchoolKopTextLines and Excel alignment/sizing helpers produce structured Kop and column layout', () => {
  const kop = buildSchoolKopTextLines(SAMPLE_SETTINGS);
  assert.equal(kop.line1, 'PEMERINTAH KABUPATEN BULELENG');
  assert.equal(kop.line2, 'DINAS PENDIDIKAN PEMUDA DAN OLAHRAGA');
  assert.equal(kop.line3, 'SMP NEGERI 6 SINGARAJA');
  assert.equal(kop.line4, 'Jl. Bisma No. 5, Singaraja, Bali, Telp. (0362) 21234');
  assert.equal(kop.line5, 'bk@smpn6singaraja.sch.id | @smpn6singaraja');

  const headers = ['No', 'Tanggal', 'NIS', 'Nama Siswa', 'Kelas', 'Status', 'Keterangan', 'Pencatat'];
  assert.deepEqual(inferExcelColumnAlignments(headers), [
    'center',
    'center',
    'center',
    'left',
    'center',
    'center',
    'left',
    'left',
  ]);

  const widths = computeExcelColumnWidths(
    headers,
    [[1, '21 Nov 2026', '2026001', 'I Putu Arya', '8.1', 'Alpa', 'Tidak hadir tanpa keterangan sejak jam pertama', 'Wali Kelas 8.1']],
    null
  );
  assert.equal(widths[0], 6);
  assert.ok(widths[6] <= 44 && widths[6] >= 30);

  const tallHeight = computeExcelRowHeight(
    [1, '21 Nov 2026', '2026001', 'I Putu Arya', '8.1', 'Alpa', 'Catatan sangat panjang yang akan membungkus lebih dari satu baris pada kolom keterangan', 'Wali Kelas'],
    widths
  );
  assert.ok(tallHeight > 21);
});

test('buildStyledReportWorksheet applies Kop merges, divider border, navy table header, ARGB cell grid borders, and centered signatures', () => {
  const rows = [
    {
      No: 1,
      Tanggal: '21 Nov 2026',
      NIS: '2026001',
      'Nama Siswa': 'Andi Pratama',
      Kelas: '8.1',
      Status: 'Alpa',
      Keterangan: 'Tanpa keterangan',
      Pencatat: 'Sari Wulandari',
    },
    {
      No: 2,
      Tanggal: '20 Nov 2026',
      NIS: '2026002',
      'Nama Siswa': 'Budi Santoso',
      Kelas: '8.2',
      Status: 'Sakit',
      Keterangan: 'Surat keterangan dokter',
      Pencatat: 'Sari Wulandari',
    },
  ];

  const ws = buildStyledReportWorksheet(rows, {
    title: 'Rekapitulasi Absensi Seluruh Kelas',
    subtitle: 'Semua Kelas · Tidak Hadir · 2 catatan',
    settings: SAMPLE_SETTINGS,
    counselorName: 'Sari Wulandari, S.Pd.',
  });

  // Kop Surat rows are merged cleanly across 8 columns (0..7)
  assert.ok(Array.isArray(ws['!merges']) && ws['!merges'].length >= 7);
  assert.equal(ws['A1'].v, 'PEMERINTAH KABUPATEN BULELENG');
  assert.equal(ws['A3'].v, 'SMP NEGERI 6 SINGARAJA');

  // Row 5 (index 4, cell A5..H5) is last Kop line and must have double bottom border across entire width
  assert.equal(ws['A5'].s?.border?.bottom?.style, 'double');
  assert.equal(ws['H5'].s?.border?.bottom?.style, 'double');
  assert.equal(ws['A5'].s?.border?.bottom?.color?.rgb, 'FF0F172A');

  // Table header is row 10 (index 9): A10..H10 with navy fill and 4 borders
  assert.equal(ws['A10'].v, 'No');
  assert.equal(ws['A10'].s?.fill?.fgColor?.rgb, 'FF1E3A5F');
  assert.equal(ws['A10'].s?.font?.color?.rgb, 'FFFFFFFF');
  assert.equal(ws['H10'].s?.border?.bottom?.style, 'medium');

  // Data cells (A11..H12) must have crisp borders on all 4 sides & zebra fill on row 12
  assert.equal(ws['A11'].s?.border?.top?.style, 'thin');
  assert.equal(ws['A11'].s?.border?.bottom?.style, 'thin');
  assert.equal(ws['A11'].s?.border?.left?.style, 'medium');
  assert.equal(ws['A11'].s?.border?.right?.style, 'thin');
  assert.equal(ws['F11'].s?.font?.color?.rgb, 'FFB91C1C'); // Alpa red bold
  assert.equal(ws['B12'].s?.fill?.fgColor?.rgb, 'FFF8FAFC'); // Zebra stripe
  assert.equal(ws['C11'].s?.numFmt, '@'); // NIS stays text

  // Signature block includes principal & active counselor centered
  assert.equal(ws['A14'].v, 'Mengetahui,');
  assert.equal(ws['E14'].s?.alignment?.horizontal, 'center');
  assert.equal(ws['A17'].v, 'Drs. Made Wijaya, M.Pd.');
  assert.equal(ws['E17'].v, 'Sari Wulandari, S.Pd.');
  assert.equal(ws['!pageSetup']?.orientation, 'landscape');
});

test('buildStyledReportWorksheet preserves full-width Kop and bordered table header when rows are empty and columns meta is passed', () => {
  const cols = ['No', 'Tanggal', 'NIS', 'Nama Siswa', 'Kelas', 'Status', 'Keterangan', 'Pencatat'];
  const ws = buildStyledReportWorksheet([], {
    title: 'Rekapitulasi Absensi Seluruh Kelas',
    subtitle: 'Semua Kelas · 0 catatan',
    settings: SAMPLE_SETTINGS,
    counselorName: 'Guru BK',
    columns: cols,
  });

  assert.equal(ws['A10'].v, 'No');
  assert.equal(ws['H10'].v, 'Pencatat');
  assert.equal(ws['A11'].v, 'Tidak ada data untuk diekspor');
  assert.equal(ws['A11'].s?.border?.bottom?.style, 'medium');
  assert.equal(ws['H11'].s?.border?.right?.style, 'medium');
});

test('getParentCallLetterMinutes detects completed meeting minutes and formats structured schedule', () => {
  const completedCall: ParentCall = {
    id: 'pc_1',
    letterNumber: '005/BK/SMPN6/XI/2026',
    studentId: 's1',
    studentName: 'Ivan',
    className: '8.1',
    parentName: 'Bapak Wayan',
    parentPhone: '08123456789',
    callDate: '2026-11-20',
    meetingDate: '2026-11-21',
    meetingTime: '09:30',
    meetingSchedule: '',
    reason: 'Ketidakhadiran berulang',
    meetingResult: 'Wali hadir dan berkomitmen mendampingi',
    agreement: 'Pemantauan 2 minggu',
    followUpNote: 'Cek ulang Senin depan',
    status: 'Selesai',
  };

  const minutes = getParentCallLetterMinutes(completedCall);
  assert.equal(minutes.hasMeetingMinutes, true);
  assert.ok(minutes.formattedSchedule.includes('Sabtu'));
  assert.ok(minutes.formattedSchedule.includes('09:30 WIB'));

  const scheduledOnly = getParentCallLetterMinutes({
    ...completedCall,
    status: 'Sudah dijadwalkan',
  });
  assert.equal(scheduledOnly.hasMeetingMinutes, false);
});

test('resolveSignatureCounselorName, extractCityPrefixFromAddress, and sanitizeExportFileName format cleanly', () => {
  assert.equal(resolveSignatureCounselorName('Sari Wulandari, S.Pd.'), 'Sari Wulandari, S.Pd.');
  assert.equal(resolveSignatureCounselorName('  '), '( ........................................ )');
  assert.equal(extractCityPrefixFromAddress('Jl. Bisma No. 5, Singaraja, Bali'), 'Singaraja');
  assert.equal(sanitizeExportFileName('Surat Panggilan / Ivan (8.1)'), 'Surat_Panggilan_Ivan_8.1');
});
