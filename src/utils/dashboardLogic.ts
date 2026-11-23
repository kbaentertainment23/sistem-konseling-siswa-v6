import type {
  AttendanceRecord,
  BKSchedule,
  CounselingLog,
  NavSection,
  ParentCall,
  SchoolClass,
  Student,
  StudentCase,
  SystemSettings,
} from '../types/sibk';
import { computeParentCallAttentionSummary, getStudentsQueueForParentCall } from './parentCallLogic';
import { computeCaseAttentionSummary } from './caseLogic';
import {
  computeScheduleAttentionSummary,
  getScheduleUrgencyBucket,
  type ScheduleUrgencyBucket,
} from './scheduleLogic';

export interface DashboardAttentionItem {
  student: Student;
  reasons: string[];
  priority: 'high' | 'medium';
  score: number;
  targetSection: NavSection;
  actionLabel: string;
}

export interface DashboardScheduleItem {
  schedule: BKSchedule;
  urgency: Exclude<ScheduleUrgencyBucket, 'completed'>;
}

export interface MonthlyCasePoint {
  ym: string;
  month: string;
  jumlah: number;
  selesai: number;
}

export interface MonthlyAttendancePoint {
  ym: string;
  month: string;
  Sakit: number;
  Izin: number;
  Alpa: number;
}

export interface CategorySlice {
  name: string;
  value: number;
  percent: number;
}

export interface TopStudentCaseItem {
  studentId: string;
  studentName: string;
  className: string;
  jumlah: number;
  openCount: number;
  percentOfMax: number;
  student?: Student;
}

const MONTH_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'Mei',
  'Jun',
  'Jul',
  'Agu',
  'Sep',
  'Okt',
  'Nov',
  'Des',
];

export function formatShortMonthLabel(ym: string): string {
  const [y, m] = ym.split('-');
  const idx = Number(m) - 1;
  if (idx >= 0 && idx < 12 && y) {
    return `${MONTH_NAMES[idx]} ${y.slice(-2)}`;
  }
  return ym;
}

export function computeDashboardAttentionItems(params: {
  students: Student[];
  attendance: AttendanceRecord[];
  cases: StudentCase[];
  parentCalls: ParentCall[];
  settings: SystemSettings;
}): { items: DashboardAttentionItem[]; totalCount: number } {
  const { students, attendance, cases, parentCalls, settings } = params;

  const map = new Map<string, DashboardAttentionItem>();
  const activeStudents = students.filter((s) => s.status === 'Aktif');
  const studentMap = new Map(activeStudents.map((s) => [s.id, s]));

  // 1. Students crossing case/attendance thresholds without an open parent call
  const callQueue = getStudentsQueueForParentCall({
    students: activeStudents,
    attendance,
    cases,
    parentCalls,
    settings,
  });

  for (const q of callQueue) {
    const isHigh = q.cycleCases >= (settings.maxCaseThreshold || 4) || q.alpaCount >= (settings.maxAlphaThreshold ?? 3);
    map.set(q.student.id, {
      student: q.student,
      reasons: [...q.reasons],
      priority: isHigh ? 'high' : 'medium',
      score: 100 + q.urgencyScore,
      targetSection: 'parent-calls',
      actionLabel: 'Panggil Ortu',
    });
  }

  // 2. Active cases awaiting initial handling or follow-up
  for (const stu of activeStudents) {
    const pendingCases = cases.filter(
      (c) =>
        c.studentId === stu.id &&
        (c.status === 'Belum ditangani' || c.status === 'Perlu tindak lanjut')
    );
    if (pendingCases.length === 0) continue;

    const existing = map.get(stu.id);
    const pendingText = `${pendingCases.length} kasus perlu tindak lanjut`;
    if (existing) {
      existing.reasons.push(pendingText);
      existing.score += 20 + pendingCases.length * 5;
    } else {
      map.set(stu.id, {
        student: stu,
        reasons: [pendingText],
        priority: 'medium',
        score: 50 + pendingCases.length * 10,
        targetSection: 'cases',
        actionLabel: 'Tangani Kasus',
      });
    }
  }

  // Fallback for any pending cases whose student record wasn't in activeStudents filter edge-case
  for (const c of cases) {
    if (c.status !== 'Belum ditangani' && c.status !== 'Perlu tindak lanjut') continue;
    if (map.has(c.studentId)) continue;
    const stu = studentMap.get(c.studentId);
    if (!stu) continue;
    map.set(stu.id, {
      student: stu,
      reasons: [`Kasus ke-${c.caseNumber} (${c.status})`],
      priority: 'medium',
      score: 40,
      targetSection: 'cases',
      actionLabel: 'Tangani Kasus',
    });
  }

  const sorted = Array.from(map.values()).sort((a, b) => b.score - a.score);
  return {
    items: sorted,
    totalCount: sorted.length,
  };
}

