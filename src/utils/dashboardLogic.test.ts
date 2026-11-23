import test from 'node:test';
import assert from 'node:assert/strict';
import type {
  AttendanceRecord,
  BKSchedule,
  ParentCall,
  Student,
  StudentCase,
  SystemSettings,
} from '../types/sibk';
import {
  buildMonthlyAttendanceChart,
  buildMonthlyCasesChart,
  buildTopCaseCategories,
  buildTopStudentsByCases,
  computeDashboardAttentionItems,
  getUpcomingDashboardSchedules,
} from './dashboardLogic';

const TODAY = '2026-11-21';

const baseSettings: SystemSettings = {
  id: 'default',
  schoolName: 'SMP N 6 Singaraja',
  schoolAddress: 'Jl. Bisma',
  schoolPhone: '0362',
  principalName: 'Kepsek',
  principalNip: '123',
  activeAcademicYear: '2026/2027',
  activeSemester: 'Ganjil',
  warningThreshold1: 2,
  warningThreshold2: 3,
  maxCaseThreshold: 4,
  maxSickThreshold: 5,
  maxPermissionThreshold: 5,
  maxAlphaThreshold: 3,
  reportNumberFormat: '001/BK',
  categories: ['Kedisiplinan'],
};

const makeStudent = (id: string, name: string): Student => ({
  id,
  nis: id,
  nisn: id,
  fullName: name,
  gender: 'Laki-laki',
  birthPlace: 'Singaraja',
  birthDate: '2012-01-01',
  classId: 'c1',
  className: '8.1',
  address: 'Singaraja',
  studentPhone: '081',
  fatherName: 'Ayah',
  motherName: 'Ibu',
  parentPhone: '08123456789',
  parentAddress: 'Singaraja',
  entryYear: '2026',
  status: 'Aktif',
  notes: '',
  monitoringStatus: 'Normal',
  caseCount: 0,
  academicYear: '2026/2027',
});

const makeCase = (id: string, studentId: string, num: number, status: StudentCase['status']): StudentCase => ({
  id,
  caseNumber: num,
  studentId,
  studentName: 'Siswa',
  nis: studentId,
  classId: 'c1',
  className: '8.1',
  date: '2026-11-20',
  dayName: 'Jumat',
  category: 'Kedisiplinan',
  description: 'Terlambat',
  reporter: 'Guru',
  initialAction: 'Teguran',
  counselorName: 'BK',
  status,
  academicYear: '2026/2027',
});

test('computeDashboardAttentionItems deduplicates students, prioritizes max-threshold without open call, and routes cleanly', () => {
  const stuA = makeStudent('a', 'Andi');
  const stuB = makeStudent('b', 'Budi');

  const cases: StudentCase[] = [
    makeCase('c1', 'a', 1, 'Sedang ditangani'),
    makeCase('c2', 'a', 2, 'Sedang ditangani'),
    makeCase('c3', 'a', 3, 'Sedang ditangani'),
    makeCase('c4', 'a', 4, 'Perlu tindak lanjut'),
    makeCase('c5', 'b', 1, 'Belum ditangani'),
  ];

  const attendance: AttendanceRecord[] = [
    { id: 'att1', date: '2026-11-18', studentId: 'b', studentName: 'Budi', nis: 'b', classId: 'c1', className: '8.1', status: 'Alpa', note: '', academicYear: '2026/2027', recordedBy: 'BK' },
    { id: 'att2', date: '2026-11-19', studentId: 'b', studentName: 'Budi', nis: 'b', classId: 'c1', className: '8.1', status: 'Alpa', note: '', academicYear: '2026/2027', recordedBy: 'BK' },
    { id: 'att3', date: '2026-11-20', studentId: 'b', studentName: 'Budi', nis: 'b', classId: 'c1', className: '8.1', status: 'Alpa', note: '', academicYear: '2026/2027', recordedBy: 'BK' },
  ];

  const openCallForB: ParentCall[] = [
    {
      id: 'pc1',
      letterNumber: '001',
      studentId: 'b',
      studentName: 'Budi',
      className: '8.1',
      parentName: 'Wali',
      parentPhone: '0812',
      callDate: '2026-11-20',
      meetingSchedule: '',
      reason: 'Alpa',
      meetingResult: '',
      agreement: '',
      followUpNote: '',
      status: 'Sudah dijadwalkan',
    },
  ];

  const res = computeDashboardAttentionItems({
    students: [stuA, stuB],
    attendance,
    cases,
    parentCalls: openCallForB,
    settings: baseSettings,
  });

  assert.equal(res.totalCount, 2);
  assert.equal(res.items[0].student.id, 'a');
  assert.equal(res.items[0].targetSection, 'parent-calls');
  assert.equal(res.items[0].priority, 'high');
  // Student B already has an open parent call, so only pending case remains & routes to cases
  assert.equal(res.items[1].student.id, 'b');
  assert.equal(res.items[1].targetSection, 'cases');
});

