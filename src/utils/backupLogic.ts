import type {
  AttendanceRecord,
  AuditLog,
  BKSchedule,
  CounselingLog,
  MonitoringNote,
  ParentCall,
  SchoolClass,
  Student,
  StudentCase,
  SystemSettings,
  UserAccount,
} from '../types/sibk';

export const FIRESTORE_MUTABLE_COLLECTIONS = [
  'classes',
  'students',
  'attendance',
  'cases',
  'counselingLogs',
  'parentCalls',
  'monitoringNotes',
  'schedules',
  'users',
] as const;

export const FIRESTORE_ALL_COLLECTIONS = [
  ...FIRESTORE_MUTABLE_COLLECTIONS,
  'auditLogs',
] as const;

export type BackupCollectionKey = (typeof FIRESTORE_ALL_COLLECTIONS)[number];

export interface BackedUpDriveFile {
  originalFileId: string;
  name: string;
  mimeType: string;
  sizeBytes?: number;
  base64Data: string;
  webViewLink?: string;
  linkedCaseIds: string[];
  source: 'case_ref' | 'folder_scan' | 'both';
}

export interface BackupDriveFailure {
  fileId: string;
  name?: string;
  reason: string;
}

export interface BackupMeta {
  driveIncluded: boolean;
  driveFolderId: string | null;
  driveAccountEmail: string | null;
  driveFilesCount: number;
  driveFailedFiles: BackupDriveFailure[];
  totalFirestoreDocs: number;
}

export interface BackupPayloadV3 {
  backupVersion: 3;
  exportedAt: string;
  exportedBy?: string;
  settings: SystemSettings;
  classes: SchoolClass[];
  students: Student[];
  attendance: AttendanceRecord[];
  cases: StudentCase[];
  counselingLogs: CounselingLog[];
  parentCalls: ParentCall[];
  monitoringNotes: MonitoringNote[];
  schedules: BKSchedule[];
  users: UserAccount[];
  auditLogs: AuditLog[];
  driveFiles: BackedUpDriveFile[];
  backupMeta: BackupMeta;
}

export interface RestoredDriveLinkInfo {
  fileId: string;
  webViewLink: string;
  thumbnailUrl: string;
}

export interface BackupSummary {
  valid: boolean;
  backupVersion: number;
  exportedAt: string | null;
  hasSettings: boolean;
  counts: {
    classes: number;
    students: number;
    attendance: number;
    cases: number;
    counselingLogs: number;
    parentCalls: number;
    monitoringNotes: number;
    schedules: number;
    users: number;
    auditLogs: number;
    driveFiles: number;
  };
  casesWithDrivePhotoCount: number;
  totalDriveBytes: number;
  totalFirestoreDocs: number;
  warnings: string[];
}

export interface PlannedFirestoreWrite {
  colName: string;
  docId: string;
  payload: Record<string, unknown>;
}

export interface PlannedRestoreResult {
  settingsWrite: PlannedFirestoreWrite | null;
  writes: PlannedFirestoreWrite[];
  batches: PlannedFirestoreWrite[][];
  skippedExistingAuditLogs: number;
  skippedInvalidRecords: number;
}

const VALID_DOC_ID_REGEX = /^[a-zA-Z0-9_-]{1,128}$/;

export function isValidFirestoreDocId(id: unknown): id is string {
  return typeof id === 'string' && VALID_DOC_ID_REGEX.test(id);
}

export function sanitizeBackupDocId(
  rawId: unknown,
  fallbackPrefix: string,
  fallbackIndex: number
): string {
  if (isValidFirestoreDocId(rawId)) return rawId;
  if (typeof rawId === 'string') {
    const cleaned = rawId
      .trim()
      .replace(/[^a-zA-Z0-9_-]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 128);
    if (isValidFirestoreDocId(cleaned)) {
      return cleaned;
    }
  }
  const safePrefix =
    fallbackPrefix.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 16) || 'doc';
  return `${safePrefix}_restored_${fallbackIndex}`;
}

export function stripUndefinedDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value
      .filter((item) => item !== undefined)
      .map((item) => stripUndefinedDeep(item));
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v !== undefined) {
        out[k] = stripUndefinedDeep(v);
      }
    }
    return out;
  }
  return value;
}

