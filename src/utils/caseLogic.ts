import type {
  CaseStatus,
  CounselingLog,
  ParentCall,
  Student,
  StudentCase,
  SystemSettings,
} from '../types/sibk';
import {
  evaluateCaseThreshold,
  getCasesSinceLastParentCall,
} from './sibkLogic';
import { isParentCallCompleted } from './parentCallLogic';

export const CASE_DESCRIPTION_TEMPLATES = [
  'Terlambat masuk sekolah tanpa keterangan yang sah',
  'Tidak memakai atribut seragam sekolah secara lengkap',
  'Mengganggu ketertiban kelas saat kegiatan belajar mengajar berlangsung',
  'Terlibat perselisihan / pertengkaran dengan teman sebaya',
] as const;

export const CASE_INITIAL_ACTION_TEMPLATES = [
  'Teguran lisan dan pembinaan langsung oleh guru BK',
  'Peringatan tertulis dan dicatat dalam buku pembinaan BK',
  'Koordinasi dengan wali kelas terkait tindak lanjut siswa',
  'Siswa membuat surat pernyataan tidak mengulangi perbuatan',
] as const;

export const COUNSELING_SOLUTION_TEMPLATES = [
  'Pendampingan individu dan refleksi perilaku bersama guru BK',
  'Penerapan target perbaikan kedisiplinan harian selama 1 minggu',
  'Koordinasi pembinaan terpadu bersama wali kelas dan guru mapel',
  'Pembuatan kesepakatan tertulis dan jadwal evaluasi berkala',
] as const;

export const COUNSELING_COMMITMENT_TEMPLATES = [
  'Siswa berjanji tidak mengulangi pelanggaran dan hadir tepat waktu',
  'Siswa bersedia mematuhi seluruh tata tertib sekolah',
  'Siswa bersedia mengikuti sesi evaluasi lanjutan sesuai jadwal',
] as const;

export const COUNSELING_FOLLOWUP_TEMPLATES = [
  'Pantau kehadiran dan sikap di kelas selama 1 minggu',
  'Evaluasi perubahan perilaku bersama wali kelas minggu depan',
  'Lanjutkan ke pemanggilan orang tua bila tidak ada perbaikan',
] as const;

export type CaseFilterStage = 'all' | 'pending' | 'active' | 'done';

export function getCaseStage(status: CaseStatus): Exclude<CaseFilterStage, 'all'> {
  if (status === 'Belum ditangani' || status === 'Perlu tindak lanjut') return 'pending';
  if (status === 'Selesai') return 'done';
  return 'active';
}

/**
 * Finds the most relevant nextEvaluationDate from counseling logs belonging to a case.
 */
export function getLatestEvaluationDateForCase(
  caseId: string,
  counselingLogs: CounselingLog[]
): string {
  const withDates = counselingLogs
    .filter((l) => l.caseId === caseId && /^\d{4}-\d{2}-\d{2}$/.test(l.nextEvaluationDate || ''))
    .sort((a, b) => b.date.localeCompare(a.date));
  return withDates[0]?.nextEvaluationDate || '';
}

export function getCaseEvaluationUrgency(
  c: StudentCase,
  counselingLogs: CounselingLog[],
  todayISO: string
): { dueToday: boolean; overdue: boolean; evaluationDate: string } {
  if (c.status === 'Selesai') {
    return { dueToday: false, overdue: false, evaluationDate: '' };
  }
  const evaluationDate = getLatestEvaluationDateForCase(c.id, counselingLogs);
  if (!evaluationDate) {
    return { dueToday: false, overdue: false, evaluationDate: '' };
  }
  return {
    dueToday: evaluationDate === todayISO,
    overdue: evaluationDate < todayISO,
    evaluationDate,
  };
}

export function buildInitialCounselingTopic(c: StudentCase): string {
  const desc = (c.description || '').trim();
  const shortDesc = desc.length > 140 ? `${desc.slice(0, 137)}...` : desc;
  return shortDesc ? `${c.category}: ${shortDesc}` : c.category;
}

export function canTriggerParentCallFromCase(params: {
  studentCase: StudentCase;
  student?: Student;
  totalStudentCases: number;
  parentCalls: ParentCall[];
  settings: Pick<SystemSettings, 'warningThreshold1' | 'warningThreshold2' | 'maxCaseThreshold'>;
}): boolean {
  const { studentCase, student, totalStudentCases, parentCalls, settings } = params;
  if (studentCase.status === 'Selesai') return false;

  const hasOpenCall = parentCalls.some(
    (p) => p.studentId === studentCase.studentId && !isParentCallCompleted(p.status)
  );
  if (hasOpenCall) return false;

  const cycleCount = getCasesSinceLastParentCall(
    totalStudentCases,
    student?.caseCountAtLastParentCall
  );
  const evalResult = evaluateCaseThreshold(cycleCount, settings);
  return (
    evalResult.level === 'max' ||
    evalResult.level === 'warning2' ||
    studentCase.status === 'Perlu tindak lanjut'
  );
}