export function computeDashboardKpiMetrics(params: {
  students: Student[];
  classes: SchoolClass[];
  attendance: AttendanceRecord[];
  cases: StudentCase[];
  counselingLogs: CounselingLog[];
  parentCalls: ParentCall[];
  schedules: BKSchedule[];
  settings: SystemSettings;
  todayISO: string;
  canViewCounseling: boolean;
}) {
  const {
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
  } = params;

  const activeStudents = students.filter((s) => s.status === 'Aktif');
  const activeClassesCount = classes.filter((c) => !c.archived).length;

  const todayAtt = attendance.filter((a) => a.date === todayISO);
  const refDate =
    todayAtt.length > 0
      ? todayISO
      : attendance.reduce((max, a) => (a.date > max ? a.date : max), '');
  const refAtt = refDate ? attendance.filter((a) => a.date === refDate) : [];

  const sakit = refAtt.filter((a) => a.status === 'Sakit').length;
  const izin = refAtt.filter((a) => a.status === 'Izin').length;
  const alpa = refAtt.filter((a) => a.status === 'Alpa').length;
  const absentCount = sakit + izin + alpa;

  const currentMonth = todayISO.slice(0, 7);
  const casesThisMonth = cases.filter((c) => c.date.startsWith(currentMonth)).length;
  const activeCasesCount = cases.filter((c) => c.status !== 'Selesai').length;
  const caseAttention = computeCaseAttentionSummary({
    cases,
    counselingLogs,
    students,
    parentCalls,
    settings,
    todayISO,
    canViewCounseling,
  });

  const scheduleSummary = computeScheduleAttentionSummary(schedules, todayISO);
  const parentCallSummary = computeParentCallAttentionSummary({
    students,
    attendance,
    cases,
    parentCalls,
    settings,
    todayISO,
  });

  return {
    totalStudents: activeStudents.length,
    activeClassesCount,
    refDate,
    absentCount,
    sakit,
    izin,
    alpa,
    activeCasesCount,
    casesThisMonth,
    caseAttentionCount: caseAttention.totalAttentionCount,
    urgentScheduleCount: scheduleSummary.totalUrgentCount,
    pendingParentCallCount: parentCallSummary.totalAttentionCount,
  };
}

export function getUpcomingDashboardSchedules(
  schedules: BKSchedule[],
  todayISO: string,
  limit = 5
): DashboardScheduleItem[] {
  const rank: Record<Exclude<ScheduleUrgencyBucket, 'completed'>, number> = {
    overdue: 0,
    today: 1,
    tomorrow: 2,
    upcoming: 3,
  };

  return schedules
    .filter((s) => !s.completed)
    .map((sch) => {
      const bucket = getScheduleUrgencyBucket(sch, todayISO);
      const urgency: Exclude<ScheduleUrgencyBucket, 'completed'> =
        bucket === 'completed' ? 'upcoming' : bucket;
      return { schedule: sch, urgency };
    })
    .sort(
      (a, b) =>
        rank[a.urgency] - rank[b.urgency] ||
        a.schedule.date.localeCompare(b.schedule.date) ||
        (a.schedule.time || '').localeCompare(b.schedule.time || '')
    )
    .slice(0, limit);
}

export function buildMonthlyCasesChart(cases: StudentCase[]): MonthlyCasePoint[] {
  const map = new Map<string, MonthlyCasePoint>();
  for (const c of cases) {
    if (!c.date || c.date.length < 7) continue;
    const ym = c.date.slice(0, 7);
    const curr = map.get(ym) || {
      ym,
      month: formatShortMonthLabel(ym),
      jumlah: 0,
      selesai: 0,
    };
    curr.jumlah += 1;
    if (c.status === 'Selesai') curr.selesai += 1;
    map.set(ym, curr);
  }
  return Array.from(map.values()).sort((a, b) => a.ym.localeCompare(b.ym)).slice(-8);
}

export function buildMonthlyAttendanceChart(
  attendance: AttendanceRecord[]
): MonthlyAttendancePoint[] {
  const map = new Map<string, MonthlyAttendancePoint>();
  for (const a of attendance) {
    if (a.status === 'Hadir' || a.status === 'Dispensasi') continue;
    if (!a.date || a.date.length < 7) continue;
    const ym = a.date.slice(0, 7);
    const curr = map.get(ym) || {
      ym,
      month: formatShortMonthLabel(ym),
      Sakit: 0,
      Izin: 0,
      Alpa: 0,
    };
    if (a.status === 'Sakit') curr.Sakit += 1;
    if (a.status === 'Izin') curr.Izin += 1;
    if (a.status === 'Alpa') curr.Alpa += 1;
    map.set(ym, curr);
  }
  return Array.from(map.values()).sort((a, b) => a.ym.localeCompare(b.ym)).slice(-8);
}

export function buildTopCaseCategories(cases: StudentCase[], limit = 6): CategorySlice[] {
  if (cases.length === 0) return [];
  const map = new Map<string, number>();
  for (const c of cases) {
    const key = c.category || 'Lainnya';
    map.set(key, (map.get(key) || 0) + 1);
  }
  const total = cases.length;
  return Array.from(map.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name, value]) => ({
      name,
      value,
      percent: Math.round((value / total) * 100),
    }));
}

export function buildTopStudentsByCases(
  cases: StudentCase[],
  students: Student[],
  limit = 5
): TopStudentCaseItem[] {
  const studentMap = new Map(students.map((s) => [s.id, s]));
  const map = new Map<string, { studentName: string; className: string; jumlah: number; openCount: number }>();

  for (const c of cases) {
    const stu = studentMap.get(c.studentId);
    const curr = map.get(c.studentId) || {
      studentName: stu?.fullName || c.studentName,
      className: stu?.className || c.className,
      jumlah: 0,
      openCount: 0,
    };
    curr.jumlah += 1;
    if (c.status !== 'Selesai') curr.openCount += 1;
    map.set(c.studentId, curr);
  }

  const sorted = Array.from(map.entries())
    .sort((a, b) => b[1].jumlah - a[1].jumlah || b[1].openCount - a[1].openCount)
    .slice(0, limit);

  const maxCount = sorted[0]?.[1].jumlah || 1;

  return sorted.map(([studentId, info]) => ({
    studentId,
    studentName: info.studentName,
    className: info.className,
    jumlah: info.jumlah,
    openCount: info.openCount,
    percentOfMax: Math.round((info.jumlah / maxCount) * 100),
    student: studentMap.get(studentId),
  }));
}