export function sanitizeRecordForFirestore(
  colName: BackupCollectionKey | 'settings',
  rawRecord: Record<string, unknown>
): Record<string, unknown> {
  const { id: _omitId, ...rest } = rawRecord;
  const cleaned = stripUndefinedDeep(rest) as Record<string, unknown>;

  if (colName === 'cases') {
    // Ensure firestore.rules requirements: studentId string, caseNumber number, category/description strings
    cleaned.studentId = typeof cleaned.studentId === 'string' ? cleaned.studentId : '';
    const parsedNum = Number(cleaned.caseNumber);
    cleaned.caseNumber = Number.isFinite(parsedNum) && parsedNum > 0 ? parsedNum : 1;
    cleaned.category = typeof cleaned.category === 'string' ? cleaned.category.slice(0, 80) : 'Lainnya';
    cleaned.description =
      typeof cleaned.description === 'string' ? cleaned.description.slice(0, 1500) : '';
    // Clear stale ephemeral edit locks from another session
    delete cleaned.lockBy;
    delete cleaned.lockByName;
    delete cleaned.lockExpiresAt;
  } else if (colName === 'parentCalls') {
    cleaned.studentId = typeof cleaned.studentId === 'string' ? cleaned.studentId : '';
    cleaned.reason = typeof cleaned.reason === 'string' ? cleaned.reason.slice(0, 800) : '';
    delete cleaned.lockBy;
    delete cleaned.lockByName;
    delete cleaned.lockExpiresAt;
  } else if (colName === 'classes') {
    cleaned.name = typeof cleaned.name === 'string' ? cleaned.name.slice(0, 40) : '';
    cleaned.academicYear =
      typeof cleaned.academicYear === 'string' ? cleaned.academicYear.slice(0, 20) : '';
  } else if (colName === 'students') {
    cleaned.nis = typeof cleaned.nis === 'string' ? cleaned.nis.slice(0, 32) : '';
    cleaned.fullName = typeof cleaned.fullName === 'string' ? cleaned.fullName.slice(0, 140) : '';
    cleaned.classId = typeof cleaned.classId === 'string' ? cleaned.classId.slice(0, 64) : '';
  } else if (colName === 'attendance') {
    cleaned.date = typeof cleaned.date === 'string' ? cleaned.date.slice(0, 16) : '';
    cleaned.studentId = typeof cleaned.studentId === 'string' ? cleaned.studentId.slice(0, 64) : '';
    const allowedStatuses = ['Hadir', 'Sakit', 'Izin', 'Alpa', 'Dispensasi'];
    if (!allowedStatuses.includes(String(cleaned.status))) {
      cleaned.status = 'Hadir';
    }
  } else if (colName === 'counselingLogs') {
    cleaned.caseId = typeof cleaned.caseId === 'string' ? cleaned.caseId.slice(0, 64) : '';
    cleaned.studentId = typeof cleaned.studentId === 'string' ? cleaned.studentId.slice(0, 64) : '';
    cleaned.result = typeof cleaned.result === 'string' ? cleaned.result.slice(0, 1500) : '';
  } else if (colName === 'monitoringNotes') {
    cleaned.studentId = typeof cleaned.studentId === 'string' ? cleaned.studentId.slice(0, 64) : '';
    cleaned.observation =
      typeof cleaned.observation === 'string' ? cleaned.observation.slice(0, 1200) : '';
  } else if (colName === 'auditLogs') {
    cleaned.action = typeof cleaned.action === 'string' ? cleaned.action.slice(0, 120) : 'AUDIT';
  }

  return cleaned;
}

export function extractDriveFileIdFromCase(item: Partial<StudentCase>): string | null {
  if (typeof item.photoDriveFileId === 'string' && item.photoDriveFileId.trim().length > 0) {
    return item.photoDriveFileId.trim();
  }
  const candidates = [item.photoDriveWebViewLink, item.photoUrl];
  for (const url of candidates) {
    if (typeof url !== 'string' || !url.trim()) continue;
    const dMatch = url.match(/\/file\/d\/([a-zA-Z0-9_-]{10,})/);
    if (dMatch?.[1]) return dMatch[1];
    const idMatch = url.match(/[?&]id=([a-zA-Z0-9_-]{10,})/);
    if (idMatch?.[1]) return idMatch[1];
  }
  return null;
}

