import type {
  AttendanceRecord,
  ParentCall,
  ParentCallStatus,
  Student,
  StudentCase,
  SystemSettings,
} from '../types/sibk';
import {
  formatDateLong,
  getCasesSinceLastParentCall,
  getIndonesianDayName,
} from './sibkLogic';

export const PARENT_CALL_REASON_TEMPLATES = [
  'Pelanggaran tata tertib sekolah secara berulang',
  'Ketidakhadiran (Alpa) melebihi batas ketentuan sekolah',
  'Penurunan kedisiplinan dan sikap belajar di kelas',
  'Koordinasi pembinaan karakter & pendampingan bersama orang tua',
] as const;

export const PARENT_CALL_AGREEMENT_TEMPLATES = [
  'Siswa menandatangani surat perjanjian kedisiplinan tertulis',
  'Pemantauan intensif perilaku & kehadiran selama 2 minggu ke depan',
  'Pendampingan dan pengawasan belajar lebih ketat oleh orang tua di rumah',
  'Koordinasi berkala antara wali kelas, guru BK, dan orang tua',
] as const;

export const COMPLETED_CALL_STATUSES: ParentCallStatus[] = ['Hadir', 'Selesai'];

export function isParentCallCompleted(status: ParentCallStatus): boolean {
  return status === 'Hadir' || status === 'Selesai';
}

export function addDaysISO(isoDate: string, days: number): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return isoDate;
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

/**
 * Extracts structured YYYY-MM-DD and HH:mm from either explicit fields or legacy free-text schedule.
 */
