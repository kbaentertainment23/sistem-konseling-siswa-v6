import type { ParentCall, SystemSettings } from '../types/sibk';
import { formatMeetingScheduleText, isParentCallCompleted } from './parentCallLogic';

const NON_AGGREGABLE_NUMERIC_HEADERS = new Set([
  'no',
  'nis',
  'nisn',
  'kelas',
  'hp siswa',
  'hp orang tua',
  'tahun masuk',
  'tahun',
  'nomor',
  'kode',
  'urutan',
]);

export interface SchoolKopLines {
  line1: string;
  line2: string;
  line3: string;
  line4: string;
  line5: string;
}

export function buildSchoolKopTextLines(
  settings: Pick<
    SystemSettings,
    | 'letterheadLine1'
    | 'letterheadLine2'
    | 'schoolName'
    | 'schoolAddress'
    | 'schoolPhone'
    | 'schoolEmailSocial'
  >
): SchoolKopLines {
  const line1 = (settings.letterheadLine1 || 'PEMERINTAH KABUPATEN BULELENG').trim().toUpperCase();
  const line2 = (
    settings.letterheadLine2 || 'DINAS PENDIDIKAN PEMUDA DAN OLAHRAGA'
  )
    .trim()
    .toUpperCase();
  const line3 = (settings.schoolName || 'SMP NEGERI 6 SINGARAJA').trim().toUpperCase();

  const addrPart = (settings.schoolAddress || '').trim();
  const phonePart = (settings.schoolPhone || '').trim();
  const line4 =
    addrPart && phonePart && !addrPart.toLowerCase().includes(phonePart.toLowerCase())
      ? `${addrPart}, Telp. ${phonePart}`
      : addrPart || (phonePart ? `Telp. ${phonePart}` : '-');

  const line5 = (settings.schoolEmailSocial || '').trim();

  return { line1, line2, line3, line4, line5 };
}

export function isAggregableNumericColumn(
  header: string,
  values: Array<unknown>
): boolean {
  const normalized = header.trim().toLowerCase();
  if (NON_AGGREGABLE_NUMERIC_HEADERS.has(normalized)) return false;
  if (values.length === 0) return false;

  let hasNumber = false;
  for (const val of values) {
    if (val === '' || val === null || val === undefined) continue;
    if (typeof val === 'number' && Number.isFinite(val)) {
      hasNumber = true;
    } else {
      return false;
    }
  }
  return hasNumber;
}

export function computeExcelSummaryRow(
  headers: string[],
  rows: Array<Record<string, unknown>>
): Array<string | number> | null {
  if (headers.length === 0 || rows.length === 0) return null;

  const summableCols = headers.map((header) => {
    const colValues = rows.map((r) => r[header]);
    return isAggregableNumericColumn(header, colValues);
  });

  if (!summableCols.some(Boolean)) return null;

  const summary: Array<string | number> = headers.map((header, idx) => {
    if (!summableCols[idx]) return '';
    let total = 0;
    for (const row of rows) {
      const raw = row[header];
      const num = typeof raw === 'number' ? raw : Number(String(raw ?? '').trim());
      if (Number.isFinite(num)) total += num;
    }
    return total;
  });

  const labelIdx = summableCols.findIndex((isSum) => !isSum);
  summary[labelIdx >= 0 ? labelIdx : 0] = `TOTAL / REKAPITULASI (${rows.length} data)`;
  return summary;
}

