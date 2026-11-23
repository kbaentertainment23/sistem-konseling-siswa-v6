import test from 'node:test';
import assert from 'node:assert/strict';
import type {
  AttendanceRecord,
  ParentCall,
  Student,
  StudentCase,
  SystemSettings,
} from '../types/sibk';
import {
  addDaysISO,
  buildParentCallWhatsAppUrl,
  computeParentCallAttentionSummary,
  formatMeetingScheduleText,
  formatWhatsAppPhone,
  getNextLetterSequence,
  getParentCallFilterStage,
  getParentCallReminderBucket,
  getStudentsQueueForParentCall,
  parseMeetingSchedule,
} from './parentCallLogic';

const baseSettings: Pick<
  SystemSettings,
  'maxCaseThreshold' | 'maxSickThreshold' | 'maxPermissionThreshold' | 'maxAlphaThreshold'
> = {
  maxCaseThreshold: 3,
  maxSickThreshold: 5,
  maxPermissionThreshold: 5,
  maxAlphaThreshold: 3,
};

function makeStudent(overrides: Partial<Student> = {}): Student {
  return {
    id: 'stu_1',
    nis: '1001',
    nisn: '001',
    fullName: 'Budi Santoso',
    gender: 'Laki-laki',
    birthPlace: 'Denpasar',
    birthDate: '2011-05-10',
    classId: 'cls_1',
    className: '8.1',
    address: 'Jl. Melati 1',
    studentPhone: '',
    fatherName: 'Ahmad Santoso',
    motherName: 'Siti',
    parentPhone: '0812-3456-7890',
    entryYear: '2025',
    status: 'Aktif',
    monitoringStatus: 'Normal',
    caseCount: 0,
    academicYear: '2026/2027',
    ...overrides,
  };
}

function makeCall(overrides: Partial<ParentCall> = {}): ParentCall {
  return {
    id: 'pcall_1',
    letterNumber: '421.3/001/BK/XI/2026',
    studentId: 'stu_1',
    studentName: 'Budi Santoso',
    className: '8.1',
    parentName: 'Ahmad Santoso',
    parentPhone: '081234567890',
    callDate: '2026-11-20',
    meetingDate: '2026-11-21',
    meetingTime: '09:00',
    meetingSchedule: 'Sabtu, 21 November 2026 · 09:00 WIB',
    reason: 'Pelanggaran tata tertib berulang',
    meetingResult: '',
    agreement: '',
    followUpNote: '',
    status: 'Sudah dijadwalkan',
    ...overrides,
  };
}

test('parseMeetingSchedule handles both structured fields and legacy Indonesian text', () => {
  assert.deepEqual(parseMeetingSchedule('20/11/2026 09:30 WIB'), {
    date: '2026-11-20',
    time: '09:30',
  });
  assert.deepEqual(parseMeetingSchedule('2026-11-25 10.15', '2026-11-26', '08:00'), {
    date: '2026-11-26',
    time: '08:00',
  });
  assert.deepEqual(parseMeetingSchedule('Menyesuaikan'), { date: '', time: '' });
});

test('formatMeetingScheduleText produces readable Indonesian schedule string', () => {
  const formatted = formatMeetingScheduleText('2026-11-20', '09:00');
  assert.equal(formatted, 'Jumat, 20 November 2026 · 09:00 WIB');
  assert.equal(formatMeetingScheduleText('', '', 'Senin pagi'), 'Senin pagi');
});

test('formatWhatsAppPhone normalizes Indonesian numbers and rejects invalid short input', () => {
  assert.equal(formatWhatsAppPhone('0812-3456 7890'), '6281234567890');
  assert.equal(formatWhatsAppPhone('+62 813 9988 7766'), '6281399887766');
  assert.equal(formatWhatsAppPhone('8123456789'), '628123456789');
  assert.equal(formatWhatsAppPhone('12345'), '');
});

test('buildParentCallWhatsAppUrl builds wa.me link with encoded student & schedule info', () => {
  const url = buildParentCallWhatsAppUrl(makeCall(), 'SMP Negeri 6 Singaraja');
  assert.ok(url.startsWith('https://wa.me/6281234567890?text='));
  const decoded = decodeURIComponent(url.split('text=')[1]);
  assert.ok(decoded.includes('Ahmad Santoso'));
  assert.ok(decoded.includes('Budi Santoso'));
  assert.ok(decoded.includes('Sabtu, 21 November 2026 · 09:00 WIB'));
  assert.ok(decoded.includes('SMP Negeri 6 Singaraja'));
});