export function parseMeetingSchedule(
  meetingSchedule?: string,
  meetingDate?: string,
  meetingTime?: string
): { date: string; time: string } {
  let date = meetingDate && /^\d{4}-\d{2}-\d{2}$/.test(meetingDate) ? meetingDate : '';
  let time = meetingTime && /^\d{2}:\d{2}$/.test(meetingTime) ? meetingTime : '';

  const text = (meetingSchedule || '').trim();
  if (!date && text) {
    const isoMatch = text.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (isoMatch) {
      date = `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
    } else {
      const dmyMatch = text.match(/(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
      if (dmyMatch) {
        const dd = dmyMatch[1].padStart(2, '0');
        const mm = dmyMatch[2].padStart(2, '0');
        const yyyy = dmyMatch[3];
        date = `${yyyy}-${mm}-${dd}`;
      }
    }
  }

  if (!time && text) {
    const timeMatch = text.match(/(\d{1,2})[:.](\d{2})/);
    if (timeMatch) {
      const hh = timeMatch[1].padStart(2, '0');
      const min = timeMatch[2];
      if (Number(hh) >= 0 && Number(hh) <= 23 && Number(min) >= 0 && Number(min) <= 59) {
        time = `${hh}:${min}`;
      }
    }
  }

  return { date, time };
}

/**
 * Formats structured date & time into readable formal Indonesian schedule string for PDF, WA, and UI.
 */
export function formatMeetingScheduleText(
  meetingDate?: string,
  meetingTime?: string,
  fallbackText?: string
): string {
  if (meetingDate && /^\d{4}-\d{2}-\d{2}$/.test(meetingDate)) {
    const dayName = getIndonesianDayName(meetingDate);
    const longDate = formatDateLong(meetingDate);
    const timePart =
      meetingTime && /^\d{2}:\d{2}$/.test(meetingTime) ? ` · ${meetingTime} WIB` : '';
    return `${dayName}, ${longDate}${timePart}`;
  }
  const cleanFallback = (fallbackText || '').trim();
  return cleanFallback || 'Menyesuaikan konfirmasi';
}

/**
 * Normalizes Indonesian phone numbers to 62xxx format for wa.me links.
 */
export function formatWhatsAppPhone(phone?: string): string {
  const digits = (phone || '').replace(/\D/g, '');
  if (!digits || digits.length < 9) return '';
  if (digits.startsWith('62')) return digits;
  if (digits.startsWith('0')) return `62${digits.slice(1)}`;
  if (digits.startsWith('8')) return `62${digits}`;
  return digits;
}

export function buildParentCallWhatsAppMessage(
  call: Pick<
    ParentCall,
    | 'parentName'
    | 'studentName'
    | 'className'
    | 'meetingDate'
    | 'meetingTime'
    | 'meetingSchedule'
    | 'reason'
    | 'letterNumber'
  >,
  schoolName: string
): string {
  const parsed = parseMeetingSchedule(
    call.meetingSchedule,
    call.meetingDate,
    call.meetingTime
  );
  const scheduleDisplay = formatMeetingScheduleText(
    parsed.date,
    parsed.time,
    call.meetingSchedule
  );
  const parentLabel = call.parentName?.trim() ? `Bapak/Ibu ${call.parentName.trim()}` : 'Bapak/Ibu Orang Tua/Wali';
  const lines = [
    `Yth. ${parentLabel},`,
    `Orang Tua/Wali dari *${call.studentName}* (Kelas ${call.className}).`,
    '',
    `Dengan hormat, kami dari Bimbingan dan Konseling *${schoolName}* mengundang Bapak/Ibu untuk hadir pada pertemuan pembinaan peserta didik:`,
    `- Nomor Surat: ${call.letterNumber || '-'}`,
    `- Jadwal: ${scheduleDisplay}`,
    `- Tempat: Ruang BK ${schoolName}`,
    `- Keperluan: ${call.reason}`,
    '',
    'Mengingat pentingnya pendampingan perkembangan putra/putri Bapak/Ibu, kami sangat mengharapkan kehadiran tepat waktu atau konfirmasi apabila berhalangan. Terima kasih.',
  ];
  return lines.join('\n');
}

export function buildParentCallWhatsAppUrl(
  call: Pick<
    ParentCall,
    | 'parentPhone'
    | 'parentName'
    | 'studentName'
    | 'className'
    | 'meetingDate'
    | 'meetingTime'
    | 'meetingSchedule'
    | 'reason'
    | 'letterNumber'
  >,
  schoolName: string
): string {
  const normalized = formatWhatsAppPhone(call.parentPhone);
  if (!normalized) return '';
  const msg = buildParentCallWhatsAppMessage(call, schoolName);
  return `https://wa.me/${normalized}?text=${encodeURIComponent(msg)}`;
}

export type ParentCallReminderBucket =
  | 'today'
  | 'tomorrow'
  | 'overdue'
  | 'reschedule'
  | 'unscheduled'
  | 'upcoming'
  | 'done';

export function getParentCallReminderBucket(
  call: ParentCall,
  todayISO: string
): ParentCallReminderBucket {
  if (isParentCallCompleted(call.status)) return 'done';
  if (call.status === 'Tidak hadir' || call.status === 'Perlu pemanggilan ulang') {
    return 'reschedule';
  }
  const { date } = parseMeetingSchedule(
    call.meetingSchedule,
    call.meetingDate,
    call.meetingTime
  );
  if (!date || call.status === 'Belum dijadwalkan') {
    return 'unscheduled';
  }
  const tomorrowISO = addDaysISO(todayISO, 1);
  if (date < todayISO) return 'overdue';
  if (date === todayISO) return 'today';
  if (date === tomorrowISO) return 'tomorrow';
  return 'upcoming';
}

export type ParentCallFilterStage = 'all' | 'waiting' | 'followup' | 'done';

export function getParentCallFilterStage(
  call: ParentCall,
  todayISO: string
): Exclude<ParentCallFilterStage, 'all'> {
  const bucket = getParentCallReminderBucket(call, todayISO);
  if (bucket === 'done') return 'done';
  if (bucket === 'overdue' || bucket === 'reschedule' || bucket === 'unscheduled') {
    return 'followup';
  }
  return 'waiting';
}

export interface ParentCallQueueItem {
  student: Student;
  reasons: string[];
  draftReason: string;
  cycleCases: number;
  totalCases: number;
  alpaCount: number;
  sickCount: number;
  permissionCount: number;
  urgencyScore: number;
}

/**
 * Finds active students who exceeded case or attendance thresholds and do NOT yet have an open parent call.
 */
export function getStudentsQueueForParentCall(params: {
  students: Student[];
  attendance: AttendanceRecord[];
  cases: StudentCase[];
  parentCalls: ParentCall[];
  settings: Pick<
    SystemSettings,
    | 'maxCaseThreshold'
    | 'maxSickThreshold'
    | 'maxPermissionThreshold'
    | 'maxAlphaThreshold'
  >;
}): ParentCallQueueItem[] {
  const { students, attendance, cases, parentCalls, settings } = params;
  const maxCase = settings.maxCaseThreshold || 4;
  const maxSick = settings.maxSickThreshold ?? 5;
  const maxPerm = settings.maxPermissionThreshold ?? 5;
  const maxAlpha = settings.maxAlphaThreshold ?? 3;

  const openCallStudentIds = new Set(
    parentCalls
      .filter((p) => !isParentCallCompleted(p.status))
      .map((p) => p.studentId)
  );

  const queue: ParentCallQueueItem[] = [];

  for (const student of students) {
    if (student.status !== 'Aktif') continue;
    if (openCallStudentIds.has(student.id)) continue;

    const studentCases = cases.filter((c) => c.studentId === student.id);
    const totalCases = studentCases.length;
    const cycleCases = getCasesSinceLastParentCall(
      totalCases,
      student.caseCountAtLastParentCall
    );

    const stuAtt = attendance.filter((a) => a.studentId === student.id);
    const sickRecords = stuAtt.filter((a) => a.status === 'Sakit');
    const permRecords = stuAtt.filter((a) => a.status === 'Izin');
    const alphaRecords = stuAtt.filter((a) => a.status === 'Alpa');

    const sickCount = sickRecords.length;
    const permissionCount = permRecords.length;
    const alpaCount = alphaRecords.length;

    const latestCompletedCallDate = parentCalls
      .filter((p) => p.studentId === student.id && isParentCallCompleted(p.status))
      .reduce((max, p) => (p.callDate > max ? p.callDate : max), '');

    const hasNewAbsenceSinceLastCall = (records: AttendanceRecord[]) =>
      !latestCompletedCallDate || records.some((r) => r.date > latestCompletedCallDate);

    const reasons: string[] = [];
    if (cycleCases >= maxCase) {
      reasons.push(`Akumulasi ${cycleCases} kasus baru (batas ${maxCase})`);
    }
    if (alpaCount >= maxAlpha && hasNewAbsenceSinceLastCall(alphaRecords)) {
      reasons.push(`Alpa ${alpaCount}x (batas ${maxAlpha})`);
    }
    if (sickCount >= maxSick && hasNewAbsenceSinceLastCall(sickRecords)) {
      reasons.push(`Sakit ${sickCount}x (batas ${maxSick})`);
    }
    if (permissionCount >= maxPerm && hasNewAbsenceSinceLastCall(permRecords)) {
      reasons.push(`Izin ${permissionCount}x (batas ${maxPerm})`);
    }

    if (reasons.length === 0) continue;

    const recentCategories = Array.from(
      new Set(
        studentCases
          .slice()
          .sort((a, b) => b.date.localeCompare(a.date))
          .slice(0, 3)
          .map((c) => c.category)
      )
    );
    const categoryNote =
      recentCategories.length > 0 ? ` (${recentCategories.join(', ')})` : '';
    const draftReason = `Pembinaan dan koordinasi orang tua terkait ${reasons.join('; ')}${categoryNote}.`;

    const urgencyScore =
      cycleCases * 10 +
      alpaCount * 6 +
      sickCount * 2 +
      permissionCount * 2 +
      (student.monitoringStatus === 'Prioritas Tinggi' ? 20 : 0);

    queue.push({
      student,
      reasons,
      draftReason,
      cycleCases,
      totalCases,
      alpaCount,
      sickCount,
      permissionCount,
      urgencyScore,
    });
  }

  return queue.sort((a, b) => b.urgencyScore - a.urgencyScore);
}

export interface ParentCallAttentionSummary {
  queue: ParentCallQueueItem[];
  todayCalls: ParentCall[];
  tomorrowCalls: ParentCall[];
  overdueCalls: ParentCall[];
  rescheduleCalls: ParentCall[];
  unscheduledCalls: ParentCall[];
  totalAttentionCount: number;
}

export function computeParentCallAttentionSummary(params: {
  students: Student[];
  attendance: AttendanceRecord[];
  cases: StudentCase[];
  parentCalls: ParentCall[];
  settings: Pick<
    SystemSettings,
    | 'maxCaseThreshold'
    | 'maxSickThreshold'
    | 'maxPermissionThreshold'
    | 'maxAlphaThreshold'
  >;
  todayISO: string;
}): ParentCallAttentionSummary {
  const { students, attendance, cases, parentCalls, settings, todayISO } = params;
  const queue = getStudentsQueueForParentCall({
    students,
    attendance,
    cases,
    parentCalls,
    settings,
  });

  const todayCalls: ParentCall[] = [];
  const tomorrowCalls: ParentCall[] = [];
  const overdueCalls: ParentCall[] = [];
  const rescheduleCalls: ParentCall[] = [];
  const unscheduledCalls: ParentCall[] = [];

  for (const call of parentCalls) {
    const bucket = getParentCallReminderBucket(call, todayISO);
    if (bucket === 'today') todayCalls.push(call);
    else if (bucket === 'tomorrow') tomorrowCalls.push(call);
    else if (bucket === 'overdue') overdueCalls.push(call);
    else if (bucket === 'reschedule') rescheduleCalls.push(call);
    else if (bucket === 'unscheduled') unscheduledCalls.push(call);
  }

  const totalAttentionCount =
    queue.length +
    todayCalls.length +
    tomorrowCalls.length +
    overdueCalls.length +
    rescheduleCalls.length +
    unscheduledCalls.length;

  return {
    queue,
    todayCalls,
    tomorrowCalls,
    overdueCalls,
    rescheduleCalls,
    unscheduledCalls,
    totalAttentionCount,
  };
}

/**
 * Computes next sequence number from existing official letter numbers without colliding on deletions.
 */
export function getNextLetterSequence(parentCalls: ParentCall[]): number {
  let maxSeq = parentCalls.length;
  for (const call of parentCalls) {
    const match = (call.letterNumber || '').match(/\/(\d{1,4})\//);
    if (match) {
      const n = Number(match[1]);
      if (Number.isFinite(n) && n > maxSeq) maxSeq = n;
    }
  }
  return maxSeq + 1;
}
