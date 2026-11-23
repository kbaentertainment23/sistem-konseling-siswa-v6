import * as XLSXNamespace from 'xlsx-js-style';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

const XLSX = (
  (XLSXNamespace as unknown as { default?: typeof XLSXNamespace }).default?.utils
    ? (XLSXNamespace as unknown as { default: typeof XLSXNamespace }).default
    : XLSXNamespace
) as typeof XLSXNamespace;
import type {
  AttendanceRecord,
  CounselingLog,
  MonitoringNote,
  ParentCall,
  Student,
  StudentCase,
  SystemSettings,
} from '../types/sibk';
import { formatDateLong, formatDateShort, getTodayISO } from './sibkLogic';
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

export interface ExcelExportMeta {
  title?: string;
  subtitle?: string;
  settings?: SystemSettings;
  counselorName?: string;
  columns?: string[];
}

type ExcelBorderSide = { style: 'thin' | 'medium' | 'double'; color: { rgb: string } };
type ExcelCellStyle = NonNullable<XLSXNamespace.CellObject['s']>;

function getStatusCellFont(header: string, value: unknown): ExcelCellStyle['font'] | null {
  if (header.trim().toLowerCase() !== 'status') return null;
  const text = String(value ?? '').trim();
  if (text === 'Alpa') return { name: 'Calibri', sz: 10, bold: true, color: { rgb: 'FFB91C1C' } };
  if (text === 'Sakit') return { name: 'Calibri', sz: 10, bold: true, color: { rgb: 'FF0369A1' } };
  if (text === 'Izin') return { name: 'Calibri', sz: 10, bold: true, color: { rgb: 'FFB45309' } };
  if (text === 'Hadir' || text === 'Dispensasi' || text === 'Selesai' || text === 'Aktif') {
    return { name: 'Calibri', sz: 10, bold: true, color: { rgb: 'FF047857' } };
  }
  return null;
}