export function buildBackupPayload(params: {
  exportedAt?: string;
  exportedBy?: string;
  settings: SystemSettings;
  classes: SchoolClass[];
  students: Student[];
  attendance: AttendanceRecord[];
  cases: StudentCase[];
  counselingLogs: CounselingLog[];
  parentCalls: ParentCall[];
  monitoringNotes: MonitoringNote[];
  schedules: BKSchedule[];
  users: UserAccount[];
  auditLogs: AuditLog[];
  driveFiles?: BackedUpDriveFile[];
  driveIncluded?: boolean;
  driveFolderId?: string | null;
  driveAccountEmail?: string | null;
  driveFailedFiles?: BackupDriveFailure[];
}): BackupPayloadV3 {
  const driveFiles = params.driveFiles ?? [];
  const totalFirestoreDocs =
    1 +
    params.classes.length +
    params.students.length +
    params.attendance.length +
    params.cases.length +
    params.counselingLogs.length +
    params.parentCalls.length +
    params.monitoringNotes.length +
    params.schedules.length +
    params.users.length +
    params.auditLogs.length;

  return {
    backupVersion: 3,
    exportedAt: params.exportedAt || new Date().toISOString(),
    exportedBy: params.exportedBy,
    settings: params.settings,
    classes: params.classes,
    students: params.students,
    attendance: params.attendance,
    cases: params.cases,
    counselingLogs: params.counselingLogs,
    parentCalls: params.parentCalls,
    monitoringNotes: params.monitoringNotes,
    schedules: params.schedules,
    users: params.users,
    auditLogs: params.auditLogs,
    driveFiles,
    backupMeta: {
      driveIncluded: Boolean(params.driveIncluded),
      driveFolderId: params.driveFolderId ?? null,
      driveAccountEmail: params.driveAccountEmail ?? null,
      driveFilesCount: driveFiles.length,
      driveFailedFiles: params.driveFailedFiles ?? [],
      totalFirestoreDocs,
    },
  };
}

export function estimateBase64Bytes(base64: string): number {
  if (!base64) return 0;
  const clean = base64.replace(/\s+/g, '');
  const padding = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((clean.length * 3) / 4) - padding);
}

export function validateAndSummarizeBackupPayload(parsed: unknown): BackupSummary {
  const emptyCounts = {
    classes: 0,
    students: 0,
    attendance: 0,
    cases: 0,
    counselingLogs: 0,
    parentCalls: 0,
    monitoringNotes: 0,
    schedules: 0,
    users: 0,
    auditLogs: 0,
    driveFiles: 0,
  };

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      valid: false,
      backupVersion: 0,
      exportedAt: null,
      hasSettings: false,
      counts: emptyCounts,
      casesWithDrivePhotoCount: 0,
      totalDriveBytes: 0,
      totalFirestoreDocs: 0,
      warnings: ['File bukan objek JSON backup SIBK yang valid.'],
    };
  }

  const record = parsed as Record<string, unknown>;
  const knownKeys = ['settings', ...FIRESTORE_ALL_COLLECTIONS, 'driveFiles'];
  const hasKnownKey = knownKeys.some((k) => k in record);
  if (!hasKnownKey) {
    return {
      valid: false,
      backupVersion: 0,
      exportedAt: null,
      hasSettings: false,
      counts: emptyCounts,
      casesWithDrivePhotoCount: 0,
      totalDriveBytes: 0,
      totalFirestoreDocs: 0,
      warnings: ['Format file JSON tidak dikenali sebagai file backup SIBK.'],
    };
  }

  const arrLen = (key: string) => (Array.isArray(record[key]) ? record[key].length : 0);
  const hasSettings = Boolean(
    record.settings && typeof record.settings === 'object' && !Array.isArray(record.settings)
  );
  const driveFilesArr = Array.isArray(record.driveFiles)
    ? (record.driveFiles as Partial<BackedUpDriveFile>[])
    : [];
  const validDriveFiles = driveFilesArr.filter(
    (f) => f && typeof f === 'object' && typeof f.base64Data === 'string' && f.base64Data.length > 0
  );

  const casesArr = Array.isArray(record.cases) ? (record.cases as Partial<StudentCase>[]) : [];
  const casesWithDrivePhotoCount = casesArr.filter((c) => Boolean(extractDriveFileIdFromCase(c))).length;

  const counts = {
    classes: arrLen('classes'),
    students: arrLen('students'),
    attendance: arrLen('attendance'),
    cases: arrLen('cases'),
    counselingLogs: arrLen('counselingLogs'),
    parentCalls: arrLen('parentCalls'),
    monitoringNotes: arrLen('monitoringNotes'),
    schedules: arrLen('schedules'),
    users: arrLen('users'),
    auditLogs: arrLen('auditLogs'),
    driveFiles: validDriveFiles.length,
  };

  const totalDriveBytes = validDriveFiles.reduce(
    (sum, f) => sum + (typeof f.sizeBytes === 'number' ? f.sizeBytes : estimateBase64Bytes(f.base64Data || '')),
    0
  );

  const totalFirestoreDocs =
    (hasSettings ? 1 : 0) +
    counts.classes +
    counts.students +
    counts.attendance +
    counts.cases +
    counts.counselingLogs +
    counts.parentCalls +
    counts.monitoringNotes +
    counts.schedules +
    counts.users +
    counts.auditLogs;

  const warnings: string[] = [];
  if (casesWithDrivePhotoCount > 0 && validDriveFiles.length === 0) {
    warnings.push(
      `File backup ini memiliki ${casesWithDrivePhotoCount} kasus dengan tautan Google Drive, namun tidak menyertakan salinan file foto dari Google Drive (backup lama / mode database saja).`
    );
  }

  return {
    valid: true,
    backupVersion: typeof record.backupVersion === 'number' ? record.backupVersion : 1,
    exportedAt: typeof record.exportedAt === 'string' ? record.exportedAt : null,
    hasSettings,
    counts,
    casesWithDrivePhotoCount,
    totalDriveBytes,
    totalFirestoreDocs,
    warnings,
  };
}

