import type {
  AttendanceRecord,
  Student,
  StudentCase,
  SystemSettings,
} from '../types/sibk';

const INDONESIAN_DAYS = [
  'Minggu',
  'Senin',
  'Selasa',
  'Rabu',
  'Kamis',
  'Jumat',
  'Sabtu',
];

const INDONESIAN_MONTHS = [
  'Januari',
  'Februari',
  'Maret',
  'April',
  'Mei',
  'Juni',
  'Juli',
  'Agustus',
  'September',
  'Oktober',
  'November',
  'Desember',
];

export const DEFAULT_CASE_CATEGORIES = [
  'Kedisiplinan',
  'Kehadiran',
  'Keterlambatan',
  'Perilaku',
  'Perundungan (bullying)',
  'Perselisihan antarsiswa',
  'Pelanggaran tata tertib',
  'Akademik',
  'Sosial',
  'Pribadi',
  'Lainnya',
];

export const DEFAULT_COUNSELORS = [
  'Sari Wulandari, S.Pd.',
  'Dra. Ratna Dewi, M.Pd.',
  'Hendra Kusuma, S.Pd.',
];

export const DEFAULT_SETTINGS: SystemSettings = {
  id: 'global',
  schoolName: 'SMP Negeri 1 Nusantara',
  schoolAddress: 'Jl. Pendidikan No. 45, Kota Nusantara',
  schoolPhone: '(021) 555-0192',
  principalName: 'Drs. Hendra Wijaya, M.Pd.',
  principalNip: '196805121994031008',
  activeAcademicYear: '2026/2027',
  activeSemester: 'Ganjil',
  warningThreshold1: 2,
  warningThreshold2: 3,
  maxCaseThreshold: 4,
  reportNumberFormat: '421.3/{NO}/BK/{BULAN}/{TAHUN}',
  categories: DEFAULT_CASE_CATEGORIES,
  counselors: DEFAULT_COUNSELORS,
};

/**
 * Returns Indonesian day name from YYYY-MM-DD date string.
 */
export function getIndonesianDayName(dateStr: string): string {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return '-';
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return INDONESIAN_DAYS[dt.getDay()] ?? '-';
}

/**
 * Formats YYYY-MM-DD to DD/MM/YYYY.
 */
export function formatDateShort(dateStr: string): string {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr || '-';
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
}

/**
 * Formats YYYY-MM-DD to Indonesian long format (e.g. 18 November 2026).
 */
export function formatDateLong(dateStr: string): string {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr || '-';
  const [y, m, d] = dateStr.split('-').map(Number);
  const monthName = INDONESIAN_MONTHS[m - 1] ?? '';
  return `${d} ${monthName} ${y}`;
}

/**
 * Deterministic ID for daily attendance to prevent duplicate entries for the same student on the same date.
 */
export function buildAttendanceId(date: string, studentId: string): string {
  const safeDate = date.replace(/[^0-9-]/g, '');
  const safeStudent = studentId.replace(/[^a-zA-Z0-9_-]/g, '');
  return `${safeDate}_${safeStudent}`;
}

/**
 * Computes the next sequential case number for a specific student (by studentId, never by name).
 */
export function getNextCaseNumber(studentId: string, existingCases: StudentCase[]): number {
  const studentCases = existingCases.filter((c) => c.studentId === studentId);
  if (studentCases.length === 0) return 1;
  const maxNum = studentCases.reduce((acc, c) => Math.max(acc, c.caseNumber || 0), 0);
  return maxNum + 1;
}

/**
 * Resolves the next sequential case number inside a Firestore transaction by combining
 * the authoritative server student.caseCount (which increments atomically under retry)
 * with any locally known case count when legacy records were out of sync.
 */
export function computeNextCaseNumberInTransaction(
  serverCaseCount: number | undefined | null,
  localStudentCaseCount: number
): number {
  const serverBase = Math.max(0, Number(serverCaseCount) || 0);
  const localBase = Math.max(0, Number(localStudentCaseCount) || 0);
  return Math.max(serverBase, localBase) + 1;
}

export type WarningLevel = 'none' | 'warning1' | 'warning2' | 'max';

export interface CaseWarningEvaluation {
  level: WarningLevel;
  label: string;
  recommendations: string[];
}

/**
 * Calculates how many new cases a student has accumulated since their last completed parent call.
 */