export function buildStyledReportWorksheet(
  rows: Array<Record<string, unknown>>,
  meta?: ExcelExportMeta
): XLSXNamespace.WorkSheet {
  const headers = rows.length > 0 ? Object.keys(rows[0]) : meta?.columns || [];
  const tableColCount = Math.max(headers.length, 1);
  const sheetColCount = tableColCount;

  const dataRows: Array<Array<string | number>> = rows.map((row) =>
    headers.map((h) => {
      const val = row[h];
      return typeof val === 'number' ? val : String(val ?? '');
    })
  );
  const summaryRow = computeExcelSummaryRow(headers, rows);
  const alignments = inferExcelColumnAlignments(headers);
  const colWidths =
    headers.length > 0
      ? computeExcelColumnWidths(headers, dataRows, summaryRow)
      : Array.from({ length: sheetColCount }, () => 24);
  const totalSheetWidth = Math.max(
    colWidths.reduce((acc, w) => acc + w, 0),
    24
  );

  const aoa: Array<Array<string | number>> = [];
  const merges: XLSXNamespace.Range[] = [];
  const rowHeights: Array<{ hpt: number }> = [];
  const cellStyles = new Map<string, ExcelCellStyle>();

  const setCellStyle = (r: number, c: number, style: ExcelCellStyle) => {
    cellStyles.set(XLSX.utils.encode_cell({ r, c }), style);
  };

  const pushMergedRow = (
    text: string,
    style: ExcelCellStyle,
    heightPt: number,
    options?: { bottomBorderOnAll?: ExcelBorderSide; allBorders?: ExcelCellStyle['border'] }
  ) => {
    const r = aoa.length;
    const rowArr: Array<string | number> = Array(sheetColCount).fill('');
    rowArr[0] = text;
    aoa.push(rowArr);
    rowHeights.push({ hpt: heightPt });
    if (sheetColCount > 1) {
      merges.push({ s: { r, c: 0 }, e: { r, c: sheetColCount - 1 } });
    }
    for (let c = 0; c < sheetColCount; c += 1) {
      let cellBorder = style.border;
      if (options?.allBorders) {
        cellBorder = {
          top: options.allBorders.top,
          bottom: options.allBorders.bottom,
          left: c === 0 ? options.allBorders.left : undefined,
          right: c === sheetColCount - 1 ? options.allBorders.right : undefined,
        };
      } else if (options?.bottomBorderOnAll) {
        cellBorder = {
          ...(style.border || {}),
          bottom: options.bottomBorderOnAll,
        };
      }
      setCellStyle(r, c, cellBorder ? { ...style, border: cellBorder } : style);
    }
  };

  const pushBlankRow = (heightPt: number) => {
    aoa.push(Array(sheetColCount).fill(''));
    rowHeights.push({ hpt: heightPt });
  };

  if (meta?.settings) {
    const kop = buildSchoolKopTextLines(meta.settings);
    const kopCenter: ExcelCellStyle['alignment'] = {
      horizontal: 'center',
      vertical: 'center',
      wrapText: true,
    };

    pushMergedRow(
      kop.line1,
      {
        font: { name: 'Calibri', sz: 11, bold: true, color: { rgb: 'FF1E293B' } },
        alignment: kopCenter,
      },
      18
    );
    pushMergedRow(
      kop.line2,
      {
        font: { name: 'Calibri', sz: 11, bold: true, color: { rgb: 'FF0F172A' } },
        alignment: kopCenter,
      },
      18
    );
    pushMergedRow(
      kop.line3,
      {
        font: { name: 'Calibri', sz: 14, bold: true, color: { rgb: 'FF0F172A' } },
        alignment: kopCenter,
      },
      24
    );

    const kopDivider: ExcelBorderSide = { style: 'double', color: { rgb: 'FF0F172A' } };
    const line4Height = computeExcelRowHeight([kop.line4], [totalSheetWidth], 18);
    pushMergedRow(
      kop.line4,
      {
        font: { name: 'Calibri', sz: 9.5, color: { rgb: 'FF334155' } },
        alignment: kopCenter,
      },
      line4Height,
      kop.line5 ? undefined : { bottomBorderOnAll: kopDivider }
    );

    if (kop.line5) {
      const line5Height = computeExcelRowHeight([kop.line5], [totalSheetWidth], 17);
      pushMergedRow(
        kop.line5,
        {
          font: { name: 'Calibri', sz: 9, italic: true, color: { rgb: 'FF475569' } },
          alignment: kopCenter,
        },
        line5Height,
        { bottomBorderOnAll: kopDivider }
      );
    }

    pushBlankRow(8);

    if (meta.title) {
      pushMergedRow(
        meta.title.toUpperCase(),
        {
          font: { name: 'Calibri', sz: 12, bold: true, color: { rgb: 'FF0F172A' } },
          alignment: kopCenter,
        },
        22
      );
    }

    const subtitleParts = [
      meta.subtitle,
      `Tahun Ajaran ${meta.settings.activeAcademicYear} (${meta.settings.activeSemester})`,
      `Dicetak: ${formatDateLong(getTodayISO())}`,
    ].filter(Boolean);
    const subtitleLine = subtitleParts.join('  |  ');
    pushMergedRow(
      subtitleLine,
      {
        font: { name: 'Calibri', sz: 9.5, color: { rgb: 'FF475569' } },
        alignment: kopCenter,
      },
      computeExcelRowHeight([subtitleLine], [totalSheetWidth], 18)
    );

    pushBlankRow(10);
  }

  if (headers.length > 0) {
    // Table Header Row
    const headerRowIdx = aoa.length;
    aoa.push(headers);
    rowHeights.push({ hpt: 26 });

    headers.forEach((_, c) => {
      setCellStyle(headerRowIdx, c, {
        font: { name: 'Calibri', sz: 10, bold: true, color: { rgb: 'FFFFFFFF' } },
        fill: { patternType: 'solid', fgColor: { rgb: 'FF1E3A5F' } },
        alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
        border: {
          top: { style: 'medium', color: { rgb: 'FF0F172A' } },
          bottom: { style: 'medium', color: { rgb: 'FF0F172A' } },
          left: { style: c === 0 ? 'medium' : 'thin', color: { rgb: c === 0 ? 'FF0F172A' : 'FF64748B' } },
          right: {
            style: c === headers.length - 1 ? 'medium' : 'thin',
            color: { rgb: c === headers.length - 1 ? 'FF0F172A' : 'FF64748B' },
          },
        },
      });
    });

    if (dataRows.length === 0) {
      pushMergedRow(
        'Tidak ada data untuk diekspor',
        {
          font: { name: 'Calibri', sz: 10, italic: true, color: { rgb: 'FF64748B' } },
          fill: { patternType: 'solid', fgColor: { rgb: 'FFFFFFFF' } },
          alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
        },
        26,
        {
          allBorders: {
            top: { style: 'thin', color: { rgb: 'FF94A3B8' } },
            bottom: { style: 'medium', color: { rgb: 'FF0F172A' } },
            left: { style: 'medium', color: { rgb: 'FF0F172A' } },
            right: { style: 'medium', color: { rgb: 'FF0F172A' } },
          },
        }
      );
    }

    // Table Body Rows
    dataRows.forEach((rowCells, rowIdx) => {
      const r = aoa.length;
      aoa.push(rowCells);
      rowHeights.push({ hpt: computeExcelRowHeight(rowCells, colWidths, 21) });

      const rowBg = rowIdx % 2 === 1 ? 'FFF8FAFC' : 'FFFFFFFF';
      const isLastBodyRow = !summaryRow && rowIdx === dataRows.length - 1;
      rowCells.forEach((cellVal, c) => {
        const normHeader = headers[c].trim().toLowerCase();
        const statusFont = getStatusCellFont(headers[c], cellVal);
        const isNumericSumCol =
          typeof cellVal === 'number' && normHeader !== 'no';
        const isCodeTextCol = normHeader === 'nis' || normHeader === 'nisn' || normHeader === 'hp siswa' || normHeader === 'hp orang tua';
        setCellStyle(r, c, {
          font: statusFont || { name: 'Calibri', sz: 10, color: { rgb: 'FF1E293B' } },
          fill: { patternType: 'solid', fgColor: { rgb: rowBg } },
          alignment: {
            horizontal: alignments[c] || 'left',
            vertical: 'center',
            wrapText: true,
          },
          border: {
            top: { style: 'thin', color: { rgb: 'FF94A3B8' } },
            bottom: {
              style: isLastBodyRow ? 'medium' : 'thin',
              color: { rgb: isLastBodyRow ? 'FF0F172A' : 'FF94A3B8' },
            },
            left: {
              style: c === 0 ? 'medium' : 'thin',
              color: { rgb: c === 0 ? 'FF0F172A' : 'FF94A3B8' },
            },
            right: {
              style: c === headers.length - 1 ? 'medium' : 'thin',
              color: { rgb: c === headers.length - 1 ? 'FF0F172A' : 'FF94A3B8' },
            },
          },
          ...(isNumericSumCol ? { numFmt: '#,##0' } : isCodeTextCol ? { numFmt: '@' } : {}),
        });
      });
    });

    // Optional Summary Row
    if (summaryRow) {
      const sumRowIdx = aoa.length;
      aoa.push(summaryRow);
      rowHeights.push({ hpt: 23 });

      const firstNumIdx = summaryRow.findIndex((val) => typeof val === 'number');
      if (firstNumIdx > 1) {
        merges.push({ s: { r: sumRowIdx, c: 0 }, e: { r: sumRowIdx, c: firstNumIdx - 1 } });
      }

      summaryRow.forEach((val, c) => {
        const isNumeric = typeof val === 'number';
        setCellStyle(sumRowIdx, c, {
          font: { name: 'Calibri', sz: 10, bold: true, color: { rgb: 'FF0F172A' } },
          fill: { patternType: 'solid', fgColor: { rgb: 'FFEEF2F7' } },
          alignment: {
            horizontal: isNumeric ? alignments[c] || 'center' : 'left',
            vertical: 'center',
            wrapText: true,
          },
          border: {
            top: { style: 'medium', color: { rgb: 'FF1E3A5F' } },
            bottom: { style: 'double', color: { rgb: 'FF1E3A5F' } },
            left: {
              style: c === 0 ? 'medium' : 'thin',
              color: { rgb: c === 0 ? 'FF0F172A' : 'FF94A3B8' },
            },
            right: {
              style: c === headers.length - 1 ? 'medium' : 'thin',
              color: { rgb: c === headers.length - 1 ? 'FF0F172A' : 'FF94A3B8' },
            },
          },
          ...(isNumeric ? { numFmt: '#,##0' } : {}),
        });
      });
    }
  } else {
    pushMergedRow(
      'Tidak ada data untuk diekspor',
      {
        font: { name: 'Calibri', sz: 10, italic: true, color: { rgb: 'FF64748B' } },
        alignment: { horizontal: 'center', vertical: 'center' },
        border: {
          top: { style: 'thin', color: { rgb: 'FF94A3B8' } },
          bottom: { style: 'thin', color: { rgb: 'FF94A3B8' } },
          left: { style: 'thin', color: { rgb: 'FF94A3B8' } },
          right: { style: 'thin', color: { rgb: 'FF94A3B8' } },
        },
      },
      26
    );
  }

  // Dual Signature Block below table when settings are provided
  if (meta?.settings && sheetColCount >= 2) {
    pushBlankRow(14);

    const cityPrefix = extractCityPrefixFromAddress(meta.settings.schoolAddress);
    const formattedDate = formatDateLong(getTodayISO());
    const dateLine = cityPrefix ? `${cityPrefix}, ${formattedDate}` : formattedDate;
    const counselorDisplay = resolveSignatureCounselorName(meta.counselorName);

    const leftEnd = Math.max(0, Math.floor(sheetColCount / 2) - 1);
    const rightStart = Math.min(
      sheetColCount - 1,
      Math.max(leftEnd + 1, Math.ceil(sheetColCount / 2))
    );

    const pushSignatureRow = (leftText: string, rightText: string, heightPt: number, bold = false) => {
      const r = aoa.length;
      const rowArr: Array<string | number> = Array(sheetColCount).fill('');
      rowArr[0] = leftText;
      rowArr[rightStart] = rightText;
      aoa.push(rowArr);
      rowHeights.push({ hpt: heightPt });

      if (leftEnd > 0) merges.push({ s: { r, c: 0 }, e: { r, c: leftEnd } });
      if (sheetColCount - 1 > rightStart) {
        merges.push({ s: { r, c: rightStart }, e: { r, c: sheetColCount - 1 } });
      }

      const sigFont: ExcelCellStyle['font'] = {
        name: 'Calibri',
        sz: 10,
        bold,
        color: { rgb: 'FF0F172A' },
      };
      for (let c = 0; c <= leftEnd; c += 1) {
        setCellStyle(r, c, {
          font: sigFont,
          alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
        });
      }
      for (let c = rightStart; c < sheetColCount; c += 1) {
        setCellStyle(r, c, {
          font: sigFont,
          alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
        });
      }
    };

    pushSignatureRow('Mengetahui,', dateLine, 18);
    pushSignatureRow('Kepala Sekolah,', 'Guru Bimbingan dan Konseling,', 18);
    pushBlankRow(42);
    pushSignatureRow(
      meta.settings.principalName || '........................................',
      counselorDisplay,
      18,
      true
    );
    pushSignatureRow(`NIP. ${meta.settings.principalNip || '-'}`, '', 16);
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);

  // Attach cell styles to every styled cell address
  cellStyles.forEach((style, addr) => {
    if (!ws[addr]) {
      ws[addr] = { t: 's', v: '' };
    }
    ws[addr].s = style;
  });

  ws['!cols'] = colWidths.map((wch) => ({ wch }));
  ws['!rows'] = rowHeights;
  if (merges.length > 0) {
    ws['!merges'] = merges;
  }
  ws['!margins'] = { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.25, footer: 0.25 };
  ws['!pageSetup'] = {
    orientation: sheetColCount > 5 ? 'landscape' : 'portrait',
    paperSize: 9,
    fitToWidth: 1,
    fitToHeight: 0,
  };
  ws['!sheetPr'] = { pageSetUpPr: { fitToPage: true } };

  return ws;
}

