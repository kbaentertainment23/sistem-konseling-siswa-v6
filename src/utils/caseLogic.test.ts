import test from 'node:test';
import assert from 'node:assert/strict';
import type {
  CounselingLog,
  ParentCall,
  Student,
  StudentCase,
  SystemSettings,
} from '../types/sibk';
import {
  buildCasePhotoFileName,
  buildInitialCounselingTopic,
  buildParentCallReasonFromCase,
  canTriggerParentCallFromCase,
  computeCaseAttentionSummary,
  getCaseEvaluationUrgency,
  getCaseStage,
  getLatestEvaluationDateForCase,
} from './caseLogic';

const baseSettings: Pick<
  SystemSettings,
  'warningThreshold1' | 'warningThreshold2' | 'maxCaseThreshold'
> = {
  warningThreshold1: 2,
  warningThreshold2: 3,
  maxCaseThreshold: 4,
};

function makeStudent(overrides: Partial<Student> = {}): Student {
  return {
    id: 'stu_1',
    nis: '1001',
    nisn: '001',
    fullName: 'Raka Pratama',
    gender: 'Laki-laki',
    birthPlace: 'Singaraja',
    birthDate: '2011-01-10',
    classId: 'cls_1',
    className: '8.1',
    address: 'Jl. Pendidikan 1',
    studentPhone: '',
    fatherName: 'Made Pratama',
    motherName: 'Kadek',
    parentPhone: '081234567890',
    entryYear: '2025',
    status: 'Aktif',
    monitoringStatus: 'Normal',
    caseCount: 1,
    academicYear: '2026/2027',
    ...overrides,
  };
}

function makeCase(overrides: Partial<StudentCase> = {}): StudentCase {
  return {
    id: 'case_1',
    studentId: 'stu_1',
    studentName: 'Raka Pratama',
    nis: '1001',
    classId: 'cls_1',
    className: '8.1',
    caseNumber: 1,
    date: '2026-11-18',
    dayName: 'Rabu',
    category: 'Kedisiplinan',
    description: 'Terlambat 30 menit tanpa keterangan',
    reporter: 'Wali Kelas',
    initialAction: 'Teguran lisan',
    counselorName: 'Guru BK',
    status: 'Belum ditangani',
    academicYear: '2026/2027',
    ...overrides,
  };
}

function makeLog(overrides: Partial<CounselingLog> = {}): CounselingLog {
  return {
    id: 'clog_1',
    caseId: 'case_1',
    studentId: 'stu_1',
    date: '2026-11-18',
    counselorName: 'Guru BK',
    topic: 'Kedisiplinan',
    result: 'Siswa mengakui kesalahan',
    solution: 'Pembinaan',
    studentCommitment: 'Hadir tepat waktu',
    followUpPlan: 'Pantau 1 minggu',
    nextEvaluationDate: '2026-11-21',
    progressStatus: 'Dalam pemantauan',
    ...overrides,
  };
}

test('getCaseStage maps case statuses into 3 clear workflow buckets', () => {
  assert.equal(getCaseStage('Belum ditangani'), 'pending');
  assert.equal(getCaseStage('Perlu tindak lanjut'), 'pending');
  assert.equal(getCaseStage('Sedang ditangani'), 'active');
  assert.equal(getCaseStage('Dalam pemantauan'), 'active');
  assert.equal(getCaseStage('Selesai'), 'done');
});

test('evaluation urgency detects dueToday and overdue dates and ignores Selesai cases', () => {
  const cActive = makeCase({ id: 'case_active', status: 'Dalam pemantauan' });
  const cDone = makeCase({ id: 'case_done', status: 'Selesai' });
  const logs = [
    makeLog({ id: 'l1', caseId: 'case_active', date: '2026-11-15', nextEvaluationDate: '2026-11-19' }),
    makeLog({ id: 'l2', caseId: 'case_active', date: '2026-11-18', nextEvaluationDate: '2026-11-21' }),
    makeLog({ id: 'l3', caseId: 'case_done', date: '2026-11-18', nextEvaluationDate: '2026-11-19' }),
  ];

  assert.equal(getLatestEvaluationDateForCase('case_active', logs), '2026-11-21');
  assert.deepEqual(getCaseEvaluationUrgency(cActive, logs, '2026-11-21'), {
    dueToday: true,
    overdue: false,
    evaluationDate: '2026-11-21',
  });
  assert.deepEqual(getCaseEvaluationUrgency(cActive, logs, '2026-11-22'), {
    dueToday: false,
    overdue: true,
    evaluationDate: '2026-11-21',
  });
  assert.deepEqual(getCaseEvaluationUrgency(cDone, logs, '2026-11-22'), {
    dueToday: false,
    overdue: false,
    evaluationDate: '',
  });
});

