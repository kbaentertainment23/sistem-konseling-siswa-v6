import test from 'node:test';
import assert from 'node:assert/strict';
import {
  appendNotificationsCapped,
  createInitialRealtimeTrackers,
  detectRealtimeAdditions,
} from './realtimeNotificationLogic';
import type { CounselingLog, ParentCall, StudentCase } from '../types/sibk';

const BASE_TIME = 1_750_000_000_000;

function makeCase(overrides: Partial<StudentCase> = {}): StudentCase {
  return {
    id: 'case_1',
    studentId: 'stu_1',
    studentName: 'Budi Santoso',
    nis: '1001',
    classId: 'cls_1',
    className: '8A',
    caseNumber: 1,
    date: '2026-11-22',
    dayName: 'Minggu',
    category: 'Kedisiplinan',
    description: 'Terlambat upacara',
    reporter: 'Wali Kelas',
    initialAction: 'Teguran lisan',
    counselorName: 'Ibu Ani, S.Pd.',
    status: 'Sedang ditangani',
    academicYear: '2026/2027',
    updatedAt: new Date(BASE_TIME + 5_000).toISOString(),
    updatedBy: 'Ibu Ani, S.Pd.',
    ...overrides,
  };
}

function makeLog(overrides: Partial<CounselingLog> = {}): CounselingLog {
  return {
    id: 'clog_1',
    caseId: 'case_1',
    studentId: 'stu_1',
    date: '2026-11-22',
    counselorName: 'Pak Budi, M.Pd.',
    topic: 'Pembinaan kedisiplinan pagi',
    result: 'Siswa bersedia bangun lebih awal',
    solution: 'Jadwal tidur teratur',
    studentCommitment: 'Datang sebelum 07.00',
    followUpPlan: 'Pantau 1 minggu',
    nextEvaluationDate: '2026-11-29',
    progressStatus: 'Dalam pemantauan',
    updatedAt: new Date(BASE_TIME + 5_000).toISOString(),
    updatedBy: 'Pak Budi, M.Pd.',
    ...overrides,
  };
}

function makeCall(overrides: Partial<ParentCall> = {}): ParentCall {
  return {
    id: 'pcall_1',
    letterNumber: '012/BK/XI/2026',
    studentId: 'stu_1',
    studentName: 'Budi Santoso',
    className: '8A',
    parentName: 'Bpk. Santoso',
    parentPhone: '081234567890',
    callDate: '2026-11-22',
    meetingSchedule: 'Senin, 23 November 2026 pukul 09.00 WIB',
    reason: 'Evaluasi kehadiran',
    meetingResult: '',
    agreement: '',
    followUpNote: '',
    status: 'Sudah dijadwalkan',
    updatedAt: new Date(BASE_TIME + 5_000).toISOString(),
    updatedBy: 'Ibu Sari, S.Pd.',
    ...overrides,
  };
}

test('detectRealtimeAdditions skips initial server snapshot and marks tracker initialized', () => {
  const trackers = createInitialRealtimeTrackers();
  const studentsById = new Map([['stu_1', 'Budi Santoso']]);
  const casesById = new Map([['case_1', 'Budi Santoso']]);

  const initial = detectRealtimeAdditions({
    entity: 'counselingLogs',
    tracker: trackers.counselingLogs,
    records: [makeLog({ id: 'clog_old', updatedAt: new Date(BASE_TIME - 500_000).toISOString() })],
    fromCache: false,
    pendingWriteIds: new Set(),
    localCreatedIds: new Set(),
    studentsById,
    casesById,
    sessionStartedAtMs: BASE_TIME,
  });

  assert.equal(initial.length, 0);
  assert.equal(trackers.counselingLogs.initialized, true);
  assert.equal(trackers.counselingLogs.seenIds.has('clog_old'), true);
});