export function exportToExcel(
  rows: Array<Record<string, unknown>>,
  fileName: string,
  sheetName = 'Data',
  meta?: ExcelExportMeta
) {
  const wb = XLSX.utils.book_new();
  const ws = buildStyledReportWorksheet(rows, meta);
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
  XLSX.writeFile(wb, `${sanitizeExportFileName(fileName)}.xlsx`);
}

export function downloadStudentImportTemplate(className: string, academicYear: string): void {
  const wb = XLSX.utils.book_new();
  const entryYear = academicYear.split('/')[0] || String(new Date().getFullYear());

  const templateRows = [
    {
      NIS: '2026001',
      NISN: '0012345678',
      'Nama Lengkap': 'Contoh Nama Siswa (Hapus baris ini)',
      'Jenis Kelamin': 'Laki-laki',
      'Tempat Lahir': 'Jakarta',
      'Tanggal Lahir': '2012-05-14',
      Agama: 'Islam',
      Alamat: 'Jl. Merdeka No. 10',
      'HP Siswa': '081234567890',
      'Nama Ayah': 'Budi Santoso',
      'Nama Ibu': 'Siti Aminah',
      'Nama Wali': '',
      'HP Orang Tua': '081298765432',
      'Alamat Orang Tua': 'Jl. Merdeka No. 10',
      'Tahun Masuk': entryYear,
      Catatan: '',
    },
  ];

  const ws = XLSX.utils.json_to_sheet(templateRows);
  const headers = Object.keys(templateRows[0]);
  ws['!cols'] = headers.map((h) => ({
    wch: Math.max(h.length + 4, h === 'Nama Lengkap' || h === 'Alamat' ? 28 : 16),
  }));
  XLSX.utils.book_append_sheet(wb, ws, `Siswa_${className}`.slice(0, 31));

  const guideRows = [
    { Kolom: 'NIS', Wajib: 'Ya', Format_Contoh: '2026001', Keterangan: 'Nomor Induk Siswa (identitas utama)' },
    { Kolom: 'NISN', Wajib: 'Opsional', Format_Contoh: '0012345678', Keterangan: 'Nomor Induk Siswa Nasional' },
    { Kolom: 'Nama Lengkap', Wajib: 'Ya', Format_Contoh: 'Ahmad Fauzi', Keterangan: 'Nama lengkap sesuai dokumen resmi' },
    { Kolom: 'Jenis Kelamin', Wajib: 'Ya', Format_Contoh: 'Laki-laki / Perempuan', Keterangan: 'Isi Laki-laki atau Perempuan (L/P juga dikenali)' },
    { Kolom: 'Tempat Lahir', Wajib: 'Opsional', Format_Contoh: 'Bandung', Keterangan: 'Kota/kabupaten tempat lahir' },
    { Kolom: 'Tanggal Lahir', Wajib: 'Opsional', Format_Contoh: '2012-05-14', Keterangan: 'Format YYYY-MM-DD' },
    { Kolom: 'Agama', Wajib: 'Opsional', Format_Contoh: 'Islam', Keterangan: 'Islam, Kristen, Katolik, Hindu, Buddha, Konghucu' },
    { Kolom: 'Alamat', Wajib: 'Opsional', Format_Contoh: 'Jl. Merdeka No. 10', Keterangan: 'Alamat tempat tinggal siswa' },
    { Kolom: 'HP Siswa', Wajib: 'Opsional', Format_Contoh: '081234567890', Keterangan: 'Nomor HP/WA aktif siswa' },
    { Kolom: 'Nama Ayah / Ibu / Wali', Wajib: 'Opsional', Format_Contoh: 'Budi Santoso', Keterangan: 'Nama orang tua atau wali siswa' },
    { Kolom: 'HP Orang Tua', Wajib: 'Opsional', Format_Contoh: '081298765432', Keterangan: 'Nomor HP/WA orang tua untuk pemanggilan BK' },
    { Kolom: 'Tahun Masuk', Wajib: 'Opsional', Format_Contoh: entryYear, Keterangan: 'Tahun masuk siswa' },
    { Kolom: 'Catatan', Wajib: 'Opsional', Format_Contoh: '-', Keterangan: 'Catatan tambahan awal siswa' },
  ];
  const wsGuide = XLSX.utils.json_to_sheet(guideRows);
  wsGuide['!cols'] = [{ wch: 24 }, { wch: 12 }, { wch: 24 }, { wch: 46 }];
  XLSX.utils.book_append_sheet(wb, wsGuide, 'Panduan Pengisian');

  const safeClass = className.replace(/[^a-zA-Z0-9.-]/g, '_');
  XLSX.writeFile(wb, `Template_Import_Siswa_Kelas_${safeClass}.xlsx`);
}

