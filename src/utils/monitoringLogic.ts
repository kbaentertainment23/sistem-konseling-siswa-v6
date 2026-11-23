import type {
  AttendanceRecord,
  MonitoringNote,
  MonitoringStatus,
  ProgressLevel,
  Student,
  StudentCase,
  SystemSettings,
} from '../types/sibk';
import { getStudentsNeedingAttention, type WarningLevel } from './sibkLogic';

export type MonitoringTabFilter =
  | 'all'
  | 'high-priority'
  | 'under-monitoring'
  | 'needs-attention'
  | 'unmonitored';

export const MONITORING_STATUS_OPTIONS: MonitoringStatus[] = [
  'Normal',
  'Perlu Perhatian',
  'Dalam Pemantauan',
  'Prioritas Tinggi',
];

export const MONITORING_TREND_OPTIONS: ProgressLevel[] = [
  'Membaik',
  'Stabil',
  'Perlu Perhatian',
  'Menurun',
];

export const MONITORING_OBSERVATION_TEMPLATES: string[] = [
  'Kehadiran membaik minggu ini',
  'Mulai lebih disiplin mengikuti tata tertib',
  'Masih perlu pendampingan berkala',
  'Sudah dikoordinasikan dengan wali kelas',
  'Perlu komunikasi lanjutan dengan orang tua',
];

export interface MonitoringStudentSummary {
  student: Student;
  reasons: string[];
  absenceCount: number;
  sickCount: number;
  permissionCount: number;
  alphaCount: number;
  caseCount: number;
  activeCases: number;
  warningLevel: WarningLevel;
  notesCount: number;
  latestNoteDate: string;
  latestProgressLevel: ProgressLevel | null;
  isUnmonitored: boolean;
}

export interface MonitoringTabCounts {
  all: number;
  highPriority: number;
  underMonitoring: number;
  needsAttention: number;
  unmonitored: number;
}

const STATUS_PRIORITY_RANK: Record<MonitoringStatus, number> = {
  'Prioritas Tinggi': 0,
  'Dalam Pemantauan': 1,
  'Perlu Perhatian': 2,
  Normal: 3,
};

export function buildMonitoringStudentSummaries(params: {
  students: Student[];
  attendance: AttendanceRecord[];
  cases: StudentCase[];
  monitoringNotes: MonitoringNote[];
  settings: SystemSettings;
}): MonitoringStudentSummary[] {
  const { students, attendance, cases, monitoringNotes, settings } = params;
  const baseList = getStudentsNeedingAttention(students, attendance, cases, settings);

  return baseList
    .map((item) => {
      const studentAtt = attendance.filter((a) => a.studentId === item.student.id);
      const sickCount = studentAtt.filter((a) => a.status === 'Sakit').length;
      const permissionCount = studentAtt.filter((a) => a.status === 'Izin').length;
      const alphaCount = studentAtt.filter((a) => a.status === 'Alpa').length;

      const studentNotes = monitoringNotes
        .filter((n) => n.studentId === item.student.id)
        .sort((a, b) => b.date.localeCompare(a.date));

      const latest = studentNotes[0];

      return {
        ...item,
        sickCount,
        permissionCount,
        alphaCount,
        notesCount: studentNotes.length,
        latestNoteDate: latest?.date || '',
        latestProgressLevel: latest?.progressLevel || null,
        isUnmonitored: studentNotes.length === 0,
      };
    })
    .sort((a, b) => {
      const rankDiff =
        (STATUS_PRIORITY_RANK[a.student.monitoringStatus] ?? 9) -
        (STATUS_PRIORITY_RANK[b.student.monitoringStatus] ?? 9);
      if (rankDiff !== 0) return rankDiff;
      if (b.caseCount !== a.caseCount) return b.caseCount - a.caseCount;
      if (b.absenceCount !== a.absenceCount) return b.absenceCount - a.absenceCount;
      return a.student.fullName.localeCompare(b.student.fullName, 'id');
    });
}

export function computeMonitoringTabCounts(
  items: MonitoringStudentSummary[]
): MonitoringTabCounts {
  let highPriority = 0;
  let underMonitoring = 0;
  let needsAttention = 0;
  let unmonitored = 0;

  for (const item of items) {
    if (item.student.monitoringStatus === 'Prioritas Tinggi') highPriority++;
    if (item.student.monitoringStatus === 'Dalam Pemantauan') underMonitoring++;
    if (item.student.monitoringStatus === 'Perlu Perhatian') needsAttention++;
    if (item.isUnmonitored) unmonitored++;
  }

  return {
    all: items.length,
    highPriority,
    underMonitoring,
    needsAttention,
    unmonitored,
  };
}

