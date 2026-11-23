import test from 'node:test';
import assert from 'node:assert/strict';
import {
  appendMonitoringObservationTemplate,
  buildMonitoringStudentSummaries,
  computeMonitoringTabCounts,
  filterMonitoringStudents,
  getEligibleStudentsForManualMonitoring,
} from './monitoringLogic';
import { DEFAULT_SETTINGS } from './sibkLogic';
import type { AttendanceRecord, MonitoringNote, Student, StudentCase } from '../types/sibk';

function makeStudent(overrides: Partial<Student> = {}): Student {
  return {
    id: 'stu_1',
    nis: '1001',
    nisn: '001',
    fullName: 'Andi Pratama',
    gender: 'Laki-laki',
    birthPlace: 'Denpasar',
    birthDate: '2011-05-10',
    classId: 'cls_8a',
    className: '8A',
    address: 'Jl. Melati',
    studentPhone: '081111',
    fatherName: 'Budi',
    motherName: 'Siti',
    parentPhone: '082222',
    entryYear: '2025',
    status: 'Aktif',
    monitoringStatus: 'Normal',
    caseCount: 0,
    academicYear: '2026/2027',
    ...overrides,
  };
}

function makeAttendance(
  id: string,
  studentId: string,
  status: AttendanceRecord['status']
): AttendanceRecord {
  return {
    id,
    date: '2026-11-20',
    studentId,
    studentName: 'Student',
    nis: '1001',
    classId: 'cls_8a',
    className: '8A',
    status,
    note: '',
    academicYear: '2026/2027',
    recordedBy: 'Guru BK',
  };
}

function makeCase(id: string, studentId: string): StudentCase {
  return {
    id,
    studentId,
    studentName: 'Student',
    nis: '1001',
    classId: 'cls_8a',
    className: '8A',
    caseNumber: 1,
    date: '2026-11-18',
    dayName: 'Rabu',
    category: 'Kedisiplinan',
    description: 'Terlambat',
    reporter: 'Wali Kelas',
    initialAction: 'Teguran',
    counselorName: 'Guru BK',
    status: 'Sedang ditangani',
    academicYear: '2026/2027',
  };
}

function makeNote(overrides: Partial<MonitoringNote> = {}): MonitoringNote {
  return {
    id: 'mnote_1',
    studentId: 'stu_1',
    date: '2026-11-20',
    counselorName: 'Guru BK',
    observation: 'Sudah membaik',
    progressLevel: 'Membaik',
    ...overrides,
  };
}

test('buildMonitoringStudentSummaries aggregates attendance breakdown, notes, and priority order', () => {
  const s1 = makeStudent({ id: 'stu_1', fullName: 'Andi', monitoringStatus: 'Prioritas Tinggi' });
  const s2 = makeStudent({ id: 'stu_2', nis: '1002', fullName: 'Budi', monitoringStatus: 'Dalam Pemantauan' });
  const s3 = makeStudent({ id: 'stu_3', nis: '1003', fullName: 'Citra', monitoringStatus: 'Normal' });

  const attendance: AttendanceRecord[] = [
    makeAttendance('a1', 'stu_1', 'Sakit'),
    makeAttendance('a2', 'stu_1', 'Izin'),
    makeAttendance('a3', 'stu_1', 'Alpa'),
    makeAttendance('a4', 'stu_1', 'Alpa'),
    makeAttendance('a5', 'stu_1', 'Hadir'),
  ];
  const cases: StudentCase[] = [makeCase('c1', 'stu_2')];
  const notes: MonitoringNote[] = [
    makeNote({ id: 'n1', studentId: 'stu_1', date: '2026-11-10', progressLevel: 'Stabil' }),
    makeNote({ id: 'n2', studentId: 'stu_1', date: '2026-11-21', progressLevel: 'Membaik' }),
  ];

  const summaries = buildMonitoringStudentSummaries({
    students: [s3, s2, s1],
    attendance,
    cases,
    monitoringNotes: notes,
    settings: DEFAULT_SETTINGS,
  });

  // s3 has Normal status, 0 cases, 0 absences -> not in attention list
  assert.equal(summaries.length, 2);
  assert.equal(summaries[0].student.id, 'stu_1');
  assert.equal(summaries[0].sickCount, 1);
  assert.equal(summaries[0].permissionCount, 1);
  assert.equal(summaries[0].alphaCount, 2);
  assert.equal(summaries[0].notesCount, 2);
  assert.equal(summaries[0].latestNoteDate, '2026-11-21');
  assert.equal(summaries[0].latestProgressLevel, 'Membaik');
  assert.equal(summaries[0].isUnmonitored, false);

  assert.equal(summaries[1].student.id, 'stu_2');
  assert.equal(summaries[1].isUnmonitored, true);
});