export function relinkCasesWithRestoredDriveFiles(
  rawCases: unknown[],
  restoredFileMap: Record<string, RestoredDriveLinkInfo>
): StudentCase[] {
  return rawCases
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
    .map((item) => {
      const c = { ...(item as unknown as StudentCase) };
      const origId = extractDriveFileIdFromCase(c);
      if (origId && restoredFileMap[origId]) {
        const mapped = restoredFileMap[origId];
        c.photoDriveFileId = mapped.fileId;
        c.photoDriveWebViewLink = mapped.webViewLink;
        c.photoUrl = mapped.thumbnailUrl;
      }
      return c;
    });
}

export function chunkWriteOperations<T>(items: T[], chunkSize = 400): T[][] {
  if (chunkSize <= 0) return [items];
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push(items.slice(i, i + chunkSize));
  }
  return chunks;
}

export function planFirestoreRestoreOperations(params: {
  backup: Record<string, unknown>;
  existingAuditLogIds?: Set<string>;
  restoredDriveMap?: Record<string, RestoredDriveLinkInfo>;
  batchSize?: number;
}): PlannedRestoreResult {
  const {
    backup,
    existingAuditLogIds = new Set<string>(),
    restoredDriveMap = {},
    batchSize = 400,
  } = params;

  let settingsWrite: PlannedFirestoreWrite | null = null;
  if (backup.settings && typeof backup.settings === 'object' && !Array.isArray(backup.settings)) {
    settingsWrite = {
      colName: 'settings',
      docId: 'global',
      payload: sanitizeRecordForFirestore('settings', backup.settings as Record<string, unknown>),
    };
  }

  const writes: PlannedFirestoreWrite[] = [];
  let skippedExistingAuditLogs = 0;
  let skippedInvalidRecords = 0;

  if (settingsWrite) {
    writes.push(settingsWrite);
  }

  for (const colName of FIRESTORE_ALL_COLLECTIONS) {
    const rawValue = backup[colName];
    if (!Array.isArray(rawValue)) continue;

    const rawItems: unknown[] =
      colName === 'cases' && Object.keys(restoredDriveMap).length > 0
        ? relinkCasesWithRestoredDriveFiles(rawValue, restoredDriveMap)
        : rawValue;

    for (let idx = 0; idx < rawItems.length; idx += 1) {
      const rawItem = rawItems[idx];
      if (!rawItem || typeof rawItem !== 'object' || Array.isArray(rawItem)) {
        skippedInvalidRecords += 1;
        continue;
      }
      const record = rawItem as Record<string, unknown>;
      const docId = sanitizeBackupDocId(record.id, colName.slice(0, 3), idx + 1);

      if (colName === 'auditLogs' && existingAuditLogIds.has(docId)) {
        skippedExistingAuditLogs += 1;
        continue;
      }

      writes.push({
        colName,
        docId,
        payload: sanitizeRecordForFirestore(colName, record),
      });
    }
  }

  return {
    settingsWrite,
    writes,
    batches: chunkWriteOperations(writes, batchSize),
    skippedExistingAuditLogs,
    skippedInvalidRecords,
  };
}

export function formatRestoreErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err || '');
  if (!raw) return 'Gagal memulihkan data ke database.';
  if (raw.startsWith('{') && raw.includes('"error"')) {
    try {
      const parsed = JSON.parse(raw) as { error?: string; path?: string };
      const detail = parsed.error || raw;
      if (detail.toLowerCase().includes('permission') || detail.toLowerCase().includes('insufficient')) {
        return `Izin tulis Firestore ditolak (${parsed.path || 'database'}). Pastikan Anda login menggunakan akun Google Administrator yang terdaftar sebelum menjalankan Restore.`;
      }
      return `Gagal menulis ke Firestore (${parsed.path || 'database'}): ${detail}`;
    } catch {
      return raw;
    }
  }
  return raw;
}