export function buildTablePdfSummaryText(
  columns: string[],
  rows: Array<Array<string | number>>
): string {
  if (rows.length === 0) return 'Total Data: 0 baris';

  const parts: string[] = [`Total Data: ${rows.length} baris`];
  const sums: string[] = [];

  columns.forEach((col, idx) => {
    const colValues = rows.map((r) => r[idx]);
    if (!isAggregableNumericColumn(col, colValues)) return;
    const sum = colValues.reduce<number>((acc, val) => {
      const n = typeof val === 'number' ? val : Number(String(val ?? '').trim());
      return Number.isFinite(n) ? acc + n : acc;
    }, 0);
    sums.push(`${col}: ${sum}`);
  });

  if (sums.length > 0) {
    parts.push(`Rekapitulasi — ${sums.join(' · ')}`);
  } else {
    const statusIdx = columns.findIndex((c) => c.trim().toLowerCase() === 'status');
    if (statusIdx >= 0) {
      const counts = new Map<string, number>();
      rows.forEach((r) => {
        const val = String(r[statusIdx] ?? '').trim();
        if (!val || val === '-') return;
        counts.set(val, (counts.get(val) || 0) + 1);
      });
      if (counts.size > 0) {
        const statusSummary = Array.from(counts.entries())
          .map(([label, count]) => `${label}: ${count}`)
          .join(' · ');
        parts.push(`Ringkasan Status — ${statusSummary}`);
      }
    }
  }
  return parts.join('  |  ');
}

export interface PdfColumnAlignmentHint {
  halign: 'left' | 'center' | 'right';
  cellWidth?: number;
}

export function inferPdfColumnStyles(
  columns: string[],
  orientation: 'portrait' | 'landscape' = columns.length > 6 ? 'landscape' : 'portrait'
): Record<number, PdfColumnAlignmentHint> {
  const styles: Record<number, PdfColumnAlignmentHint> = {};
  const isLandscape = orientation === 'landscape';

  columns.forEach((col, idx) => {
    const norm = col.trim().toLowerCase();
    if (norm === 'no') {
      styles[idx] = { halign: 'center', cellWidth: 11 };
    } else if (norm === 'tanggal') {
      styles[idx] = { halign: 'center', cellWidth: 25 };
    } else if (norm === 'waktu') {
      styles[idx] = { halign: 'center', cellWidth: 18 };
    } else if (norm === 'nis' || norm === 'nisn') {
      styles[idx] = { halign: 'center', cellWidth: 30 };
    } else if (norm === 'kelas') {
      styles[idx] = { halign: 'center', cellWidth: 16 };
    } else if (norm === 'status') {
      styles[idx] = { halign: 'center', cellWidth: 24 };
    } else if (norm === 'pencatat' || norm === 'guru bk') {
      styles[idx] = { halign: 'left', cellWidth: isLandscape ? 38 : 30 };
    } else if (
      (norm === 'nama siswa' || norm === 'nama lengkap') &&
      isLandscape &&
      columns.length >= 7 &&
      columns.length <= 9 &&
      columns.some((c) => {
        const n = c.trim().toLowerCase();
        return n === 'keterangan' || n === 'uraian' || n === 'hasil';
      })
    ) {
      styles[idx] = { halign: 'left', cellWidth: 52 };
    } else if (
      norm === 'sakit' ||
      norm === 'izin' ||
      norm === 'alpa' ||
      norm === 'total'
    ) {
      styles[idx] = { halign: 'center', cellWidth: isLandscape ? 20 : 16 };
    } else if (
      norm === 'h/s/i/a' ||
      norm === 'hadir' ||
      norm === 'tren' ||
      norm === 'no. surat' ||
      norm === 'urutan' ||
      norm === 'jumlah kasus' ||
      norm === 'kasus' ||
      norm === 'konseling' ||
      norm === 'panggil ortu'
    ) {
      styles[idx] = { halign: 'center' };
    }
  });

  return styles;
}

const CENTER_EXCEL_HEADERS = new Set([
  'no',
  'tanggal',
  'waktu',
  'nis',
  'nisn',
  'kelas',
  'status',
  'h/s/i/a',
  'hadir',
  'jenis kelamin',
  'tahun masuk',
  'urutan',
  'no. surat',
  'tren',
  'sakit',
  'izin',
  'alpa',
  'total',
  'jumlah kasus',
  'kasus',
  'konseling',
  'panggil ortu',
]);

const RIGHT_EXCEL_HEADERS = new Set<string>();

export function inferExcelColumnAlignments(
  headers: string[]
): Array<'left' | 'center' | 'right'> {
  return headers.map((header) => {
    const norm = header.trim().toLowerCase();
    if (CENTER_EXCEL_HEADERS.has(norm)) return 'center';
    if (RIGHT_EXCEL_HEADERS.has(norm)) return 'right';
    return 'left';
  });
}