export async function parseStudentsExcel(
  file: File,
  defaultClassId: string,
  defaultClassName: string,
  academicYear: string
): Promise<Array<Omit<Student, 'id'>>> {
  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(buffer, { type: 'array' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);

  return rawRows
    .map((r) => {
      const genderRaw = String(r['Jenis Kelamin'] || r['gender'] || 'Laki-laki');
      const gender: 'Laki-laki' | 'Perempuan' = genderRaw.toLowerCase().startsWith('p')
        ? 'Perempuan'
        : 'Laki-laki';
      return {
        nis: String(r['NIS'] || r['nis'] || '').trim(),
        nisn: String(r['NISN'] || r['nisn'] || '').trim(),
        fullName: String(r['Nama Lengkap'] || r['Nama'] || r['fullName'] || '').trim(),
        gender,
        birthPlace: String(r['Tempat Lahir'] || r['birthPlace'] || '').trim(),
        birthDate: String(r['Tanggal Lahir'] || r['birthDate'] || '').trim(),
        religion: String(r['Agama'] || r['religion'] || '').trim(),
        classId: defaultClassId,
        className: defaultClassName,
        address: String(r['Alamat'] || r['address'] || '').trim(),
        studentPhone: String(r['HP Siswa'] || r['studentPhone'] || '').trim(),
        fatherName: String(r['Nama Ayah'] || r['fatherName'] || '').trim(),
        motherName: String(r['Nama Ibu'] || r['motherName'] || '').trim(),
        guardianName: String(r['Nama Wali'] || r['guardianName'] || '').trim(),
        parentPhone: String(r['HP Orang Tua'] || r['parentPhone'] || '').trim(),
        parentAddress: String(r['Alamat Orang Tua'] || r['parentAddress'] || '').trim(),
        entryYear: String(r['Tahun Masuk'] || r['entryYear'] || academicYear.split('/')[0] || '2026').trim(),
        status: 'Aktif' as const,
        notes: String(r['Catatan'] || r['notes'] || '').trim(),
        monitoringStatus: 'Normal' as const,
        caseCount: 0,
        academicYear,
      };
    })
    .filter((s) => s.nis && s.fullName);
}

/**
 * Draws a formal Indonesian school letterhead (Kop Surat) with optional school logo.
 * Preserves logo aspect ratio, vertically centers logo and text block, and draws a double-line Kop divider.
 */
function drawSchoolLetterhead(doc: jsPDF, settings: SystemSettings): number {
  const pageWidth = doc.internal.pageSize.getWidth();
  const marginX = 14;
  const maxLogoBox = 22;
  const topY = 10;
  const hasLogo = Boolean(settings.schoolLogoUrl);

  const safeLeft = hasLogo ? marginX + maxLogoBox + 5 : marginX;
  const safeRight = pageWidth - marginX;
  const kop = buildSchoolKopTextLines(settings);

  const measureKopWidth = (text: string, fontSize: number, fontStyle: 'bold' | 'normal') => {
    if (!text) return 0;
    doc.setFont('helvetica', fontStyle);
    doc.setFontSize(fontSize);
    return doc.getTextWidth(text);
  };

  const mainKopWidth = Math.max(
    measureKopWidth(kop.line1, 10, 'bold'),
    measureKopWidth(kop.line2, 10.5, 'bold'),
    measureKopWidth(kop.line3, 14, 'bold')
  );

  const symmetricWidth = Math.max((pageWidth / 2 - safeLeft) * 2, 0);
  const fitsDeadCenter = !hasLogo || mainKopWidth <= symmetricWidth;
  const textCenterX = fitsDeadCenter ? pageWidth / 2 : (safeLeft + safeRight) / 2;
  const textMaxWidth = fitsDeadCenter
    ? Math.max(symmetricWidth, 80)
    : Math.max(safeRight - safeLeft, 80);

  const lineSpecs: Array<{
    text: string;
    fontSize: number;
    fontStyle: 'bold' | 'normal' | 'italic';
    color: [number, number, number];
    lineHeight: number;
  }> = [
    { text: kop.line1, fontSize: 10, fontStyle: 'bold', color: [30, 41, 59], lineHeight: 4.4 },
    { text: kop.line2, fontSize: 10.5, fontStyle: 'bold', color: [15, 23, 42], lineHeight: 4.7 },
    { text: kop.line3, fontSize: 14, fontStyle: 'bold', color: [15, 23, 42], lineHeight: 5.8 },
    { text: kop.line4, fontSize: 8.5, fontStyle: 'normal', color: [51, 65, 85], lineHeight: 3.9 },
  ];
  if (kop.line5) {
    lineSpecs.push({
      text: kop.line5,
      fontSize: 8,
      fontStyle: 'italic',
      color: [71, 85, 105],
      lineHeight: 3.6,
    });
  }

  const wrappedLines = lineSpecs
    .filter((spec) => Boolean(spec.text))
    .map((spec) => {
      doc.setFont('helvetica', spec.fontStyle);
      doc.setFontSize(spec.fontSize);
      const lines = doc.splitTextToSize(spec.text, textMaxWidth) as string[];
      return { ...spec, lines, blockHeight: lines.length * spec.lineHeight };
    });

  const totalTextHeight = wrappedLines.reduce((acc, item) => acc + item.blockHeight, 0);
  const blockHeight = Math.max(totalTextHeight, hasLogo ? maxLogoBox : 0);

  if (hasLogo && settings.schoolLogoUrl) {
    try {
      const props = doc.getImageProperties(settings.schoolLogoUrl);
      const imgW = props.width || maxLogoBox;
      const imgH = props.height || maxLogoBox;
      const scale = Math.min(maxLogoBox / imgW, maxLogoBox / imgH);
      const drawW = imgW * scale;
      const drawH = imgH * scale;
      const drawX = marginX + (maxLogoBox - drawW) / 2;
      const drawY = topY + (blockHeight - drawH) / 2;
      const imgFormat = settings.schoolLogoUrl.startsWith('data:image/png') ? 'PNG' : 'JPEG';
      doc.addImage(settings.schoolLogoUrl, imgFormat, drawX, drawY, drawW, drawH);
    } catch {
      // Ignore invalid logo image gracefully
    }
  }

  let y = topY + Math.max(0, (blockHeight - totalTextHeight) / 2) + 3.4;
  wrappedLines.forEach((item) => {
    doc.setFont('helvetica', item.fontStyle);
    doc.setFontSize(item.fontSize);
    doc.setTextColor(...item.color);
    doc.text(item.lines, textCenterX, y, { align: 'center' });
    y += item.blockHeight;
  });

  const dividerY = topY + blockHeight + 2.5;

  // Formal double-line Kop Surat divider
  doc.setDrawColor(15, 23, 42);
  doc.setLineWidth(0.95);
  doc.line(marginX, dividerY, pageWidth - marginX, dividerY);
  doc.setLineWidth(0.3);
  doc.line(marginX, dividerY + 1.35, pageWidth - marginX, dividerY + 1.35);

  doc.setTextColor(15, 23, 42);
  return dividerY + 7.5;
}

/**
 * Stamps accurate "Halaman X dari Y" footers on every page after all content is rendered.
 */
function applyPdfPageFooters(doc: jsPDF, schoolName: string, marginX = 14) {
  const totalPages = doc.getNumberOfPages();
  for (let page = 1; page <= totalPages; page += 1) {
    doc.setPage(page);
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.25);
    doc.line(marginX, pageHeight - 12, pageWidth - marginX, pageHeight - 12);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    doc.text(
      `${schoolName || 'Sekolah'} — Sistem Informasi Bimbingan dan Konseling (SIBK)`,
      marginX,
      pageHeight - 7.5
    );
    doc.text(`Halaman ${page} dari ${totalPages}`, pageWidth - marginX, pageHeight - 7.5, {
      align: 'right',
    });
  }
}