test('getUpcomingDashboardSchedules prioritizes overdue, today, tomorrow, and limits results', () => {
  const schedules: BKSchedule[] = [
    { id: 'done', title: 'Done', type: 'Kegiatan BK', date: '2026-11-19', time: '08:00', notes: '', completed: true },
    { id: 'fut', title: 'Future', type: 'Kegiatan BK', date: '2026-11-28', time: '08:00', notes: '', completed: false },
    { id: 'today', title: 'Today', type: 'Konseling Siswa', date: '2026-11-21', time: '10:00', notes: '', completed: false },
    { id: 'over', title: 'Overdue', type: 'Pemanggilan Orang Tua', date: '2026-11-18', time: '09:00', notes: '', completed: false },
    { id: 'tmr', title: 'Tomorrow', type: 'Tindak Lanjut', date: '2026-11-22', time: '09:00', notes: '', completed: false },
  ];

  const list = getUpcomingDashboardSchedules(schedules, TODAY, 3);
  assert.deepEqual(
    list.map((i) => `${i.schedule.id}:${i.urgency}`),
    ['over:overdue', 'today:today', 'tmr:tomorrow']
  );
});

test('chart builders aggregate monthly cases, monthly absences, categories, and top students', () => {
  const stuA = makeStudent('a', 'Andi');
  const cases: StudentCase[] = [
    makeCase('c1', 'a', 1, 'Selesai'),
    makeCase('c2', 'a', 2, 'Sedang ditangani'),
    { ...makeCase('c3', 'b', 1, 'Sedang ditangani'), category: 'Sosial', date: '2026-10-15' },
  ];

  const monthlyCases = buildMonthlyCasesChart(cases);
  assert.equal(monthlyCases.length, 2);
  assert.equal(monthlyCases[1].jumlah, 2);
  assert.equal(monthlyCases[1].selesai, 1);

  const cats = buildTopCaseCategories(cases);
  assert.equal(cats[0].name, 'Kedisiplinan');
  assert.equal(cats[0].percent, 67);

  const topStu = buildTopStudentsByCases(cases, [stuA]);
  assert.equal(topStu[0].studentName, 'Andi');
  assert.equal(topStu[0].jumlah, 2);
  assert.equal(topStu[0].percentOfMax, 100);
  assert.equal(topStu[0].student?.id, 'a');

  const att = buildMonthlyAttendanceChart([
    { id: '1', date: '2026-11-20', studentId: 'a', studentName: 'Andi', nis: 'a', classId: 'c1', className: '8.1', status: 'Hadir', note: '', academicYear: '2026/2027', recordedBy: 'BK' },
    { id: '2', date: '2026-11-20', studentId: 'a', studentName: 'Andi', nis: 'a', classId: 'c1', className: '8.1', status: 'Alpa', note: '', academicYear: '2026/2027', recordedBy: 'BK' },
  ]);
  assert.equal(att.length, 1);
  assert.equal(att[0].Alpa, 1);
});