test('computeMonitoringTabCounts and filterMonitoringStudents filter tabs, class, and search accurately', () => {
  const s1 = makeStudent({ id: 'stu_1', fullName: 'Andi', classId: 'cls_8a', className: '8A', monitoringStatus: 'Prioritas Tinggi' });
  const s2 = makeStudent({ id: 'stu_2', nis: '1002', fullName: 'Budi', classId: 'cls_8b', className: '8B', monitoringStatus: 'Dalam Pemantauan' });
  const s3 = makeStudent({ id: 'stu_3', nis: '1003', fullName: 'Candra', classId: 'cls_8a', className: '8A', monitoringStatus: 'Perlu Perhatian' });

  const summaries = buildMonitoringStudentSummaries({
    students: [s1, s2, s3],
    attendance: [],
    cases: [],
    monitoringNotes: [makeNote({ id: 'n1', studentId: 'stu_1' })],
    settings: DEFAULT_SETTINGS,
  });

  const counts = computeMonitoringTabCounts(summaries);
  assert.deepEqual(counts, {
    all: 3,
    highPriority: 1,
    underMonitoring: 1,
    needsAttention: 1,
    unmonitored: 2,
  });

  assert.equal(filterMonitoringStudents(summaries, { tab: 'high-priority', classId: 'all', search: '' }).length, 1);
  assert.equal(filterMonitoringStudents(summaries, { tab: 'under-monitoring', classId: 'all', search: '' }).length, 1);
  assert.equal(filterMonitoringStudents(summaries, { tab: 'needs-attention', classId: 'all', search: '' }).length, 1);
  assert.equal(filterMonitoringStudents(summaries, { tab: 'unmonitored', classId: 'all', search: '' }).length, 2);
  assert.equal(filterMonitoringStudents(summaries, { tab: 'unmonitored', classId: 'cls_8a', search: 'Candra' }).length, 1);
});

test('getEligibleStudentsForManualMonitoring excludes monitored and inactive students', () => {
  const activeNormal = makeStudent({ id: 'stu_1', fullName: 'Dina', classId: 'cls_8a', monitoringStatus: 'Normal', status: 'Aktif' });
  const alreadyMonitored = makeStudent({ id: 'stu_2', fullName: 'Eka', classId: 'cls_8a', monitoringStatus: 'Normal', status: 'Aktif' });
  const graduated = makeStudent({ id: 'stu_3', fullName: 'Fajar', classId: 'cls_8a', monitoringStatus: 'Normal', status: 'Lulus' });
  const alreadyFlagged = makeStudent({ id: 'stu_4', fullName: 'Gita', classId: 'cls_8b', monitoringStatus: 'Perlu Perhatian', status: 'Aktif' });

  const eligible = getEligibleStudentsForManualMonitoring(
    [activeNormal, alreadyMonitored, graduated, alreadyFlagged],
    new Set(['stu_2']),
    { classId: 'cls_8a', search: 'din' }
  );

  assert.deepEqual(
    eligible.map((s) => s.id),
    ['stu_1']
  );
});

test('appendMonitoringObservationTemplate appends cleanly without duplicating', () => {
  assert.equal(
    appendMonitoringObservationTemplate('', 'Kehadiran membaik minggu ini'),
    'Kehadiran membaik minggu ini'
  );
  assert.equal(
    appendMonitoringObservationTemplate('Catatan awal', 'Kehadiran membaik minggu ini'),
    'Catatan awal; Kehadiran membaik minggu ini'
  );
  assert.equal(
    appendMonitoringObservationTemplate('Catatan awal; Kehadiran membaik minggu ini', 'kehadiran membaik minggu ini'),
    'Catatan awal; Kehadiran membaik minggu ini'
  );
});
