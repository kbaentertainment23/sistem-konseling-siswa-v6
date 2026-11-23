import type { BKSchedule, ScheduleType } from '../types/sibk';
import { addDaysISO } from './parentCallLogic';

export type ScheduleUrgencyBucket =
  | 'completed'
  | 'overdue'
  | 'today'
  | 'tomorrow'
  | 'upcoming';

export type ScheduleTabFilter = 'all' | 'urgent' | 'upcoming' | 'done';

export type ScheduleSyncSource = 'parent-call' | 'counseling-eval' | 'manual';

export const SCHEDULE_TYPES: ScheduleType[] = [
  'Konseling Siswa',
  'Pemanggilan Orang Tua',
  'Tindak Lanjut',
  'Koordinasi Wali Kelas',
  'Kegiatan BK',
];

export const SCHEDULE_TITLE_TEMPLATES = [
  'Konseling Lanjutan Kedisiplinan',
  'Evaluasi Kehadiran Siswa',
  'Koordinasi dengan Wali Kelas',
  'Pertemuan Orang Tua / Wali',
  'Home Visit / Kunjungan Rumah',
] as const;

export const SCHEDULE_NOTE_TEMPLATES = [
  'Siapkan rekap absensi & catatan kasus',
  'Konfirmasi kehadiran via WhatsApp wali',
  'Evaluasi komitmen minggu lalu',
  'Koordinasikan hasil pembinaan dengan wali kelas',
] as const;

export function getScheduleSyncSource(scheduleId: string): ScheduleSyncSource {
  if (scheduleId.startsWith('pcall_sch_')) return 'parent-call';
  if (scheduleId.startsWith('clog_sch_')) return 'counseling-eval';
  return 'manual';
}

export function getScheduleUrgencyBucket(
  schedule: BKSchedule,
  todayISO: string
): ScheduleUrgencyBucket {
  if (schedule.completed) return 'completed';
  if (!schedule.date) return 'upcoming';
  if (schedule.date < todayISO) return 'overdue';
  if (schedule.date === todayISO) return 'today';
  const tomorrowISO = addDaysISO(todayISO, 1);
  if (schedule.date === tomorrowISO) return 'tomorrow';
  return 'upcoming';
}

export function getScheduleTabBucket(
  schedule: BKSchedule,
  todayISO: string
): Exclude<ScheduleTabFilter, 'all'> {
  const urgency = getScheduleUrgencyBucket(schedule, todayISO);
  if (urgency === 'completed') return 'done';
  if (urgency === 'overdue' || urgency === 'today') return 'urgent';
  return 'upcoming';
}

/**
 * Reschedules an agenda by +N days.
 * If the agenda date is today or overdue (date <= todayISO), moves it relative to todayISO
 * so "Geser Besok (+1 Hari)" lands cleanly on tomorrow rather than remaining in the past.
 */
export function computeRescheduledDate(
  currentDate: string,
  todayISO: string,
  days = 1
): string {
  const baseDate = !currentDate || currentDate <= todayISO ? todayISO : currentDate;
  return addDaysISO(baseDate, days);
}

export interface ScheduleAttentionSummary {
  overdue: BKSchedule[];
  dueToday: BKSchedule[];
  upcoming: BKSchedule[];
  completed: BKSchedule[];
  urgentItems: BKSchedule[];
  totalUrgentCount: number;
}

export function computeScheduleAttentionSummary(
  schedules: BKSchedule[],
  todayISO: string
): ScheduleAttentionSummary {
  const overdue: BKSchedule[] = [];
  const dueToday: BKSchedule[] = [];
  const upcoming: BKSchedule[] = [];
  const completed: BKSchedule[] = [];

  for (const sch of schedules) {
    const bucket = getScheduleUrgencyBucket(sch, todayISO);
    if (bucket === 'completed') {
      completed.push(sch);
    } else if (bucket === 'overdue') {
      overdue.push(sch);
    } else if (bucket === 'today') {
      dueToday.push(sch);
    } else {
      upcoming.push(sch);
    }
  }

  const byDateTimeAsc = (a: BKSchedule, b: BKSchedule) =>
    a.date.localeCompare(b.date) || (a.time || '').localeCompare(b.time || '');

  overdue.sort(byDateTimeAsc);
  dueToday.sort(byDateTimeAsc);
  upcoming.sort(byDateTimeAsc);
  completed.sort((a, b) => b.date.localeCompare(a.date) || (b.time || '').localeCompare(a.time || ''));

  const urgentItems = [...overdue, ...dueToday];

  return {
    overdue,
    dueToday,
    upcoming,
    completed,
    urgentItems,
    totalUrgentCount: urgentItems.length,
  };
}

export function filterAndSortSchedules(
  schedules: BKSchedule[],
  params: {
    tabFilter: ScheduleTabFilter;
    typeFilter: 'all' | ScheduleType;
    search: string;
    todayISO: string;
  }
): BKSchedule[] {
  const q = params.search.trim().toLowerCase();

  const filtered = schedules.filter((sch) => {
    if (params.tabFilter !== 'all' && getScheduleTabBucket(sch, params.todayISO) !== params.tabFilter) {
      return false;
    }
    if (params.typeFilter !== 'all' && sch.type !== params.typeFilter) {
      return false;
    }
    if (!q) return true;
    return (
      sch.title.toLowerCase().includes(q) ||
      (sch.studentName || '').toLowerCase().includes(q) ||
      (sch.notes || '').toLowerCase().includes(q) ||
      sch.type.toLowerCase().includes(q)
    );
  });

  const bucketRank: Record<ScheduleUrgencyBucket, number> = {
    overdue: 0,
    today: 1,
    tomorrow: 2,
    upcoming: 3,
    completed: 4,
  };

  return filtered.sort((a, b) => {
    const ba = getScheduleUrgencyBucket(a, params.todayISO);
    const bb = getScheduleUrgencyBucket(b, params.todayISO);
    if (bucketRank[ba] !== bucketRank[bb]) {
      return bucketRank[ba] - bucketRank[bb];
    }
    if (ba === 'completed') {
      return b.date.localeCompare(a.date) || (b.time || '').localeCompare(a.time || '');
    }
    return a.date.localeCompare(b.date) || (a.time || '').localeCompare(b.time || '');
  });
}
