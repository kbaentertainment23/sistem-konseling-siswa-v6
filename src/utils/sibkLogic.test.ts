import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAttendanceId,
  computeNextCaseNumberInTransaction,
  DEFAULT_SETTINGS,
  evaluateCaseThreshold,
  formatDateLong,
  formatDateShort,
  formatOfficialNumber,
  getCasesSinceLastParentCall,
  getIndonesianDayName,
  getNextCaseNumber,
  getStudentsNeedingAttention,
} from './sibkLogic';
import type { AttendanceRecord, Student, StudentCase } from '../types/sibk';

test('getIndonesianDayName returns accurate Indonesian day names', () => {
  assert.equal(getIndonesianDayName('2026-11-18'), 'Rabu');
  assert.equal(getIndonesianDayName('2026-08-01'), 'Sabtu');
  assert.equal(getIndonesianDayName('invalid'), '-');
});

test('formatDateShort and formatDateLong format ISO dates accurately', () => {
  assert.equal(formatDateShort('2026-11-18'), '18/11/2026');
  assert.equal(formatDateLong('2026-11-18'), '18 November 2026');
});

test('buildAttendanceId produces deterministic anti-duplicate IDs', () => {
  assert.equal(buildAttendanceId('2026-11-18', 'stu_01'), '2026-11-18_stu_01');
  assert.equal(buildAttendanceId('2026-11-18', 'stu_01'), buildAttendanceId('2026-11-18', 'stu_01'));
});

test('getNextCaseNumber increments per studentId and never merges same-name students', () => {
  const cases: StudentCase[] = [
    {
      id: 'c1',
      studentId: 'stu_1',
      studentName: 'Andi',
      nis: '2026001',
      classId: 'cls_8a',
      className: 'VIII A',
      caseNumber: 1,
      date: '2026-08-01',
      dayName: 'Sabtu',
      category: 'Keterlambatan',
      description: 'Terlambat masuk sekolah',
      reporter: 'Guru Piket',
      initialAction: 'Teguran lisan',
      counselorName: 'Ibu Sari',
      status: 'Selesai',
      academicYear: '2026/2027',
    },
    {
      id: 'c2',
      studentId: 'stu_1',
      studentName: 'Andi',
      nis: '2026001',
      classId: 'cls_8a',
      className: 'VIII A',
      caseNumber: 2,
      date: '2026-08-15',
      dayName: 'Sabtu',
      category: 'Akademik',
      description: 'Tidak mengerjakan tugas',
      reporter: 'Wali Kelas',
      initialAction: 'Pembinaan',
      counselorName: 'Ibu Sari',
      status: 'Selesai',
      academicYear: '2026/2027',
    },
  ];

  assert.equal(getNextCaseNumber('stu_1', cases), 3);
  // Different student with same name 'Andi' starts at 1
  assert.equal(getNextCaseNumber('stu_2', cases), 1);
});

test('evaluateCaseThreshold respects configurable school limits', () => {
  assert.equal(evaluateCaseThreshold(1, DEFAULT_SETTINGS).level, 'none');
  assert.equal(evaluateCaseThreshold(2, DEFAULT_SETTINGS).level, 'warning1');
  assert.equal(evaluateCaseThreshold(3, DEFAULT_SETTINGS).level, 'warning2');
  const maxEval = evaluateCaseThreshold(4, DEFAULT_SETTINGS);
  assert.equal(maxEval.level, 'max');
  assert.ok(maxEval.recommendations.length >= 4);
});

test('formatOfficialNumber formats letter numbers with Roman month', () => {
  assert.equal(
    formatOfficialNumber('421.3/{NO}/BK/{BULAN}/{TAHUN}', 7, '2026-11-18'),
    '421.3/007/BK/XI/2026'
  );
});

test('getStudentsNeedingAttention flags students by attendance and cases', () => {
  const students: Student[] = [
    {
      id: 'stu_1',
      nis: '2026001',
      nisn: '0011223344',
      fullName: 'Andi Pratama',
      gender: 'Laki-laki',
      birthPlace: 'Jakarta',
      birthDate: '2012-03-10',
      classId: 'cls_8a',
      className: 'VIII A',
      address: 'Jl. Mawar 1',
      studentPhone: '08123456789',
      fatherName: 'Budi',
      motherName: 'Siti',
      parentPhone: '08129876543',
      entryYear: '2025',
      status: 'Aktif',
      monitoringStatus: 'Normal',
      caseCount: 0,
      academicYear: '2026/2027',
    },
  ];
  const attendance: AttendanceRecord[] = [
    {
      id: '2026-11-17_stu_1',
      date: '2026-11-17',
      studentId: 'stu_1',
      studentName: 'Andi Pratama',
      nis: '2026001',
      classId: 'cls_8a',
      className: 'VIII A',
      status: 'Alpa',
      note: 'Tanpa keterangan',
      academicYear: '2026/2027',
      recordedBy: 'Ibu Sari',
    },
    {
      id: '2026-11-18_stu_1',
      date: '2026-11-18',
      studentId: 'stu_1',
      studentName: 'Andi Pratama',
      nis: '2026001',
      classId: 'cls_8a',
      className: 'VIII A',
      status: 'Alpa',
      note: 'Tanpa keterangan',
      academicYear: '2026/2027',
      recordedBy: 'Ibu Sari',
    },
  ];
  const flagged = getStudentsNeedingAttention(students, attendance, [], DEFAULT_SETTINGS);
  assert.equal(flagged.length, 1);
  assert.equal(flagged[0].student.id, 'stu_1');
  assert.ok(flagged[0].reasons.some((r) => r.includes('Sering tidak hadir')));
});

test('cyclic parent call threshold resets after parent call and triggers again after another max batch', () => {
  // 4 cases, no parent call yet -> triggers max
  assert.equal(evaluateCaseThreshold(getCasesSinceLastParentCall(4, 0), DEFAULT_SETTINGS).level, 'max');
  // Parent call completed at 4 cases -> 0 cases since last call -> no alert
  assert.equal(evaluateCaseThreshold(getCasesSinceLastParentCall(4, 4), DEFAULT_SETTINGS).level, 'none');
  // +3 new cases (total 7) -> 3 cases since last call -> not max yet
  assert.equal(evaluateCaseThreshold(getCasesSinceLastParentCall(7, 4), DEFAULT_SETTINGS).level, 'warning2');
  // +4 new cases (total 8) -> 4 cases since last call -> triggers max again
  assert.equal(evaluateCaseThreshold(getCasesSinceLastParentCall(8, 4), DEFAULT_SETTINGS).level, 'max');
});

test('computeNextCaseNumberInTransaction prevents duplicate case numbers under concurrent writes', () => {
  // Normal first write when both server and local show 2 existing cases
  assert.equal(computeNextCaseNumberInTransaction(2, 2), 3);
  // Concurrent retry: another teacher just committed case #3 on server while local snapshot still has 2
  assert.equal(computeNextCaseNumberInTransaction(3, 2), 4);
  // Legacy student doc where server caseCount was 0 despite 2 local cases
  assert.equal(computeNextCaseNumberInTransaction(0, 2), 3);
});