function drawDualSignatureBlock(params: {
  doc: jsPDF;
  startY: number;
  marginX: number;
  settings: SystemSettings;
  counselorName?: string;
  dateISO?: string;
}) {
  const { doc, marginX, settings, counselorName, dateISO } = params;
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  let sigY = params.startY;
  if (sigY + 38 > pageHeight - 16) {
    doc.addPage();
    sigY = 24;
  }

  const cityPrefix = extractCityPrefixFromAddress(settings.schoolAddress);
  const formattedDate = formatDateLong(dateISO || getTodayISO());
  const dateLine = cityPrefix ? `${cityPrefix}, ${formattedDate}` : formattedDate;
  const leftCenterX = marginX + 42;
  const rightCenterX = pageWidth - marginX - 42;

  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);

  // Left: Principal (centered symmetrically)
  doc.text('Mengetahui,', leftCenterX, sigY, { align: 'center' });
  doc.text('Kepala Sekolah,', leftCenterX, sigY + 5, { align: 'center' });
  doc.setFont('helvetica', 'bold');
  doc.text(settings.principalName || '........................................', leftCenterX, sigY + 25, {
    align: 'center',
  });
  doc.setFont('helvetica', 'normal');
  doc.text(`NIP. ${settings.principalNip || '-'}`, leftCenterX, sigY + 30, { align: 'center' });

  // Right: Active BK Counselor (centered symmetrically)
  doc.text(dateLine, rightCenterX, sigY, { align: 'center' });
  doc.text('Guru Bimbingan dan Konseling,', rightCenterX, sigY + 5, { align: 'center' });
  doc.setFont('helvetica', 'bold');
  doc.text(resolveSignatureCounselorName(counselorName), rightCenterX, sigY + 25, {
    align: 'center',
  });
}