test('detectRealtimeAdditions notifies when another teacher adds counselingLog, case, or parentCall', () => {
  const trackers = createInitialRealtimeTrackers();
  const studentsById = new Map([['stu_1', 'Budi Santoso']]);
  const casesById = new Map([['case_1', 'Budi Santoso']]);

  // Initialize trackers with server empty state
  detectRealtimeAdditions({
    entity: 'counselingLogs',
    tracker: trackers.counselingLogs,
    records: [],
    fromCache: false,
    pendingWriteIds: new Set(),
    localCreatedIds: new Set(),
    studentsById,
    casesById,
    sessionStartedAtMs: BASE_TIME,
  });
  detectRealtimeAdditions({
    entity: 'parentCalls',
    tracker: trackers.parentCalls,
    records: [],
    fromCache: false,
    pendingWriteIds: new Set(),
    localCreatedIds: new Set(),
    studentsById,
    casesById,
    sessionStartedAtMs: BASE_TIME,
  });
  detectRealtimeAdditions({
    entity: 'cases',
    tracker: trackers.cases,
    records: [],
    fromCache: false,
    pendingWriteIds: new Set(),
    localCreatedIds: new Set(),
    studentsById,
    casesById,
    sessionStartedAtMs: BASE_TIME,
  });

  const logNotifs = detectRealtimeAdditions({
    entity: 'counselingLogs',
    tracker: trackers.counselingLogs,
    records: [makeLog()],
    fromCache: false,
    pendingWriteIds: new Set(),
    localCreatedIds: new Set(),
    studentsById,
    casesById,
    sessionStartedAtMs: BASE_TIME,
    nowMs: BASE_TIME + 6000,
  });
  assert.equal(logNotifs.length, 1);
  assert.equal(logNotifs[0].kind, 'counseling');
  assert.equal(logNotifs[0].targetSection, 'cases');
  assert.match(logNotifs[0].message, /Pak Budi, M\.Pd\./);
  assert.match(logNotifs[0].message, /Budi Santoso/);

  const callNotifs = detectRealtimeAdditions({
    entity: 'parentCalls',
    tracker: trackers.parentCalls,
    records: [makeCall()],
    fromCache: false,
    pendingWriteIds: new Set(),
    localCreatedIds: new Set(),
    studentsById,
    casesById,
    sessionStartedAtMs: BASE_TIME,
    nowMs: BASE_TIME + 7000,
  });
  assert.equal(callNotifs.length, 1);
  assert.equal(callNotifs[0].kind, 'parent-call');
  assert.equal(callNotifs[0].targetSection, 'parent-calls');
  assert.match(callNotifs[0].message, /Ibu Sari, S\.Pd\./);
  assert.match(callNotifs[0].message, /Budi Santoso/);

  const caseNotifs = detectRealtimeAdditions({
    entity: 'cases',
    tracker: trackers.cases,
    records: [makeCase()],
    fromCache: false,
    pendingWriteIds: new Set(),
    localCreatedIds: new Set(),
    studentsById,
    casesById,
    sessionStartedAtMs: BASE_TIME,
    nowMs: BASE_TIME + 8000,
  });
  assert.equal(caseNotifs.length, 1);
  assert.equal(caseNotifs[0].kind, 'case');
  assert.match(caseNotifs[0].message, /kasus ke-1/);
});

test('detectRealtimeAdditions suppresses own creates, updates, stale records, and duplicate snapshots', () => {
  const trackers = createInitialRealtimeTrackers();
  const studentsById = new Map([['stu_1', 'Budi Santoso']]);
  const casesById = new Map([['case_1', 'Budi Santoso']]);

  // Empty cached snapshot should wait for server before initializing
  detectRealtimeAdditions({
    entity: 'parentCalls',
    tracker: trackers.parentCalls,
    records: [],
    fromCache: true,
    pendingWriteIds: new Set(),
    localCreatedIds: new Set(),
    studentsById,
    casesById,
    sessionStartedAtMs: BASE_TIME,
  });
  assert.equal(trackers.parentCalls.initialized, false);

  // Server initial snapshot with existing pcall_existing -> initializes without toast
  const firstServer = detectRealtimeAdditions({
    entity: 'parentCalls',
    tracker: trackers.parentCalls,
    records: [makeCall({ id: 'pcall_existing' })],
    fromCache: false,
    pendingWriteIds: new Set(),
    localCreatedIds: new Set(),
    studentsById,
    casesById,
    sessionStartedAtMs: BASE_TIME,
  });
  assert.equal(firstServer.length, 0);
  assert.equal(trackers.parentCalls.initialized, true);

  // Self-created or pending-write or stale historical doc should all be suppressed
  const second = detectRealtimeAdditions({
    entity: 'parentCalls',
    tracker: trackers.parentCalls,
    records: [
      makeCall({ id: 'pcall_existing', status: 'Hadir' }), // update to existing
      makeCall({ id: 'pcall_self' }), // in localCreatedIds
      makeCall({ id: 'pcall_pending' }), // in pendingWriteIds
      makeCall({ id: 'pcall_stale', updatedAt: new Date(BASE_TIME - 300_000).toISOString() }), // stale
      makeCall({ id: 'pcall_remote' }), // genuine remote add
    ],
    fromCache: false,
    pendingWriteIds: new Set(['pcall_pending']),
    localCreatedIds: new Set(['pcall_self']),
    studentsById,
    casesById,
    sessionStartedAtMs: BASE_TIME,
  });

  assert.equal(second.length, 1);
  assert.equal(second[0].id, 'notif_pcall_pcall_remote');

  // Re-emitting the exact same snapshot produces zero duplicates
  const duplicate = detectRealtimeAdditions({
    entity: 'parentCalls',
    tracker: trackers.parentCalls,
    records: [makeCall({ id: 'pcall_remote' })],
    fromCache: false,
    pendingWriteIds: new Set(),
    localCreatedIds: new Set(),
    studentsById,
    casesById,
    sessionStartedAtMs: BASE_TIME,
  });
  assert.equal(duplicate.length, 0);
});

test('appendNotificationsCapped deduplicates and keeps only the latest maxItems', () => {
  const mk = (i: number) => ({
    id: `n_${i}`,
    kind: 'counseling' as const,
    title: 'Catatan Konseling Baru',
    message: `Msg ${i}`,
    actorName: 'Guru',
    studentName: 'Siswa',
    targetSection: 'cases' as const,
    createdAt: BASE_TIME + i,
  });

  const list = appendNotificationsCapped([mk(1), mk(2)], [mk(2), mk(3), mk(4)], 3);
  assert.deepEqual(
    list.map((x) => x.id),
    ['n_2', 'n_3', 'n_4']
  );
});