test('canTriggerParentCallFromCase respects thresholds and suppresses duplicate open calls', () => {
  const stu = makeStudent({ caseCount: 4 });
  const c = makeCase({ status: 'Sedang ditangani', caseNumber: 4 });

  assert.equal(
    canTriggerParentCallFromCase({
      studentCase: c,
      student: stu,
      totalStudentCases: 4,
      parentCalls: [],
      settings: baseSettings,
    }),
    true
  );

  const openCall: ParentCall = {
    id: 'p1',
    letterNumber: '421.3/001/BK/XI/2026',
    studentId: 'stu_1',
    studentName: 'Raka Pratama',
    className: '8.1',
    parentName: 'Made Pratama',
    parentPhone: '081234567890',
    callDate: '2026-11-20',
    meetingSchedule: 'Sabtu, 21 November 2026',
    reason: 'Sudah dijadwalkan',
    meetingResult: '',
    agreement: '',
    followUpNote: '',
    status: 'Sudah dijadwalkan',
  };

  assert.equal(
    canTriggerParentCallFromCase({
      studentCase: c,
      student: stu,
      totalStudentCases: 4,
      parentCalls: [openCall],
      settings: baseSettings,
    }),
    false
  );
});

test('computeCaseAttentionSummary deduplicates counts and respects counseling privacy flag', () => {
  const stu = makeStudent({ caseCount: 4 });
  const cPendingAndOverdue = makeCase({ id: 'c1', status: 'Perlu tindak lanjut', caseNumber: 4 });
  const cDueToday = makeCase({ id: 'c2', status: 'Dalam pemantauan', caseNumber: 3 });
  const cOld1 = makeCase({ id: 'c3', status: 'Selesai', caseNumber: 2 });
  const cOld2 = makeCase({ id: 'c4', status: 'Selesai', caseNumber: 1 });
  const logs = [
    makeLog({ id: 'l1', caseId: 'c1', nextEvaluationDate: '2026-11-19' }),
    makeLog({ id: 'l2', caseId: 'c2', nextEvaluationDate: '2026-11-21' }),
  ];

  const counselorSummary = computeCaseAttentionSummary({
    cases: [cPendingAndOverdue, cDueToday, cOld1, cOld2],
    counselingLogs: logs,
    students: [stu],
    parentCalls: [],
    settings: baseSettings,
    todayISO: '2026-11-21',
    canViewCounseling: true,
  });

  assert.equal(counselorSummary.pendingCases.length, 1);
  assert.equal(counselorSummary.overdueEvaluations.length, 1);
  assert.equal(counselorSummary.dueTodayEvaluations.length, 1);
  assert.equal(counselorSummary.maxThresholdNeedCall.length, 1);
  assert.equal(counselorSummary.totalAttentionCount, 2); // c1 deduplicated across pending + overdue

  const homeroomSummary = computeCaseAttentionSummary({
    cases: [cPendingAndOverdue, cDueToday, cOld1, cOld2],
    counselingLogs: logs,
    students: [stu],
    parentCalls: [],
    settings: baseSettings,
    todayISO: '2026-11-21',
    canViewCounseling: false,
  });

  assert.equal(homeroomSummary.overdueEvaluations.length, 0);
  assert.equal(homeroomSummary.dueTodayEvaluations.length, 0);
  assert.equal(homeroomSummary.totalAttentionCount, 1);
});

test('buildInitialCounselingTopic and buildParentCallReasonFromCase format clean drafts', () => {
  const c = makeCase();
  assert.equal(
    buildInitialCounselingTopic(c),
    'Kedisiplinan: Terlambat 30 menit tanpa keterangan'
  );
  assert.ok(buildParentCallReasonFromCase(c, 3).includes('total 3 kasus'));
});

test('buildCasePhotoFileName sanitizes segments for safe Google Drive upload naming', () => {
  const name = buildCasePhotoFileName({
    date: '2026-11-22',
    className: 'VIII A / 1',
    studentName: 'Putu Adi (Pratama)',
    nis: '1001-A',
    caseNumber: 2,
    category: 'Kedisiplinan & Tata Tertib',
  });
  assert.equal(name, '2026-11-22_VIII-A-1_Putu-Adi-Pratama_NIS1001A_Kasus-2_Kedisiplinan-Tata-Tertib.jpg');
});