export function exportTableToPDF(
  title: string,
  subtitle: string,
  columns: string[],
  rows: Array<Array<string | number>>,
  settings: SystemSettings,
  fileName: string,
  options?: { counselorName?: string }
) {
  const orientation = columns.length > 6 ? 'landscape' : 'portrait';
  const doc = new jsPDF({ orientation });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = 14;
  const contentMaxWidth = pageWidth - marginX * 2;

  let cursorY = drawSchoolLetterhead(doc, settings);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11.5);
  doc.setTextColor(15, 23, 42);
  const titleLines = doc.splitTextToSize(title.toUpperCase(), contentMaxWidth) as string[];
  doc.text(titleLines, pageWidth / 2, cursorY, { align: 'center' });
  cursorY += titleLines.length * 5;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(71, 85, 105);
  const hasAcademicYear = subtitle.toLowerCase().includes('tahun ajaran');
  const metaParts = [
    subtitle,
    !hasAcademicYear && settings.activeAcademicYear
      ? `Tahun Ajaran ${settings.activeAcademicYear} (${settings.activeSemester})`
      : '',
    `Dicetak: ${formatDateLong(getTodayISO())}`,
  ].filter(Boolean);
  const metaLine = metaParts.join('  ·  ');
  const subtitleLines = doc.splitTextToSize(metaLine, contentMaxWidth) as string[];
  doc.text(subtitleLines, pageWidth / 2, cursorY, { align: 'center' });
  cursorY += subtitleLines.length * 4.2 + 3.5;

  const colHints = inferPdfColumnStyles(columns, orientation);
  const columnStyles: Record<number, { halign?: 'left' | 'center' | 'right'; cellWidth?: number }> = {};
  Object.entries(colHints).forEach(([idx, hint]) => {
    columnStyles[Number(idx)] = hint;
  });

  const statusColIndex = columns.findIndex((c) => c.trim().toLowerCase() === 'status');
  const noColIndex = columns.findIndex((c) => c.trim().toLowerCase() === 'no');

  autoTable(doc, {
    startY: cursorY,
    theme: 'grid',
    margin: { left: marginX, right: marginX, bottom: 20 },
    tableWidth: contentMaxWidth,
    tableLineColor: [51, 65, 85],
    tableLineWidth: 0.3,
    head: [columns],
    body:
      rows.length > 0
        ? rows
        : [
            [
              {
                content: 'Tidak ada data untuk filter / periode ini.',
                colSpan: columns.length,
                styles: {
                  halign: 'center',
                  fontStyle: 'italic',
                  textColor: [100, 116, 139],
                },
              },
            ],
          ],
    styles: {
      fontSize: 8.2,
      cellPadding: 2.6,
      lineColor: [148, 163, 184],
      lineWidth: 0.25,
      textColor: [30, 41, 59],
      valign: 'middle',
      overflow: 'linebreak',
    },
    headStyles: {
      fillColor: [30, 58, 95],
      textColor: 255,
      fontStyle: 'bold',
      halign: 'center',
      valign: 'middle',
      lineColor: [71, 85, 105],
      lineWidth: 0.25,
      minCellHeight: 8.5,
    },
    columnStyles,
    alternateRowStyles: { fillColor: [248, 250, 252] },
    didParseCell: (data) => {
      if (data.section !== 'body') return;
      if (data.column.index === noColIndex) {
        data.cell.styles.textColor = [71, 85, 105];
      }
      if (data.column.index === statusColIndex) {
        const text = String(data.cell.raw ?? '').trim();
        if (text === 'Alpa') {
          data.cell.styles.textColor = [185, 28, 28];
          data.cell.styles.fontStyle = 'bold';
        } else if (text === 'Sakit') {
          data.cell.styles.textColor = [3, 105, 161];
          data.cell.styles.fontStyle = 'bold';
        } else if (text === 'Izin') {
          data.cell.styles.textColor = [180, 83, 9];
          data.cell.styles.fontStyle = 'bold';
        } else if (text === 'Hadir' || text === 'Dispensasi' || text === 'Selesai' || text === 'Aktif') {
          data.cell.styles.textColor = [4, 120, 87];
          data.cell.styles.fontStyle = 'bold';
        }
      }
    },
  });

  let lastY =
    (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ||
    cursorY + 24;

  // Compact report summary strip right under the table
  const summaryText = buildTablePdfSummaryText(columns, rows);
  const summaryLines = doc.splitTextToSize(summaryText, contentMaxWidth - 6) as string[];
  const summaryHeight = Math.max(7.5, summaryLines.length * 4 + 3.5);

  if (lastY + summaryHeight + 8 > pageHeight - 16) {
    doc.addPage();
    lastY = 18;
  }

  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(148, 163, 184);
  doc.setLineWidth(0.25);
  doc.roundedRect(marginX, lastY + 4, contentMaxWidth, summaryHeight, 1.5, 1.5, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(30, 58, 95);
  doc.text(summaryLines, marginX + 3, lastY + 8.5);

  drawDualSignatureBlock({
    doc,
    startY: lastY + summaryHeight + 14,
    marginX,
    settings,
    counselorName: options?.counselorName,
  });

  applyPdfPageFooters(doc, settings.schoolName, marginX);
  doc.save(`${sanitizeExportFileName(fileName)}.pdf`);
}

export function exportParentCallLetterPDF(
  call: ParentCall,
  settings: SystemSettings,
  options?: { counselorName?: string }
) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = 20;
  const maxTextWidth = pageWidth - marginX * 2;
  const minutes = getParentCallLetterMinutes(call);

  let y = drawSchoolLetterhead(doc, settings) + 2;

  // Meta Surat (aligned colons + date on right)
  doc.setFontSize(10);
  doc.setTextColor(15, 23, 42);
  const metaColonX = marginX + 20;
  const metaValX = metaColonX + 3;

  doc.setFont('helvetica', 'normal');
  doc.text('Nomor', marginX, y);
  doc.text(':', metaColonX, y);
  doc.setFont('helvetica', 'bold');
  doc.text(call.letterNumber || '-', metaValX, y);

  const cityPrefix = extractCityPrefixFromAddress(settings.schoolAddress);
  const letterDateText = formatDateLong(call.callDate || getTodayISO());
  doc.setFont('helvetica', 'normal');
  doc.text(cityPrefix ? `${cityPrefix}, ${letterDateText}` : letterDateText, pageWidth - marginX, y, {
    align: 'right',
  });
  y += 5.5;

  doc.text('Lampiran', marginX, y);
  doc.text(':', metaColonX, y);
  doc.text('-', metaValX, y);
  y += 5.5;

  doc.text('Perihal', marginX, y);
  doc.text(':', metaColonX, y);
  doc.setFont('helvetica', 'bold');
  doc.text('Undangan Pemanggilan Orang Tua / Wali Siswa', metaValX, y);
  y += 12;

  // Tujuan Surat
  doc.setFont('helvetica', 'normal');
  doc.text('Kepada Yth.', marginX, y);
  y += 5.5;
  doc.setFont('helvetica', 'bold');
  doc.text(`Bapak/Ibu ${call.parentName || 'Orang Tua / Wali Siswa'}`, marginX, y);
  y += 5.5;
  doc.setFont('helvetica', 'normal');
  const studentTargetLines = doc.splitTextToSize(
    `Orang Tua / Wali dari ${call.studentName} (Kelas ${call.className})`,
    maxTextWidth
  );
  doc.text(studentTargetLines, marginX, y);
  y += studentTargetLines.length * 5.2;
  doc.text('Di Tempat', marginX, y);
  y += 10;

  // Paragraf Pembuka
  const intro =
    'Dengan hormat,\nSehubungan dengan pembinaan, pendampingan, dan koordinasi perkembangan peserta didik di sekolah, bersama ini kami mengharap kehadiran Bapak/Ibu Orang Tua/Wali siswa pada:';
  const introLines = doc.splitTextToSize(intro, maxTextWidth);
  doc.text(introLines, marginX, y);
  y += introLines.length * 5.2 + 4;

  // Rincian Pertemuan (dynamic height & aligned colons)
  const detailLabelX = marginX + 6;
  const detailColonX = marginX + 44;
  const detailValueX = detailColonX + 3;
  const detailValueMaxWidth = pageWidth - marginX - detailValueX;

  const drawDetailRow = (label: string, value: string, boldValue = false) => {
    const lines = doc.splitTextToSize(value || '-', detailValueMaxWidth);
    if (y + lines.length * 5.2 > pageHeight - 30) {
      doc.addPage();
      y = 22;
    }
    doc.setFont('helvetica', 'normal');
    doc.text(label, detailLabelX, y);
    doc.text(':', detailColonX, y);
    doc.setFont('helvetica', boldValue ? 'bold' : 'normal');
    doc.text(lines, detailValueX, y);
    y += Math.max(lines.length * 5.2, 5.2) + 1.5;
  };

  drawDetailRow('Hari / Tanggal / Jam', minutes.formattedSchedule, true);
  drawDetailRow('Tempat', `Ruang Bimbingan dan Konseling ${settings.schoolName}`);
  drawDetailRow('Keperluan / Alasan', call.reason || '-');
  y += 4;

  // Paragraf Penutup (dynamic after reason)
  const closing =
    'Mengingat pentingnya pertemuan ini demi kebaikan dan perkembangan putra/putri Bapak/Ibu, kami sangat mengharapkan kehadiran tepat pada waktunya. Atas perhatian dan kerja sama Bapak/Ibu, kami ucapkan terima kasih.';
  const closingLines = doc.splitTextToSize(closing, maxTextWidth);
  if (y + closingLines.length * 5.2 > pageHeight - 50) {
    doc.addPage();
    y = 22;
  }
  doc.setFont('helvetica', 'normal');
  doc.text(closingLines, marginX, y);
  y += closingLines.length * 5.2 + 8;

  // Optional Meeting Minutes Box when status is Hadir / Selesai and results exist
  if (minutes.hasMeetingMinutes) {
    const boxLines: Array<{ label: string; value: string }> = [
      { label: 'Status Kehadiran', value: call.status },
    ];
    if (minutes.meetingResult) {
      boxLines.push({ label: 'Hasil Pertemuan', value: minutes.meetingResult });
    }
    if (minutes.agreement) {
      boxLines.push({ label: 'Kesepakatan', value: minutes.agreement });
    }
    if (minutes.followUpNote) {
      boxLines.push({ label: 'Tindak Lanjut', value: minutes.followUpNote });
    }

    const boxPadding = 4;
    const labelColW = 34;
    const valMaxW = maxTextWidth - boxPadding * 2 - labelColW - 4;
    let totalLinesCount = 0;
    const wrappedEntries = boxLines.map((entry) => {
      const lines = doc.splitTextToSize(entry.value, valMaxW);
      totalLinesCount += lines.length;
      return { label: entry.label, lines };
    });
    const boxHeight = 10 + totalLinesCount * 4.8 + wrappedEntries.length * 1.5;

    if (y + boxHeight > pageHeight - 48) {
      doc.addPage();
      y = 22;
    }

    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(203, 213, 225);
    doc.setLineWidth(0.35);
    doc.roundedRect(marginX, y, maxTextWidth, boxHeight, 2, 2, 'FD');

    let innerY = y + 6;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.8);
    doc.setTextColor(30, 58, 95);
    doc.text('CATATAN HASIL & KESEPAKATAN PERTEMUAN', marginX + boxPadding, innerY);
    innerY += 5.5;

    doc.setFontSize(8.5);
    doc.setTextColor(30, 41, 59);
    wrappedEntries.forEach((item) => {
      doc.setFont('helvetica', 'bold');
      doc.text(`${item.label}:`, marginX + boxPadding, innerY);
      doc.setFont('helvetica', 'normal');
      doc.text(item.lines, marginX + boxPadding + labelColW, innerY);
      innerY += item.lines.length * 4.8 + 1.5;
    });

    y += boxHeight + 10;
  } else {
    y += 4;
  }

  drawDualSignatureBlock({
    doc,
    startY: y,
    marginX,
    settings,
    counselorName: options?.counselorName,
    dateISO: call.callDate || getTodayISO(),
  });

  applyPdfPageFooters(doc, settings.schoolName, 14);
  doc.save(
    `${sanitizeExportFileName(`Surat_Pemanggilan_${call.studentName}_${call.letterNumber || call.callDate}`)}.pdf`
  );
}

