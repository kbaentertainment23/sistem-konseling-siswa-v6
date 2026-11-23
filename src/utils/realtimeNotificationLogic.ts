import type { CounselingLog, ParentCall, StudentCase } from '../types/sibk';

export type RealtimeNotificationKind = 'counseling' | 'case' | 'parent-call';
export type RealtimeEntityName = 'cases' | 'counselingLogs' | 'parentCalls';

export interface RealtimeNotification {
  id: string;
  kind: RealtimeNotificationKind;
  title: string;
  message: string;
  actorName: string;
  studentName: string;
  targetSection: 'cases' | 'parent-calls';
  createdAt: number;
}

export interface RealtimeCollectionTracker {
  initialized: boolean;
  seenIds: Set<string>;
}

export interface RealtimeTrackerMap {
  cases: RealtimeCollectionTracker;
  counselingLogs: RealtimeCollectionTracker;
  parentCalls: RealtimeCollectionTracker;
}

export function createInitialRealtimeTrackers(): RealtimeTrackerMap {
  return {
    cases: { initialized: false, seenIds: new Set<string>() },
    counselingLogs: { initialized: false, seenIds: new Set<string>() },
    parentCalls: { initialized: false, seenIds: new Set<string>() },
  };
}

export interface DetectRealtimeAdditionsParams<T extends { id: string }> {
  entity: RealtimeEntityName;
  tracker: RealtimeCollectionTracker;
  records: T[];
  fromCache: boolean;
  pendingWriteIds: Set<string>;
  localCreatedIds: Set<string>;
  studentsById: Map<string, string>;
  casesById: Map<string, string>;
  sessionStartedAtMs: number;
  nowMs?: number;
}

const STALE_THRESHOLD_MS = 120_000;

function isRecordRecentEnough(updatedAt: unknown, sessionStartedAtMs: number): boolean {
  if (typeof updatedAt !== 'string' || !updatedAt.trim()) return true;
  const parsed = Date.parse(updatedAt);
  if (Number.isNaN(parsed)) return true;
  return parsed >= sessionStartedAtMs - STALE_THRESHOLD_MS;
}

export function detectRealtimeAdditions<
  T extends StudentCase | CounselingLog | ParentCall,
>(params: DetectRealtimeAdditionsParams<T>): RealtimeNotification[] {
  const {
    entity,
    tracker,
    records,
    fromCache,
    pendingWriteIds,
    localCreatedIds,
    studentsById,
    casesById,
    sessionStartedAtMs,
    nowMs = Date.now(),
  } = params;

  if (!tracker.initialized) {
    // Wait until either server snapshot arrives (!fromCache) or cached records are present
    if (records.length > 0 || !fromCache) {
      for (const r of records) {
        tracker.seenIds.add(r.id);
      }
      tracker.initialized = true;
    }
    return [];
  }

  const notifications: RealtimeNotification[] = [];

  for (const record of records) {
    if (tracker.seenIds.has(record.id)) continue;
    tracker.seenIds.add(record.id);

    if (pendingWriteIds.has(record.id) || localCreatedIds.has(record.id)) {
      continue;
    }

    if (!isRecordRecentEnough(record.updatedAt, sessionStartedAtMs)) {
      continue;
    }

    if (entity === 'counselingLogs') {
      const log = record as CounselingLog;
      const actorName = (log.counselorName || log.updatedBy || 'Guru BK lain').trim();
      const studentName =
        studentsById.get(log.studentId) || casesById.get(log.caseId) || 'Siswa';
      const detail = (log.topic || log.progressStatus || 'Sesi Konseling').trim();
      notifications.push({
        id: `notif_clog_${log.id}`,
        kind: 'counseling',
        title: 'Catatan Konseling Baru',
        message: `${actorName} menambahkan sesi konseling untuk ${studentName} (${detail}).`,
        actorName,
        studentName,
        targetSection: 'cases',
        createdAt: nowMs,
      });
    } else if (entity === 'cases') {
      const c = record as StudentCase;
      const actorName = (c.updatedBy || c.counselorName || c.reporter || 'Guru lain').trim();
      const studentName = c.studentName || studentsById.get(c.studentId) || 'Siswa';
      notifications.push({
        id: `notif_case_${c.id}`,
        kind: 'case',
        title: 'Data Kasus / Konseling Baru',
        message: `${actorName} mencatat kasus ke-${c.caseNumber} untuk ${studentName} (${c.category}).`,
        actorName,
        studentName,
        targetSection: 'cases',
        createdAt: nowMs,
      });
    } else if (entity === 'parentCalls') {
      const p = record as ParentCall;
      const actorName = (p.updatedBy || 'Guru BK lain').trim();
      const studentName = p.studentName || studentsById.get(p.studentId) || 'Siswa';
      notifications.push({
        id: `notif_pcall_${p.id}`,
        kind: 'parent-call',
        title: 'Pemanggilan Orang Tua Baru',
        message: `${actorName} menambahkan pemanggilan orang tua untuk ${studentName} (${p.status}).`,
        actorName,
        studentName,
        targetSection: 'parent-calls',
        createdAt: nowMs,
      });
    }
  }

  return notifications;
}

export function appendNotificationsCapped(
  existing: RealtimeNotification[],
  incoming: RealtimeNotification[],
  maxItems = 3
): RealtimeNotification[] {
  if (incoming.length === 0) return existing;
  const seen = new Set(existing.map((n) => n.id));
  const merged = [...existing];
  for (const item of incoming) {
    if (!seen.has(item.id)) {
      seen.add(item.id);
      merged.push(item);
    }
  }
  if (merged.length <= maxItems) return merged;
  return merged.slice(merged.length - maxItems);
}