export function filterMonitoringStudents(
  items: MonitoringStudentSummary[],
  filter: {
    tab: MonitoringTabFilter;
    classId: string;
    search: string;
  }
): MonitoringStudentSummary[] {
  const q = filter.search.trim().toLowerCase();

  return items.filter((item) => {
    if (filter.classId !== 'all' && item.student.classId !== filter.classId) {
      return false;
    }

    if (filter.tab === 'high-priority' && item.student.monitoringStatus !== 'Prioritas Tinggi') {
      return false;
    }
    if (filter.tab === 'under-monitoring' && item.student.monitoringStatus !== 'Dalam Pemantauan') {
      return false;
    }
    if (filter.tab === 'needs-attention' && item.student.monitoringStatus !== 'Perlu Perhatian') {
      return false;
    }
    if (filter.tab === 'unmonitored' && !item.isUnmonitored) {
      return false;
    }

    if (!q) return true;
    return (
      item.student.fullName.toLowerCase().includes(q) ||
      item.student.nis.toLowerCase().includes(q) ||
      item.student.className.toLowerCase().includes(q) ||
      item.reasons.some((r) => r.toLowerCase().includes(q))
    );
  });
}

export function getEligibleStudentsForManualMonitoring(
  students: Student[],
  monitoredStudentIds: Set<string>,
  filter: { classId?: string; search?: string } = {}
): Student[] {
  const q = (filter.search || '').trim().toLowerCase();
  return students
    .filter((s) => s.status === 'Aktif')
    .filter((s) => s.monitoringStatus === 'Normal' && !monitoredStudentIds.has(s.id))
    .filter((s) => !filter.classId || filter.classId === 'all' || s.classId === filter.classId)
    .filter((s) => {
      if (!q) return true;
      return (
        s.fullName.toLowerCase().includes(q) ||
        s.nis.toLowerCase().includes(q) ||
        s.className.toLowerCase().includes(q)
      );
    })
    .sort((a, b) => a.fullName.localeCompare(b.fullName, 'id'));
}

export function appendMonitoringObservationTemplate(
  currentValue: string,
  snippet: string
): string {
  const trimmed = currentValue.trim();
  const cleanSnippet = snippet.trim();
  if (!cleanSnippet) return currentValue;
  if (!trimmed) return cleanSnippet;
  if (trimmed.toLowerCase().includes(cleanSnippet.toLowerCase())) {
    return currentValue;
  }
  return `${trimmed}; ${cleanSnippet}`;
}

export function getMonitoringStatusBadgeClass(status: MonitoringStatus): string {
  switch (status) {
    case 'Prioritas Tinggi':
      return 'bg-red-50 text-red-700 border-red-200';
    case 'Dalam Pemantauan':
      return 'bg-sky-50 text-sky-800 border-sky-200';
    case 'Perlu Perhatian':
      return 'bg-amber-50 text-amber-800 border-amber-200';
    case 'Normal':
    default:
      return 'bg-slate-100 text-slate-700 border-slate-200';
  }
}

export function getMonitoringTrendBadgeClass(level: ProgressLevel): string {
  switch (level) {
    case 'Membaik':
      return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    case 'Stabil':
      return 'bg-sky-50 text-sky-800 border-sky-200';
    case 'Perlu Perhatian':
      return 'bg-amber-50 text-amber-800 border-amber-200';
    case 'Menurun':
    default:
      return 'bg-red-50 text-red-700 border-red-200';
  }
}

export function getMonitoringTrendButtonClass(level: ProgressLevel, active: boolean): string {
  if (!active) {
    return 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50 hover:text-slate-900';
  }
  switch (level) {
    case 'Membaik':
      return 'bg-emerald-600 text-white border-emerald-600 shadow-xs';
    case 'Stabil':
      return 'bg-sky-600 text-white border-sky-600 shadow-xs';
    case 'Perlu Perhatian':
      return 'bg-amber-500 text-white border-amber-500 shadow-xs';
    case 'Menurun':
    default:
      return 'bg-red-600 text-white border-red-600 shadow-xs';
  }
}
