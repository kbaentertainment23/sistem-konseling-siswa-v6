import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildBackupPayload,
  extractDriveFileIdFromCase,
  formatRestoreErrorMessage,
  isValidFirestoreDocId,
  planFirestoreRestoreOperations,
  relinkCasesWithRestoredDriveFiles,
  sanitizeBackupDocId,
  sanitizeRecordForFirestore,
  validateAndSummarizeBackupPayload,
} from './backupLogic';
import { DEFAULT_SETTINGS } from './sibkLogic';

test('isValidFirestoreDocId and sanitizeBackupDocId enforce firestore.rules pattern', () => {
  assert.equal(isValidFirestoreDocId('stu_12345_abc'), true);
  assert.equal(isValidFirestoreDocId('2026-11-20_stu_1'), true);
  assert.equal(isValidFirestoreDocId(''), false);
  assert.equal(isValidFirestoreDocId('a/b'), false);
  assert.equal(isValidFirestoreDocId('id with spaces'), false);

  assert.equal(sanitizeBackupDocId('stu_01', 'stu', 1), 'stu_01');
  assert.equal(sanitizeBackupDocId('kelas 7A/2026', 'cls', 2), 'kelas_7A_2026');
  assert.equal(sanitizeBackupDocId('///', 'cls', 5), 'cls_restored_5');
});

test('extractDriveFileIdFromCase finds file ID from field or URLs', () => {
  assert.equal(
    extractDriveFileIdFromCase({ photoDriveFileId: '1AbCdEfGhIjKlMnOpQr' }),
    '1AbCdEfGhIjKlMnOpQr'
  );
  assert.equal(
    extractDriveFileIdFromCase({
      photoDriveWebViewLink: 'https://drive.google.com/file/d/1XyZ9876543210AbCd/view?usp=sharing',
    }),
    '1XyZ9876543210AbCd'
  );
  assert.equal(
    extractDriveFileIdFromCase({
      photoUrl: 'https://drive.google.com/thumbnail?id=1ThumbFileId998877&sz=w1200',
    }),
    '1ThumbFileId998877'
  );
  assert.equal(extractDriveFileIdFromCase({ photoUrl: 'data:image/jpeg;base64,/9j/4AAQ' }), null);
});

test('buildBackupPayload creates v3 backup with all 11 Firestore sections and Drive files', () => {
  const payload = buildBackupPayload({
    exportedAt: '2026-11-23T08:00:00.000Z',
    exportedBy: 'admin@sekolah.sch.id',
    settings: DEFAULT_SETTINGS,
    classes: [{ id: 'cls_1', name: 'VII-A', level: 'VII', homeroomTeacher: 'Bu Ani', academicYear: '2026/2027' }],
    students: [],
    attendance: [],
    cases: [],
    counselingLogs: [],
    parentCalls: [],
    monitoringNotes: [],
    schedules: [],
    users: [],
    auditLogs: [{ id: 'aud_1', userEmail: 'a@b.c', userName: 'Admin', action: 'LOGIN', target: 'Web', timestamp: '2026-11-23T08:00:00Z' }],
    driveFiles: [
      {
        originalFileId: 'driveFile123456',
        name: 'kasus_01.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 120,
        base64Data: 'AAAA',
        linkedCaseIds: ['cas_1'],
        source: 'both',
      },
    ],
    driveIncluded: true,
    driveFolderId: 'folder1234567890',
    driveAccountEmail: 'bk@sekolah.sch.id',
  });

  assert.equal(payload.backupVersion, 3);
  assert.equal(payload.backupMeta.driveIncluded, true);
  assert.equal(payload.backupMeta.driveFilesCount, 1);
  assert.equal(payload.backupMeta.totalFirestoreDocs, 3); // settings + cls_1 + aud_1
});

test('validateAndSummarizeBackupPayload detects legacy backups missing Drive binaries and counts v3 fields', () => {
  const legacyInvalid = validateAndSummarizeBackupPayload({ hello: 'world' });
  assert.equal(legacyInvalid.valid, false);

  const legacyWithoutBinaries = validateAndSummarizeBackupPayload({
    backupVersion: 2,
    settings: DEFAULT_SETTINGS,
    cases: [{ id: 'cas_1', photoDriveFileId: '1AbCdEfGhIjKlMnOp' }],
    auditLogs: [{ id: 'aud_1' }],
  });
  assert.equal(legacyWithoutBinaries.valid, true);
  assert.equal(legacyWithoutBinaries.counts.cases, 1);
  assert.equal(legacyWithoutBinaries.counts.auditLogs, 1);
  assert.equal(legacyWithoutBinaries.counts.driveFiles, 0);
  assert.equal(legacyWithoutBinaries.warnings.length, 1);

  const v3Summary = validateAndSummarizeBackupPayload({
    backupVersion: 3,
    settings: DEFAULT_SETTINGS,
    cases: [{ id: 'cas_1', photoDriveFileId: '1AbCdEfGhIjKlMnOp' }],
    driveFiles: [
      { originalFileId: '1AbCdEfGhIjKlMnOp', name: 'foto.jpg', mimeType: 'image/jpeg', base64Data: 'AQIDBA==' },
    ],
  });
  assert.equal(v3Summary.valid, true);
  assert.equal(v3Summary.counts.driveFiles, 1);
  assert.equal(v3Summary.warnings.length, 0);
  assert.equal(v3Summary.totalDriveBytes, 4);
});