export function exportStudentProfilePDF(params: {
  student: Student;
  attendance: AttendanceRecord[];
  cases: StudentCase[];
  counselingLogs: CounselingLog[];
  parentCalls: ParentCall[];
  monitoringNotes?: MonitoringNote[];
  settings: SystemSettings;
  counselorName?: string;
}) {
  const {
    student,
    attendance,
    cases,
    counselingLogs,
    parentCalls,
    monitoringNotes = [],
    settings,
    counselorName,
  } = params;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = 14;

  let cursorY = drawSchoolLetterhead(doc, settings);

  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('REKAP PROFIL & RIWAYAT BIMBINGAN KONSELING SISWA', pageWidth / 2, cursorY + 3, {
    align: 'center',
  });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(71, 85, 105);
  doc.text(
    `Tahun Ajaran ${settings.activeAcademicYear} · Semester ${settings.activeSemester} · Dicetak ${formatDateLong(getTodayISO())}`,
    pageWidth / 2,
    cursorY + 8,
    { align: 'center' }
  );
  cursorY += 13;

  // A. Biodata Siswa
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(30, 58, 95);
  doc.text('A. BIODATA SISWA', marginX, cursorY);
  cursorY += 2;

  autoTable(doc, {
    startY: cursorY,
    margin: { left: marginX, right: marginX, bottom: 18 },
    theme: 'grid',
    styles: { fontSize: 8.5, cellPadding: 2.2, textColor: [30, 41, 59] },
    columnStyles: {
      0: { fontStyle: 'bold', cellWidth: 36, fillColor: [248, 250, 252] },
      1: { cellWidth: 55 },
      2: { fontStyle: 'bold', cellWidth: 34, fillColor: [248, 250, 252] },
      3: { cellWidth: 'auto' },
    },
    body: [
      ['Nama Lengkap', student.fullName, 'NIS / NISN', `${student.nis} / ${student.nisn || '-'}`],
      ['Kelas / Status', `Kelas ${student.className} (${student.status})`, 'Jenis Kelamin', student.gender],
      [
        'Tempat, Tgl Lahir',
        `${student.birthPlace || '-'}, ${student.birthDate || '-'}`,
        'Agama',
        student.religion || '-',
      ],
      ['Alamat', student.address || '-', 'HP Siswa', student.studentPhone || '-'],
      [
        'Orang Tua / Wali',
        [student.fatherName, student.motherName, student.guardianName].filter(Boolean).join(' / ') || '-',
        'HP Orang Tua',
        student.parentPhone || '-',
      ],
    ],
  });

  cursorY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 7;

  // B. Ringkasan Absensi
  const hadir = attendance.filter((a) => a.status === 'Hadir').length;
  const sakit = attendance.filter((a) => a.status === 'Sakit').length;
  const izin = attendance.filter((a) => a.status === 'Izin').length;
  const alpa = attendance.filter((a) => a.status === 'Alpa').length;
  const dispensasi = attendance.filter((a) => a.status === 'Dispensasi').length;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(30, 58, 95);
  doc.text('B. RINGKASAN ABSENSI', marginX, cursorY);
  cursorY += 2;

  autoTable(doc, {
    startY: cursorY,
    margin: { left: marginX, right: marginX, bottom: 18 },
    theme: 'grid',
    headStyles: { fillColor: [30, 58, 95], textColor: 255, fontSize: 8.5, halign: 'center' },
    bodyStyles: { fontSize: 9, halign: 'center', fontStyle: 'bold' },
    head: [['Hadir', 'Sakit', 'Izin', 'Alpa', 'Dispensasi', 'Total Catatan']],
    body: [[hadir, sakit, izin, alpa, dispensasi, attendance.length]],
  });

  cursorY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 7;

  // C. Riwayat Kasus BK & Konseling
  if (cursorY > pageHeight - 45) {
    doc.addPage();
    cursorY = 18;
  }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(30, 58, 95);
  doc.text(`C. RIWAYAT KASUS BK & KONSELING (${cases.length} Kasus)`, marginX, cursorY);
  cursorY += 2;

  const caseRows =
    cases.length === 0
      ? [['-', 'Belum ada catatan kasus BK', '-', '-', '-']]
      : cases.map((c) => {
          const logsForCase = counselingLogs.filter((l) => l.caseId === c.id);
          const logText =
            logsForCase.length === 0
              ? 'Belum ada sesi konseling'
              : logsForCase
                  .map((l) => {
                    const extras = [
                      l.solution ? `Solusi: ${l.solution}` : '',
                      l.studentCommitment ? `Komitmen: ${l.studentCommitment}` : '',
                    ]
                      .filter(Boolean)
                      .join(' · ');
                    return `[${formatDateShort(l.date)}] ${l.topic}: ${l.result} (${l.progressStatus})${
                      extras ? `\n${extras}` : ''
                    }`;
                  })
                  .join('\n\n');
          return [
            `Ke-${c.caseNumber}`,
            `${formatDateShort(c.date)}\n(${c.dayName})`,
            `${c.category}\n${c.description}`,
            c.status,
            logText,
          ];
        });

  autoTable(doc, {
    startY: cursorY,
    margin: { left: marginX, right: marginX, bottom: 18 },
    theme: 'grid',
    headStyles: { fillColor: [30, 58, 95], textColor: 255, fontSize: 8 },
    styles: { fontSize: 7.8, cellPadding: 2, overflow: 'linebreak' },
    columnStyles: {
      0: { cellWidth: 14, halign: 'center' },
      1: { cellWidth: 24 },
      2: { cellWidth: 54 },
      3: { cellWidth: 26 },
      4: { cellWidth: 'auto' },
    },
    head: [['No', 'Tanggal', 'Kategori & Uraian Kasus', 'Status', 'Riwayat Konseling']],
    body: caseRows,
  });

  cursorY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 7;

  // D. Riwayat Pemanggilan Orang Tua (with Results & Agreement)
  if (cursorY > pageHeight - 55) {
    doc.addPage();
    cursorY = 18;
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(30, 58, 95);
  doc.text(`D. RIWAYAT PEMANGGILAN ORANG TUA (${parentCalls.length} Kali)`, marginX, cursorY);
  cursorY += 2;

  const callRows =
    parentCalls.length === 0
      ? [['-', 'Belum ada riwayat pemanggilan orang tua', '-', '-', '-']]
      : parentCalls.map((p) => {
          const minutes = [
            p.meetingResult ? `Hasil: ${p.meetingResult}` : '',
            p.agreement ? `Kesepakatan: ${p.agreement}` : '',
            p.followUpNote ? `Tindak Lanjut: ${p.followUpNote}` : '',
          ]
            .filter(Boolean)
            .join('\n');
          return [
            `${formatDateShort(p.callDate)}${p.letterNumber ? `\n${p.letterNumber}` : ''}`,
            p.parentName || '-',
            p.reason || '-',
            minutes || '-',
            p.status || '-',
          ];
        });

  autoTable(doc, {
    startY: cursorY,
    margin: { left: marginX, right: marginX, bottom: 18 },
    theme: 'grid',
    headStyles: { fillColor: [30, 58, 95], textColor: 255, fontSize: 8 },
    styles: { fontSize: 7.8, cellPadding: 2, overflow: 'linebreak' },
    columnStyles: {
      0: { cellWidth: 28 },
      1: { cellWidth: 30 },
      2: { cellWidth: 42 },
      3: { cellWidth: 'auto' },
      4: { cellWidth: 24 },
    },
    head: [['Tanggal & No. Surat', 'Orang Tua / Wali', 'Alasan / Keperluan', 'Hasil & Kesepakatan', 'Status']],
    body: callRows,
  });

  cursorY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 7;

  // E. Riwayat Pemantauan Perkembangan Siswa
  if (cursorY > pageHeight - 55) {
    doc.addPage();
    cursorY = 18;
  }

  const sortedNotes = [...monitoringNotes].sort((a, b) => b.date.localeCompare(a.date));
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(30, 58, 95);
  doc.text(`E. RIWAYAT PEMANTAUAN PERKEMBANGAN SISWA (${sortedNotes.length} Catatan)`, marginX, cursorY);
  cursorY += 2;

  const noteRows =
    sortedNotes.length === 0
      ? [['-', 'Belum ada catatan pemantauan perkembangan', '-', '-']]
      : sortedNotes.map((n) => [
          formatDateShort(n.date),
          n.progressLevel,
          n.observation,
          n.counselorName || '-',
        ]);

  autoTable(doc, {
    startY: cursorY,
    margin: { left: marginX, right: marginX, bottom: 18 },
    theme: 'grid',
    headStyles: { fillColor: [30, 58, 95], textColor: 255, fontSize: 8 },
    styles: { fontSize: 7.8, cellPadding: 2, overflow: 'linebreak' },
    columnStyles: {
      0: { cellWidth: 24 },
      1: { cellWidth: 28 },
      2: { cellWidth: 'auto' },
      3: { cellWidth: 34 },
    },
    head: [['Tanggal', 'Perkembangan', 'Catatan Observasi', 'Pendamping']],
    body: noteRows,
  });

  const finalY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 12;

  drawDualSignatureBlock({
    doc,
    startY: finalY,
    marginX,
    settings,
    counselorName,
  });

  applyPdfPageFooters(doc, settings.schoolName, marginX);
  const safeName = sanitizeExportFileName(`Rekap_BK_${student.fullName}_${student.nis}`);
  doc.save(`${safeName}.pdf`);
}