test('getParentCallReminderBucket & getParentCallFilterStage classify today, tomorrow, overdue, reschedule, and done accurately', () => {
  const today = '2026-11-20';
  assert.equal(addDaysISO(today, 1), '2026-11-21');

  const todayCall = makeCall({ meetingDate: '2026-11-20', status: 'Sudah dijadwalkan' });
  assert.equal(getParentCallReminderBucket(todayCall, today), 'today');
  assert.equal(getParentCallFilterStage(todayCall, today), 'waiting');

  const tomorrowCall = makeCall({ meetingDate: '2026-11-21', status: 'Sudah dipanggil' });
  assert.equal(getParentCallReminderBucket(tomorrowCall, today), 'tomorrow');
  assert.equal(getParentCallFilterStage(tomorrowCall, today), 'waiting');

  const overdueCall = makeCall({ meetingDate: '2026-11-18', status: 'Sudah dijadwalkan' });
  assert.equal(getParentCallReminderBucket(overdueCall, today), 'overdue');
  assert.equal(getParentCallFilterStage(overdueCall, today), 'followup');

  const absentCall = makeCall({ meetingDate: '2026-11-25', status: 'Tidak hadir' });
  assert.equal(getParentCallReminderBucket(absentCall, today), 'reschedule');
  assert.equal(getParentCallFilterStage(absentCall, today), 'followup');

  const doneCall = makeCall({ meetingDate: '2026-11-18', status: 'Hadir' });
  assert.equal(getParentCallReminderBucket(doneCall, today), 'done');
  assert.equal(getParentCallFilterStage(doneCall, today), 'done');
});

test('getStudentsQueueForParentCall flags students crossing case/alpa thresholds unless an open call exists', () => {
  const stuCase = makeStudent({ id: 'stu_case', fullName: 'Andi', caseCount: 3 });
  const stuAlpha = makeStudent({ id: 'stu_alpha', fullName: 'Citra', caseCount: 0 });
  const stuOpenCall = makeStudent({ id: 'stu_open', fullName: 'Deni', caseCount: 4 });

  const cases: StudentCase[] = [1, 2, 3].map((n) => ({
    id: `c_${n}`,
    studentId: 'stu_case',
    studentName: 'Andi',
    nis: '1001',
    classId: 'cls_1',
    className: '8.1',
    caseNumber: n,
    date: `2026-11-0${n}`,
    dayName: 'Senin',
    category: 'Kedisiplinan',
    description: 'Terlambat',
    reporter: 'Guru',
    initialAction: 'Teguran',
    counselorName: 'BK',
    status: 'Belum ditangani',
    academicYear: '2026/2027',
  }));

  const attendance: AttendanceRecord[] = [1, 2, 3].map((n) => ({
    id: `2026-11-1${n}_stu_alpha`,
    date: `2026-11-1${n}`,
    studentId: 'stu_alpha',
    studentName: 'Citra',
    nis: '1002',
    classId: 'cls_1',
    className: '8.1',
    status: 'Alpa',
    note: '',
    academicYear: '2026/2027',
    recordedBy: 'BK',
  }));

  const openCall = makeCall({
    id: 'pcall_open',
    studentId: 'stu_open',
    studentName: 'Deni',
    status: 'Sudah dijadwalkan',
  });

  const queue = getStudentsQueueForParentCall({
    students: [stuCase, stuAlpha, stuOpenCall],
    attendance,
    cases: [
      ...cases,
      {
        ...cases[0],
        id: 'c_open_1',
        studentId: 'stu_open',
        studentName: 'Deni',
      },
      {
        ...cases[0],
        id: 'c_open_2',
        studentId: 'stu_open',
        studentName: 'Deni',
      },
      {
        ...cases[0],
        id: 'c_open_3',
        studentId: 'stu_open',
        studentName: 'Deni',
      },
    ],
    parentCalls: [openCall],
    settings: baseSettings,
  });

  assert.equal(queue.length, 2);
  assert.equal(queue[0].student.id, 'stu_case');
  assert.ok(queue[0].draftReason.includes('Kedisiplinan'));
  assert.equal(queue[1].student.id, 'stu_alpha');
  assert.ok(queue[1].reasons[0].includes('Alpa 3x'));
});

test('computeParentCallAttentionSummary & getNextLetterSequence return accurate counts and next letter index', () => {
  const summary = computeParentCallAttentionSummary({
    students: [makeStudent({ id: 'stu_q', caseCount: 3 })],
    attendance: [],
    cases: [1, 2, 3].map((n) => ({
      id: `cq_${n}`,
      studentId: 'stu_q',
      studentName: 'Budi',
      nis: '1001',
      classId: 'cls_1',
      className: '8.1',
      caseNumber: n,
      date: '2026-11-19',
      dayName: 'Kamis',
      category: 'Perilaku',
      description: 'Test',
      reporter: 'Guru',
      initialAction: '',
      counselorName: 'BK',
      status: 'Belum ditangani',
      academicYear: '2026/2027',
    })),
    parentCalls: [
      makeCall({ id: 'p1', studentId: 'stu_other', meetingDate: '2026-11-20', status: 'Sudah dijadwalkan' }),
      makeCall({ id: 'p2', studentId: 'stu_other2', letterNumber: '421.3/007/BK/XI/2026', meetingDate: '2026-11-18', status: 'Sudah dijadwalkan' }),
      makeCall({ id: 'p3', studentId: 'stu_other3', meetingDate: '2026-11-15', status: 'Selesai' }),
    ],
    settings: baseSettings,
    todayISO: '2026-11-20',
  });

  assert.equal(summary.queue.length, 1);
  assert.equal(summary.todayCalls.length, 1);
  assert.equal(summary.overdueCalls.length, 1);
  assert.equal(summary.totalAttentionCount, 3);
  assert.equal(getNextLetterSequence([makeCall({ letterNumber: '421.3/007/BK/XI/2026' })]), 8);
});