test('planFirestoreRestoreOperations skips existing auditLogs, relinks Drive photos, strips locks, and chunks batches', () => {
  const backup = {
    settings: { ...DEFAULT_SETTINGS, id: 'global' },
    cases: [
      {
        id: 'cas_1',
        studentId: 'stu_1',
        studentName: 'Budi',
        nis: '1001',
        classId: 'cls_1',
        className: 'VII-A',
        caseNumber: '2',
        date: '2026-11-20',
        dayName: 'Jumat',
        category: 'Kedisiplinan',
        description: 'Terlambat',
        reporter: 'Guru',
        initialAction: 'Teguran',
        counselorName: 'Bu BK',
        status: 'Sedang ditangani',
        photoDriveFileId: 'oldDriveId123456',
        photoUrl: 'https://drive.google.com/thumbnail?id=oldDriveId123456&sz=w1200',
        academicYear: '2026/2027',
        lockBy: 'tab_stale',
        lockByName: 'Other User',
        lockExpiresAt: 999999,
      },
    ],
    auditLogs: [
      { id: 'aud_existing', userEmail: 'a@b.c', userName: 'Admin', action: 'OLD', target: 'X', timestamp: '2026-01-01' },
      { id: 'aud_new', userEmail: 'a@b.c', userName: 'Admin', action: 'NEW', target: 'Y', timestamp: '2026-01-02' },
    ],
    students: Array.from({ length: 405 }, (_, i) => ({
      id: `stu_${i}`,
      nis: String(1000 + i),
      fullName: `Siswa ${i}`,
      classId: 'cls_1',
    })),
  };

  const plan = planFirestoreRestoreOperations({
    backup,
    existingAuditLogIds: new Set(['aud_existing']),
    restoredDriveMap: {
      oldDriveId123456: {
        fileId: 'newDriveId999999',
        webViewLink: 'https://drive.google.com/file/d/newDriveId999999/view',
        thumbnailUrl: 'https://drive.google.com/thumbnail?id=newDriveId999999&sz=w1200',
      },
    },
    batchSize: 400,
  });

  assert.equal(plan.skippedExistingAuditLogs, 1);
  // 1 settings + 1 case + 1 new audit + 405 students = 408 writes => 2 batches (400 + 8)
  assert.equal(plan.writes.length, 408);
  assert.equal(plan.batches.length, 2);
  assert.equal(plan.batches[0].length, 400);
  assert.equal(plan.batches[1].length, 8);

  const restoredCase = plan.writes.find((w) => w.colName === 'cases' && w.docId === 'cas_1');
  assert.ok(restoredCase);
  assert.equal(restoredCase.payload.photoDriveFileId, 'newDriveId999999');
  assert.equal(
    restoredCase.payload.photoDriveWebViewLink,
    'https://drive.google.com/file/d/newDriveId999999/view'
  );
  assert.equal(restoredCase.payload.caseNumber, 2);
  assert.equal('lockBy' in restoredCase.payload, false);
});

test('relinkCasesWithRestoredDriveFiles preserves unmapped cases and updates mapped ones', () => {
  const relinked = relinkCasesWithRestoredDriveFiles(
    [
      { id: 'c1', photoDriveFileId: 'old1' },
      { id: 'c2', photoUrl: 'data:image/jpeg;base64,abc' },
    ],
    {
      old1: {
        fileId: 'new1',
        webViewLink: 'https://drive.google.com/file/d/new1/view',
        thumbnailUrl: 'https://drive.google.com/thumbnail?id=new1&sz=w1200',
      },
    }
  );
  assert.equal(relinked[0].photoDriveFileId, 'new1');
  assert.equal(relinked[1].photoUrl, 'data:image/jpeg;base64,abc');
});

test('sanitizeRecordForFirestore strips undefined and formats restore error cleanly', () => {
  const cleaned = sanitizeRecordForFirestore('classes', {
    id: 'cls_1',
    name: 'VII-A',
    academicYear: '2026/2027',
    archived: undefined,
  });
  assert.equal('id' in cleaned, false);
  assert.equal('archived' in cleaned, false);

  const msg = formatRestoreErrorMessage(
    new Error(JSON.stringify({ error: 'Missing or insufficient permissions.', path: 'settings/global' }))
  );
  assert.match(msg, /Izin tulis Firestore ditolak/);
});