export function buildParentCallReasonFromCase(
  studentCase: StudentCase,
  totalStudentCases: number
): string {
  const shortDesc = studentCase.description.trim();
  return `Penanganan ${studentCase.category} (Kasus ke-${studentCase.caseNumber}, total ${totalStudentCases} kasus): ${shortDesc}`;
}

export interface CaseAttentionSummary {
  pendingCases: StudentCase[];
  dueTodayEvaluations: Array<{ studentCase: StudentCase; evaluationDate: string }>;
  overdueEvaluations: Array<{ studentCase: StudentCase; evaluationDate: string }>;
  maxThresholdNeedCall: Array<{ studentCase: StudentCase; student: Student; cycleCount: number }>;
  totalAttentionCount: number;
}

export function computeCaseAttentionSummary(params: {
  cases: StudentCase[];
  counselingLogs: CounselingLog[];
  students: Student[];
  parentCalls: ParentCall[];
  settings: Pick<SystemSettings, 'warningThreshold1' | 'warningThreshold2' | 'maxCaseThreshold'>;
  todayISO: string;
  canViewCounseling: boolean;
}): CaseAttentionSummary {
  const {
    cases,
    counselingLogs,
    students,
    parentCalls,
    settings,
    todayISO,
    canViewCounseling,
  } = params;

  const pendingCases = cases
    .filter((c) => getCaseStage(c.status) === 'pending')
    .sort((a, b) => b.date.localeCompare(a.date));

  const dueTodayEvaluations: Array<{ studentCase: StudentCase; evaluationDate: string }> = [];
  const overdueEvaluations: Array<{ studentCase: StudentCase; evaluationDate: string }> = [];

  if (canViewCounseling) {
    for (const c of cases) {
      const urgency = getCaseEvaluationUrgency(c, counselingLogs, todayISO);
      if (urgency.dueToday) {
        dueTodayEvaluations.push({ studentCase: c, evaluationDate: urgency.evaluationDate });
      } else if (urgency.overdue) {
        overdueEvaluations.push({ studentCase: c, evaluationDate: urgency.evaluationDate });
      }
    }
  }

  const openCallStudents = new Set(
    parentCalls.filter((p) => !isParentCallCompleted(p.status)).map((p) => p.studentId)
  );

  const maxThresholdNeedCall: Array<{
    studentCase: StudentCase;
    student: Student;
    cycleCount: number;
  }> = [];

  for (const stu of students) {
    if (stu.status !== 'Aktif') continue;
    if (openCallStudents.has(stu.id)) continue;

    const stuCases = cases
      .filter((c) => c.studentId === stu.id)
      .sort((a, b) => b.date.localeCompare(a.date) || b.caseNumber - a.caseNumber);
    if (stuCases.length === 0) continue;

    const cycleCount = getCasesSinceLastParentCall(stuCases.length, stu.caseCountAtLastParentCall);
    if (evaluateCaseThreshold(cycleCount, settings).level === 'max') {
      maxThresholdNeedCall.push({
        studentCase: stuCases[0],
        student: stu,
        cycleCount,
      });
    }
  }

  const uniqueAttentionIds = new Set<string>();
  pendingCases.forEach((c) => uniqueAttentionIds.add(c.id));
  dueTodayEvaluations.forEach((item) => uniqueAttentionIds.add(item.studentCase.id));
  overdueEvaluations.forEach((item) => uniqueAttentionIds.add(item.studentCase.id));

  return {
    pendingCases,
    dueTodayEvaluations,
    overdueEvaluations,
    maxThresholdNeedCall,
    totalAttentionCount: uniqueAttentionIds.size,
  };
}

export function buildCasePhotoFileName(params: {
  date: string;
  className: string;
  studentName: string;
  nis: string;
  caseNumber: number;
  category: string;
}): string {
  const slugifySegment = (val: string, maxLen = 35) =>
    val
      .trim()
      .replace(/\s+/g, '-')
      .replace(/[^a-zA-Z0-9-]/g, '')
      .replace(/-+/g, '-')
      .slice(0, maxLen) || 'Data';

  const safeClass = slugifySegment(params.className, 16);
  const safeName = slugifySegment(params.studentName, 35);
  const safeNis = (params.nis || '').replace(/[^a-zA-Z0-9]/g, '') || '0';
  const safeCategory = slugifySegment(params.category, 25);
  return `${params.date}_${safeClass}_${safeName}_NIS${safeNis}_Kasus-${params.caseNumber}_${safeCategory}.jpg`;
}
