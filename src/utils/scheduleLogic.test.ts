import test from 'node:test';
import assert from 'node:assert/strict';
import type { BKSchedule } from '../types/sibk';
import {
  computeRescheduledDate,
  computeScheduleAttentionSummary,
  filterAndSortSchedules,
  getScheduleSyncSource,
  getScheduleTabBucket,
  getScheduleUrgencyBucket,
} from './scheduleLogic';

const TODAY = '2026-11-21';

const makeSchedule = (overrides: Partial<BKSchedule>): BKSchedule => ({
  id: 'sch_1',
  title: 'Konseling Lanjutan',
  type: 'Konseling Siswa',
  date: TODAY,
  time: '09:00',
  studentId: 'stu_1',
  studentName: 'Budi',
  notes: '',
  completed: false,
  ...overrides,
});

test('getScheduleUrgencyBucket and getScheduleTabBucket classify overdue, today, tomorrow, upcoming, and completed', () => {
  const overdue = makeSchedule({ id: 'sch_over', date: '2026-11-19' });
  const today = makeSchedule({ id: 'sch_today', date: '2026-11-21' });
  const tomorrow = makeSchedule({ id: 'sch_tmr', date: '2026-11-22' });
  const future = makeSchedule({ id: 'sch_fut', date: '2026-11-28' });
  const doneOverdue = makeSchedule({ id: 'sch_done', date: '2026-11-18', completed: true });

  assert.equal(getScheduleUrgencyBucket(overdue, TODAY), 'overdue');
  assert.equal(getScheduleUrgencyBucket(today, TODAY), 'today');
  assert.equal(getScheduleUrgencyBucket(tomorrow, TODAY), 'tomorrow');
  assert.equal(getScheduleUrgencyBucket(future, TODAY), 'upcoming');
  assert.equal(getScheduleUrgencyBucket(doneOverdue, TODAY), 'completed');

  assert.equal(getScheduleTabBucket(overdue, TODAY), 'urgent');
  assert.equal(getScheduleTabBucket(today, TODAY), 'urgent');
  assert.equal(getScheduleTabBucket(tomorrow, TODAY), 'upcoming');
  assert.equal(getScheduleTabBucket(future, TODAY), 'upcoming');
  assert.equal(getScheduleTabBucket(doneOverdue, TODAY), 'done');
});

test('computeScheduleAttentionSummary counts only overdue and today incomplete agendas as urgent', () => {
  const schedules: BKSchedule[] = [
    makeSchedule({ id: 's1', date: '2026-11-19', time: '08:00' }),
    makeSchedule({ id: 's2', date: '2026-11-21', time: '10:00' }),
    makeSchedule({ id: 's3', date: '2026-11-22', time: '09:00' }),
    makeSchedule({ id: 's4', date: '2026-11-21', time: '07:30', completed: true }),
  ];

  const summary = computeScheduleAttentionSummary(schedules, TODAY);
  assert.equal(summary.overdue.length, 1);
  assert.equal(summary.dueToday.length, 1);
  assert.equal(summary.upcoming.length, 1);
  assert.equal(summary.completed.length, 1);
  assert.equal(summary.totalUrgentCount, 2);
  assert.deepEqual(
    summary.urgentItems.map((s) => s.id),
    ['s1', 's2']
  );
});

test('computeRescheduledDate shifts overdue or today agendas to tomorrow, and future agendas +1 day', () => {
  assert.equal(computeRescheduledDate('2026-11-15', TODAY, 1), '2026-11-22');
  assert.equal(computeRescheduledDate('2026-11-21', TODAY, 1), '2026-11-22');
  assert.equal(computeRescheduledDate('2026-11-25', TODAY, 1), '2026-11-26');
});

test('filterAndSortSchedules filters by tab, type, query and sorts overdue -> today -> tomorrow -> upcoming -> completed', () => {
  const schedules: BKSchedule[] = [
    makeSchedule({ id: 'done', date: '2026-11-20', completed: true, title: 'Selesai Kemarin' }),
    makeSchedule({ id: 'fut', date: '2026-11-27', type: 'Kegiatan BK', title: 'Sosialisasi Kelas' }),
    makeSchedule({ id: 'today', date: '2026-11-21', type: 'Pemanggilan Orang Tua', studentName: 'Ani', title: 'Panggil Ortu Ani' }),
    makeSchedule({ id: 'over', date: '2026-11-18', type: 'Tindak Lanjut', studentName: 'Candra', title: 'Evaluasi Candra' }),
  ];

  const allSorted = filterAndSortSchedules(schedules, {
    tabFilter: 'all',
    typeFilter: 'all',
    search: '',
    todayISO: TODAY,
  });
  assert.deepEqual(
    allSorted.map((s) => s.id),
    ['over', 'today', 'fut', 'done']
  );

  const urgentOnly = filterAndSortSchedules(schedules, {
    tabFilter: 'urgent',
    typeFilter: 'Pemanggilan Orang Tua',
    search: 'ani',
    todayISO: TODAY,
  });
  assert.deepEqual(
    urgentOnly.map((s) => s.id),
    ['today']
  );
});

test('getScheduleSyncSource identifies synced schedules accurately', () => {
  assert.equal(getScheduleSyncSource('pcall_sch_123'), 'parent-call');
  assert.equal(getScheduleSyncSource('clog_sch_abc'), 'counseling-eval');
  assert.equal(getScheduleSyncSource('sch_custom'), 'manual');
});