export function getCasesSinceLastParentCall(
  totalCases: number,
  caseCountAtLastParentCall?: number
): number {
  const baseline = Math.max(0, caseCountAtLastParentCall || 0);
  return Math.max(0, totalCases - baseline);
}

/**
 * Evaluates whether a student has reached warning thresholds based on configurable school settings.
 */
export function evaluateCaseThreshold(
  caseCount: number,
  settings: Pick<SystemSettings, 'warningThreshold1' | 'warningThreshold2' | 'maxCaseThreshold'>
): CaseWarningEvaluation {
  if (caseCount >= settings.maxCaseThreshold) {
    return {
      level: 'max',
      label: 'Mencapai Batas Maksimal Kasus BK',
      recommendations: [
        'Evaluasi permasalahan siswa secara menyeluruh',
        'Konseling lanjutan dan asesmen mendalam',
        'Koordinasi dengan wali kelas',
        'Pertimbangkan pemanggilan orang tua/wali',
      ],
    };
  }
  if (caseCount >= settings.warningThreshold2) {
    return {
      level: 'warning2',
      label: 'Peringatan Kedua',
      recommendations: [
        'Jadwalkan sesi konseling lanjutan',
        'Koordinasi dengan wali kelas terkait perkembangan siswa',
      ],
    };
  }
  if (caseCount >= settings.warningThreshold1) {
    return {
      level: 'warning1',
      label: 'Peringatan Pertama',
      recommendations: [
        'Lakukan pemantauan berkala dan konseling pencegahan',
      ],
    };
  }
  return {
    level: 'none',
    label: 'Normal',
    recommendations: [],
  };
}

/**
 * Formats an official letter/report number using the school template.
 */
export function formatOfficialNumber(template: string, seq: number, dateStr: string): string {
  const [year, month] = (dateStr || '2026-11-18').split('-');
  const romanMonths = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
  const roman = romanMonths[Math.max(0, Math.min(11, Number(month) - 1))] || 'XI';
  const padded = String(seq).padStart(3, '0');
  return template
    .replace('{NO}', padded)
    .replace('{BULAN}', roman)
    .replace('{TAHUN}', year || '2026');
}

/**
 * Identifies students needing special monitoring based on attendance, repeated cases, thresholds, or active counseling.
 */
export function getStudentsNeedingAttention(
  students: Student[],
  attendance: AttendanceRecord[],
  cases: StudentCase[],
  settings: SystemSettings
): Array<{
  student: Student;
  reasons: string[];
  absenceCount: number;
  caseCount: number;
  activeCases: number;
  warningLevel: WarningLevel;
}> {
  return students
    .filter((s) => s.status === 'Aktif')
    .map((student) => {
      const studentAtt = attendance.filter((a) => a.studentId === student.id);
      const alpaCount = studentAtt.filter((a) => a.status === 'Alpa').length;
      const nonPresentCount = studentAtt.filter((a) => a.status !== 'Hadir').length;
      const studentCases = cases.filter((c) => c.studentId === student.id);
      const caseCount = studentCases.length;
      const activeCases = studentCases.filter(
        (c) => c.status !== 'Selesai'
      ).length;
      const lateCases = studentCases.filter(
        (c) => c.category.toLowerCase().includes('terlambat') || c.category === 'Keterlambatan'
      ).length;
      const evalResult = evaluateCaseThreshold(caseCount, settings);

      const reasons: string[] = [];
      if (evalResult.level === 'max') reasons.push(`Mencapai batas kasus (${caseCount}x)`);
      else if (caseCount >= settings.warningThreshold1) reasons.push(`Kasus berulang (${caseCount}x)`);
      if (alpaCount >= 2 || nonPresentCount >= 4) reasons.push(`Sering tidak hadir (${nonPresentCount}x)`);
      if (lateCases >= 2) reasons.push(`Sering terlambat (${lateCases}x)`);
      if (activeCases > 0) reasons.push(`${activeCases} kasus belum selesai`);
      if (student.monitoringStatus !== 'Normal') reasons.push(`Status: ${student.monitoringStatus}`);

      return {
        student,
        reasons,
        absenceCount: nonPresentCount,
        caseCount,
        activeCases,
        warningLevel: evalResult.level,
      };
    })
    .filter((item) => item.reasons.length > 0)
    .sort((a, b) => b.caseCount - a.caseCount || b.absenceCount - a.absenceCount);
}

/**
 * Generates today's local date in YYYY-MM-DD format.
 */
export function getTodayISO(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