function getMinWidthForHeader(header: string): number {
  const norm = header.trim().toLowerCase();
  if (norm === 'no') return 6;
  if (norm === 'kelas') return 9;
  if (norm === 'sakit' || norm === 'izin' || norm === 'alpa' || norm === 'total') return 10;
  if (norm === 'tanggal' || norm === 'status') return 14;
  if (norm === 'nis' || norm === 'nisn') return 16;
  if (norm === 'nama siswa' || norm === 'nama lengkap') return 26;
  if (norm === 'keterangan' || norm === 'uraian' || norm === 'hasil') return 30;
  if (norm === 'pencatat' || norm === 'guru bk') return 20;
  return 14;
}

export function computeExcelColumnWidths(
  headers: string[],
  dataRows: Array<Array<string | number>>,
  summaryRow: Array<string | number> | null
): number[] {
  return headers.map((header, colIdx) => {
    const minW = getMinWidthForHeader(header);
    let maxLen = Math.max(header.length + 3, minW);

    for (const row of dataRows) {
      const val = String(row[colIdx] ?? '');
      for (const line of val.split('\n')) {
        if (line.length + 3 > maxLen) {
          maxLen = line.length + 3;
        }
      }
    }

    if (summaryRow && typeof summaryRow[colIdx] === 'number') {
      const sumLen = String(summaryRow[colIdx]).length + 4;
      if (sumLen > maxLen) maxLen = sumLen;
    }

    return Math.min(maxLen, 44);
  });
}

export function computeExcelRowHeight(
  cells: Array<string | number>,
  colWidths: number[],
  baseHeight = 20
): number {
  let maxLines = 1;
  cells.forEach((cell, idx) => {
    const text = String(cell ?? '');
    if (!text) return;
    const usableWidth = Math.max((colWidths[idx] || 14) - 2, 6);
    const lines = text.split('\n').reduce((acc, part) => {
      return acc + Math.max(1, Math.ceil(part.length / usableWidth));
    }, 0);
    if (lines > maxLines) maxLines = lines;
  });
  return Math.max(baseHeight, maxLines * 14 + 6);
}

export function resolveSignatureCounselorName(counselorName?: string): string {
  const clean = (counselorName || '').trim();
  return clean || '( ........................................ )';
}

export function extractCityPrefixFromAddress(address?: string): string {
  const clean = (address || '').trim();
  if (!clean) return '';
  const match = clean.match(
    /\b(Singaraja|Denpasar|Buleleng|Tabanan|Gianyar|Badung|Klungkung|Bangli|Karangasem|Jembrana|Jakarta|Bandung|Surabaya|Yogyakarta|Semarang|Medan|Makassar|Malang|Bali)\b/i
  );
  if (match) {
    const word = match[1];
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  }
  return '';
}

export interface ParentCallLetterMinutes {
  formattedSchedule: string;
  hasMeetingMinutes: boolean;
  meetingResult: string;
  agreement: string;
  followUpNote: string;
}

export function getParentCallLetterMinutes(call: ParentCall): ParentCallLetterMinutes {
  const formattedSchedule = formatMeetingScheduleText(
    call.meetingDate,
    call.meetingTime,
    call.meetingSchedule
  );
  const completed = isParentCallCompleted(call.status);
  const meetingResult = (call.meetingResult || '').trim();
  const agreement = (call.agreement || '').trim();
  const followUpNote = (call.followUpNote || '').trim();
  const hasMeetingMinutes =
    completed && Boolean(meetingResult || agreement || followUpNote);

  return {
    formattedSchedule: formattedSchedule || 'Menyesuaikan konfirmasi dengan Guru BK',
    hasMeetingMinutes,
    meetingResult,
    agreement,
    followUpNote,
  };
}

export function sanitizeExportFileName(raw: string): string {
  return (
    raw
      .trim()
      .replace(/[^a-zA-Z0-9._-]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'Dokumen_SIBK'
  );
}
