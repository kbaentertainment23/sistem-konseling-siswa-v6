import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User as FirebaseUser,
} from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  runTransaction,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import {
  auth,
  db,
  googleProvider,
  handleFirestoreError,
  OperationType,
} from '../lib/firebase';
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
  UserRole,
} from '../types/sibk';
import {
  buildAttendanceId,
  computeNextCaseNumberInTransaction,
  DEFAULT_SETTINGS,
  getIndonesianDayName,
  getNextCaseNumber,
} from '../utils/sibkLogic';
import {
  isParentCallCompleted,
  parseMeetingSchedule,
} from '../utils/parentCallLogic';
import {
  ADVISORY_LOCK_TTL_MS,
  checkAdvisoryLock,
  mergeRecordWithBase,
  reconcileCollectionWithPending,
  type LockCheckResult,
  type PendingOverlayOp,
} from '../utils/concurrencyMerge';
import {
  PersistentSyncQueue,
  type QueuedSyncItem,
  type SyncQueueSnapshot,
} from '../utils/syncQueue';
import {
  appendNotificationsCapped,
  createInitialRealtimeTrackers,
  detectRealtimeAdditions,
  type RealtimeEntityName,
  type RealtimeNotification,
  type RealtimeTrackerMap,
} from '../utils/realtimeNotificationLogic';
import {
  extractDriveFileIdFromCase,
  planFirestoreRestoreOperations,
  relinkCasesWithRestoredDriveFiles,
  type BackedUpDriveFile,
  type RestoredDriveLinkInfo,
} from '../utils/backupLogic';
import { restoreDriveFilesToGoogleDrive } from '../lib/googleDrive';

export interface BackupDatabaseSnapshot {
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
}

export interface RestoreBackupOptions {
  restoreDriveFiles?: boolean;
  targetFolderUrl?: string;
  driveAccessToken?: string | null;
  onProgress?: (message: string) => void;
}

export interface RestoreExecutionResult {
  restoredDocs: number;
  skippedAuditLogs: number;
  restoredDriveFiles: number;
  reusedExistingDriveFiles: number;
  driveWarnings: string[];
}

const SYSTEM_USERS: UserAccount[] = [
  {
    id: 'usr_admin',
    uid: 'usr_admin',
    email: 'admin@sekolah.sch.id',
    name: 'Administrator SIBK',
    role: 'Administrator',
    active: true,
    createdAt: new Date().toISOString(),
  },
  {
    id: 'usr_guru',
    uid: 'usr_guru',
    email: 'gurubk@sekolah.sch.id',
    name: 'Guru BK',
    role: 'Guru BK',
    active: true,
    createdAt: new Date().toISOString(),
  },
];

interface SibkContextValue {
  authReady: boolean;
  isDemoMode: boolean;
  currentUser: UserAccount | null;
  loginWithCredentials: (
    username: string,
    password: string
  ) => Promise<{ ok: boolean; error?: string }>;
  loginWithGoogle: () => Promise<void>;
  enterDemoMode: (role?: UserRole) => void;
  logout: () => Promise<void>;

  // Data collections
  users: UserAccount[];
  classes: SchoolClass[];
  students: Student[];
  attendance: AttendanceRecord[];
  cases: StudentCase[];
  counselingLogs: CounselingLog[];
  parentCalls: ParentCall[];
  monitoringNotes: MonitoringNote[];
  schedules: BKSchedule[];
  settings: SystemSettings;
  auditLogs: AuditLog[];

  // Permission helpers
  isAdmin: boolean;
  isCounselor: boolean;
  isHomeroom: boolean;
  canViewCounseling: boolean;
  canManageClasses: boolean;
  canDeleteRecords: boolean;

  // CRUD actions
  saveStudent: (data: Omit<Student, 'id'> & { id?: string }) => Promise<void>;
  deleteStudent: (id: string) => Promise<void>;
  bulkImportStudents: (rows: Array<Omit<Student, 'id'>>) => Promise<number>;
  moveStudentClass: (studentId: string, newClassId: string, newClassName: string) => Promise<void>;
  bulkPromoteOrGraduateStudents: (params: {
    mode: 'promote' | 'graduate';
    sourceClassId: string;
    targetClassId?: string;
    studentIds: string[];
    archiveSourceClass: boolean;
  }) => Promise<number>;

  saveClass: (data: Omit<SchoolClass, 'id'> & { id?: string }) => Promise<void>;
  deleteClass: (id: string) => Promise<void>;

  saveAttendanceBatch: (records: Array<Omit<AttendanceRecord, 'id'>>) => Promise<void>;
  deleteAttendanceByDateAndClass: (date: string, classId: string) => Promise<number>;

  addCaseWithAutoNumber: (
    data: Omit<StudentCase, 'id' | 'caseNumber' | 'dayName'>
  ) => Promise<StudentCase>;
  updateCase: (
    id: string,
    patch: Partial<StudentCase>,
    baseRecord?: Partial<StudentCase>
  ) => Promise<void>;
  deleteCase: (id: string) => Promise<void>;

  addCounselingLog: (data: Omit<CounselingLog, 'id'>) => Promise<void>;

  saveParentCall: (
    data: Omit<ParentCall, 'id'> & { id?: string },
    baseRecord?: Partial<ParentCall>
  ) => Promise<void>;
  deleteParentCall: (id: string) => Promise<void>;
  markStudentParentCallCompleted: (studentId: string) => Promise<void>;

  acquireRecordLock: (col: 'cases' | 'parentCalls', id: string) => Promise<LockCheckResult>;
  releaseRecordLock: (col: 'cases' | 'parentCalls', id: string) => Promise<void>;
  syncError: string | null;
  clearSyncError: () => void;
  realtimeNotifications: RealtimeNotification[];
  dismissRealtimeNotification: (id: string) => void;

  addMonitoringNote: (data: Omit<MonitoringNote, 'id'>) => Promise<void>;
  updateMonitoringNote: (id: string, patch: Partial<Omit<MonitoringNote, 'id'>>) => Promise<void>;
  deleteMonitoringNote: (id: string) => Promise<void>;
  updateStudentMonitoringStatus: (studentId: string, status: Student['monitoringStatus']) => Promise<void>;

  saveSchedule: (data: Omit<BKSchedule, 'id'> & { id?: string }) => Promise<void>;
  deleteSchedule: (id: string) => Promise<void>;

  saveUserAccount: (data: Omit<UserAccount, 'id'> & { id?: string }) => Promise<void>;
  deleteUserAccount: (id: string) => Promise<void>;

  saveSettings: (data: SystemSettings) => Promise<void>;
  createFullBackupSnapshot: () => Promise<BackupDatabaseSnapshot>;
  restoreFromBackupJSON: (
    backup: Record<string, unknown>,
    options?: RestoreBackupOptions
  ) => Promise<RestoreExecutionResult>;
}

const SibkContext = createContext<SibkContextValue | null>(null);

interface CaseCreatePayload {
  record: StudentCase;
}
interface CaseUpdatePayload {
  patch: Partial<StudentCase>;
  baseRecord?: Partial<StudentCase>;
  actorName: string;
}
interface CaseDeletePayload {
  studentId?: string;
  syncedScheduleId: string;
  remainingCaseIds: string[];
}
interface CounselingLogCreatePayload {
  record: CounselingLog;
  syncedScheduleRecord: BKSchedule | null;
  syncedScheduleId: string;
}
interface ParentCallSavePayload {
  record: ParentCall;
  baseRecord?: Partial<ParentCall>;
  syncedScheduleRecord: BKSchedule | null;
  syncedScheduleId: string;
  isCompletedCall: boolean;
  actorName: string;
}
interface ParentCallDeletePayload {
  syncedScheduleId: string;
}

function getTabInstanceId(): string {
  if (typeof sessionStorage === 'undefined') return 'tab_srv';
  let tabId = sessionStorage.getItem('sibk_tab_id');
  if (!tabId) {
    tabId = Math.random().toString(36).slice(2, 10);
    sessionStorage.setItem('sibk_tab_id', tabId);
  }
  return tabId;
}

function makeId(prefix: string): string {
  const entropy =
    typeof globalThis !== 'undefined' &&
    typeof globalThis.crypto !== 'undefined' &&
    typeof globalThis.crypto.randomUUID === 'function'
      ? globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 10)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now()}_${entropy}`;
}

function stripUndefined<T extends object>(obj: T): Record<string, unknown> {
  return Object.fromEntries(Object.entries(obj).filter(([, value]) => value !== undefined));
}

function omitId<T extends object>(obj: Partial<T> | undefined): Partial<T> | undefined {
  if (!obj) return undefined;
  const { id: _id, ...rest } = obj as Record<string, unknown>;
  return rest as Partial<T>;
}

export const SibkProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [authReady, setAuthReady] = useState(false);
  const [isDemoMode, setIsDemoMode] = useState(false);
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [currentUser, setCurrentUser] = useState<UserAccount | null>(null);

  const [users, setUsers] = useState<UserAccount[]>([]);
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
  const [serverCases, setServerCases] = useState<StudentCase[]>([]);
  const [serverCounselingLogs, setServerCounselingLogs] = useState<CounselingLog[]>([]);
  const [serverParentCalls, setServerParentCalls] = useState<ParentCall[]>([]);
  const [monitoringNotes, setMonitoringNotes] = useState<MonitoringNote[]>([]);
  const [schedules, setSchedules] = useState<BKSchedule[]>([]);
  const [settings, setSettings] = useState<SystemSettings>(() => {
    try {
      const cached = localStorage.getItem('sibk_public_branding');
      if (cached) {
        const parsed = JSON.parse(cached) as Partial<SystemSettings>;
        return { ...DEFAULT_SETTINGS, ...parsed };
      }
    } catch {
      // Ignore storage errors
    }
    return DEFAULT_SETTINGS;
  });
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);

  const syncQueueRef = useRef<PersistentSyncQueue | null>(null);
  if (!syncQueueRef.current) {
    syncQueueRef.current = new PersistentSyncQueue();
  }
  const [syncSnapshot, setSyncSnapshot] = useState<SyncQueueSnapshot>(() =>
    syncQueueRef.current!.getSnapshot()
  );
  const committedCaseResultsRef = useRef<Map<string, StudentCase>>(new Map());
  const localCreatedIdsRef = useRef<Set<string>>(new Set());
  const realtimeTrackersRef = useRef<RealtimeTrackerMap>(createInitialRealtimeTrackers());
  const sessionStartMsRef = useRef<number>(Date.now());
  const [realtimeNotifications, setRealtimeNotifications] = useState<RealtimeNotification[]>([]);

  const dismissRealtimeNotification = useCallback((id: string) => {
    setRealtimeNotifications((prev) => prev.filter((n) => n.id !== id));
  }, []);

  useEffect(() => {
    return syncQueueRef.current!.subscribe(setSyncSnapshot);
  }, []);

  useEffect(() => {
    for (const op of syncSnapshot.pendingByEntity.cases) {
      if (op.action === 'create') localCreatedIdsRef.current.add(op.docId);
    }
    for (const op of syncSnapshot.pendingByEntity.counselingLogs) {
      if (op.action === 'create') localCreatedIdsRef.current.add(op.docId);
    }
    for (const op of syncSnapshot.pendingByEntity.parentCalls) {
      if (op.action === 'create') localCreatedIdsRef.current.add(op.docId);
    }
  }, [syncSnapshot]);

  const cases = useMemo(() => {
    const caseOps: Array<PendingOverlayOp<StudentCase>> = syncSnapshot.pendingByEntity.cases.map(
      (op) => {
        if (op.action === 'create') {
          return {
            opId: op.opId,
            docId: op.docId,
            action: 'create',
            data: (op.payload as CaseCreatePayload).record,
          };
        }
        if (op.action === 'update') {
          return {
            opId: op.opId,
            docId: op.docId,
            action: 'update',
            data: (op.payload as CaseUpdatePayload).patch,
          };
        }
        return { opId: op.opId, docId: op.docId, action: 'delete' };
      }
    );

    const logCaseStatusOps: Array<PendingOverlayOp<StudentCase>> =
      syncSnapshot.pendingByEntity.counselingLogs.map((op) => {
        const payload = op.payload as CounselingLogCreatePayload;
        return {
          opId: `${op.opId}_case_status`,
          docId: payload.record.caseId,
          action: 'update',
          data: { status: payload.record.progressStatus },
        };
      });

    return reconcileCollectionWithPending(serverCases, [...caseOps, ...logCaseStatusOps]);
  }, [serverCases, syncSnapshot.pendingByEntity.cases, syncSnapshot.pendingByEntity.counselingLogs]);

  const counselingLogs = useMemo(() => {
    const logOps: Array<PendingOverlayOp<CounselingLog>> =
      syncSnapshot.pendingByEntity.counselingLogs.map((op) => ({
        opId: op.opId,
        docId: op.docId,
        action: 'create',
        data: (op.payload as CounselingLogCreatePayload).record,
      }));
    return reconcileCollectionWithPending(serverCounselingLogs, logOps);
  }, [serverCounselingLogs, syncSnapshot.pendingByEntity.counselingLogs]);

  const parentCalls = useMemo(() => {
    const callOps: Array<PendingOverlayOp<ParentCall>> =
      syncSnapshot.pendingByEntity.parentCalls.map((op) => {
        if (op.action === 'delete') {
          return { opId: op.opId, docId: op.docId, action: 'delete' };
        }
        return {
          opId: op.opId,
          docId: op.docId,
          action: op.action,
          data: (op.payload as ParentCallSavePayload).record,
        };
      });
    return reconcileCollectionWithPending(serverParentCalls, callOps);
  }, [serverParentCalls, syncSnapshot.pendingByEntity.parentCalls]);

  const setCases = setServerCases;
  const setCounselingLogs = setServerCounselingLogs;
  const setParentCalls = setServerParentCalls;

  const currentUserRef = useRef(currentUser);
  currentUserRef.current = currentUser;
  const studentsRef = useRef(students);
  studentsRef.current = students;
  const casesRef = useRef(cases);
  casesRef.current = cases;

  const actorId = useMemo(() => {
    const tabId = getTabInstanceId();
    return currentUser ? `${currentUser.id}_${tabId}` : tabId;
  }, [currentUser]);

  // Restore credential session or support ?autostart=1
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('autostart') === '1') {
      const chosen = SYSTEM_USERS[0];
      setIsDemoMode(false);
      setCurrentUser(chosen);
      setAuthReady(true);
      return;
    }
    const savedUserRaw = sessionStorage.getItem('sibk_session_user');
    if (savedUserRaw) {
      try {
        const parsed = JSON.parse(savedUserRaw) as UserAccount;
        if (parsed && parsed.id && parsed.role) {
          setIsDemoMode(false);
          setCurrentUser(parsed);
          setAuthReady(true);
          return;
        }
      } catch {
        // Ignore malformed session data
      }
    }
    const savedRole = sessionStorage.getItem('sibk_session_role') as UserRole | null;
    if (savedRole === 'Administrator' || savedRole === 'Guru BK') {
      const chosen = SYSTEM_USERS.find((u) => u.role === savedRole) || SYSTEM_USERS[0];
      setIsDemoMode(false);
      setCurrentUser(chosen);
      setAuthReady(true);
    }
  }, []);

  // Firebase Auth listener
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (fbUser) => {
      setFirebaseUser(fbUser);
      if (fbUser) {
        setIsDemoMode(false);
        const savedRole = sessionStorage.getItem('sibk_session_role') as UserRole | null;
        // Preserve credential-based role if user signed in via admin123/guru123 and only connected Google for Drive
        if (!savedRole) {
          try {
            const userRef = doc(db, 'users', fbUser.uid);
            const snap = await getDoc(userRef);
            if (snap.exists()) {
              setCurrentUser({ id: snap.id, ...(snap.data() as Omit<UserAccount, 'id'>) });
            } else {
              const isBootstrapAdmin = fbUser.email === 'sistemni25@gmail.com';
              const newProfile: Omit<UserAccount, 'id'> = {
                uid: fbUser.uid,
                email: fbUser.email || '',
                name: fbUser.displayName || 'Guru BK',
                role: isBootstrapAdmin ? 'Administrator' : 'Guru BK',
                active: true,
                createdAt: new Date().toISOString(),
              };
              await setDoc(userRef, newProfile);
              setCurrentUser({ id: fbUser.uid, ...newProfile });
            }
          } catch (err) {
            console.error('Error loading user profile:', err);
          }
        }
      } else {
        const savedRole = sessionStorage.getItem('sibk_session_role') as UserRole | null;
        if (!savedRole && !isDemoMode) {
          setCurrentUser(null);
        }
      }
      setAuthReady(true);
    });
    return () => unsub();
  }, [isDemoMode]);

  // Firestore real-time listeners whenever any user is logged in (credential login OR Google login)
  useEffect(() => {
    if (isDemoMode || !currentUser) {
      realtimeTrackersRef.current = createInitialRealtimeTrackers();
      setRealtimeNotifications([]);
      return;
    }

    realtimeTrackersRef.current = createInitialRealtimeTrackers();
    sessionStartMsRef.current = Date.now();
    const unsubs: Array<() => void> = [];

    const bindCollection = <T extends { id: string }>(
      colName: string,
      setter: React.Dispatch<React.SetStateAction<T[]>>,
      notifyEntity?: RealtimeEntityName
    ) => {
      const unsub = onSnapshot(
        collection(db, colName),
        (snap) => {
          const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<T, 'id'>) } as T));
          setter(list);

          if (notifyEntity) {
            const pendingWriteIds = new Set<string>();
            for (const d of snap.docs) {
              if (d.metadata.hasPendingWrites) pendingWriteIds.add(d.id);
            }
            const studentsById = new Map<string, string>(
              studentsRef.current.map((s) => [s.id, s.fullName])
            );
            const casesById = new Map<string, string>(
              casesRef.current.map((c) => [c.id, c.studentName])
            );
            const additions = detectRealtimeAdditions({
              entity: notifyEntity,
              tracker: realtimeTrackersRef.current[notifyEntity],
              records: list as unknown as Array<StudentCase | CounselingLog | ParentCall>,
              fromCache: snap.metadata.fromCache,
              pendingWriteIds,
              localCreatedIds: localCreatedIdsRef.current,
              studentsById,
              casesById,
              sessionStartedAtMs: sessionStartMsRef.current,
            });
            if (additions.length > 0) {
              setRealtimeNotifications((prev) => appendNotificationsCapped(prev, additions, 3));
            }
          }
        },
        (error) => {
          console.error(`Firestore listener error on ${colName}:`, error);
        }
      );
      unsubs.push(unsub);
    };

    bindCollection<SchoolClass>('classes', setClasses);
    bindCollection<Student>('students', setStudents);
    bindCollection<AttendanceRecord>('attendance', setAttendance);
    bindCollection<StudentCase>('cases', setServerCases, 'cases');
    bindCollection<BKSchedule>('schedules', setSchedules);

    if (currentUser.role === 'Administrator' || currentUser.role === 'Guru BK') {
      bindCollection<UserAccount>('users', setUsers);
      bindCollection<CounselingLog>('counselingLogs', setServerCounselingLogs, 'counselingLogs');
      bindCollection<ParentCall>('parentCalls', setServerParentCalls, 'parentCalls');
      bindCollection<MonitoringNote>('monitoringNotes', setMonitoringNotes);
    }

    if (currentUser.role === 'Administrator') {
      bindCollection<AuditLog>('auditLogs', setAuditLogs);
    }

    const unsubSettings = onSnapshot(
      doc(db, 'settings', 'global'),
      (snap) => {
        if (snap.exists()) {
          const loaded = { id: snap.id, ...(snap.data() as Omit<SystemSettings, 'id'>) };
          setSettings(loaded);
          try {
            localStorage.setItem(
              'sibk_public_branding',
              JSON.stringify({
                schoolName: loaded.schoolName,
                schoolLogoUrl: loaded.schoolLogoUrl || '',
              })
            );
          } catch {
            // Ignore storage quota errors
          }
        } else {
          setSettings(DEFAULT_SETTINGS);
        }
      },
      (error) => {
        console.error('Firestore listener error on settings/global:', error);
      }
    );
    unsubs.push(unsubSettings);

    return () => {
      unsubs.forEach((u) => u());
    };
  }, [isDemoMode, firebaseUser, currentUser]);

  const enterDemoMode = (role: UserRole = 'Administrator') => {
    setIsDemoMode(false);
    const chosen = SYSTEM_USERS.find((u) => u.role === role) || SYSTEM_USERS[0];
    setCurrentUser(chosen);
  };

  const loginWithCredentials = async (
    username: string,
    password: string
  ): Promise<{ ok: boolean; error?: string }> => {
    const u = username.trim().toLowerCase();
    if (!u || !password) {
      return { ok: false, error: 'Username dan password wajib diisi.' };
    }

    let remoteUsers: UserAccount[] = [];
    try {
      const snap = await getDocs(collection(db, 'users'));
      remoteUsers = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<UserAccount, 'id'>),
      }));
    } catch {
      // Fallback to local state if Firestore is temporarily unreachable
      remoteUsers = users;
    }

    const matched = remoteUsers.find((acc) => acc.username?.trim().toLowerCase() === u);
    if (matched) {
      if (matched.active === false) {
        return {
          ok: false,
          error: 'Akun ini sedang dinonaktifkan. Hubungi Administrator.',
        };
      }
      if ((matched.password || '') === password) {
        sessionStorage.setItem('sibk_session_role', matched.role);
        sessionStorage.setItem('sibk_session_user', JSON.stringify(matched));
        setIsDemoMode(false);
        setCurrentUser(matched);
        return { ok: true };
      }
      return {
        ok: false,
        error: 'Password salah. Periksa kembali password Anda.',
      };
    }

    // Fallback to default bootstrap accounts only if not yet customized in Firestore
    const hasCustomAdmin = remoteUsers.some((acc) => acc.id === 'sys_admin');
    const hasCustomGuru = remoteUsers.some((acc) => acc.id === 'sys_guru');

    if (!hasCustomAdmin && u === 'admin123' && password === 'admin123') {
      const defaultAdmin: UserAccount = {
        ...SYSTEM_USERS[0],
        username: 'admin123',
      };
      sessionStorage.setItem('sibk_session_role', 'Administrator');
      sessionStorage.setItem('sibk_session_user', JSON.stringify(defaultAdmin));
      setIsDemoMode(false);
      setCurrentUser(defaultAdmin);
      return { ok: true };
    }
    if (!hasCustomGuru && u === 'guru123' && password === 'guru123') {
      const defaultGuru: UserAccount = {
        ...SYSTEM_USERS[1],
        username: 'guru123',
      };
      sessionStorage.setItem('sibk_session_role', 'Guru BK');
      sessionStorage.setItem('sibk_session_user', JSON.stringify(defaultGuru));
      setIsDemoMode(false);
      setCurrentUser(defaultGuru);
      return { ok: true };
    }

    return {
      ok: false,
      error: 'Username atau password salah. Gunakan akun Administrator atau Guru BK yang valid.',
    };
  };

  const loginWithGoogle = async () => {
    await signInWithPopup(auth, googleProvider);
  };

  const logout = async () => {
    sessionStorage.removeItem('sibk_session_role');
    sessionStorage.removeItem('sibk_session_user');
    if (isDemoMode) {
      setIsDemoMode(false);
      setCurrentUser(null);
      return;
    }
    await signOut(auth);
    setCurrentUser(null);
  };

  const recordAudit = useCallback(async (action: string, target: string) => {
    const activeUser = currentUserRef.current;
    if (!activeUser) return;
    const entry: AuditLog = {
      id: makeId('aud'),
      userEmail: activeUser.email,
      userName: activeUser.name,
      action,
      target,
      timestamp: new Date().toISOString(),
    };
    if (isDemoMode) {
      setAuditLogs((prev) => [entry, ...prev]);
      return;
    }
    try {
      const { id, ...payload } = entry;
      await setDoc(doc(db, 'auditLogs', id), payload);
    } catch {
      // Non-blocking audit log error
    }
  }, [isDemoMode]);

  const executeQueuedSyncItem = useCallback(
    async (item: QueuedSyncItem) => {
      const activeActorName = currentUserRef.current?.name || 'Guru BK';
      if (item.action === 'create') {
        localCreatedIdsRef.current.add(item.docId);
      }

      if (item.entity === 'cases' && item.action === 'create') {
        const { record } = item.payload as CaseCreatePayload;
        const studentRef = doc(db, 'students', record.studentId);
        const caseRef = doc(db, 'cases', item.docId);

        const committed = await runTransaction(db, async (tx) => {
          const [stuSnap, existingCaseSnap] = await Promise.all([
            tx.get(studentRef),
            tx.get(caseRef),
          ]);
          if (existingCaseSnap.exists()) {
            return {
              id: item.docId,
              ...(existingCaseSnap.data() as Omit<StudentCase, 'id'>),
            };
          }
          const serverCaseCount = stuSnap.exists() ? Number(stuSnap.data()?.caseCount || 0) : 0;
          const nextCaseNumber = computeNextCaseNumberInTransaction(
            serverCaseCount,
            Math.max(0, record.caseNumber - 1)
          );
          const nowISO = new Date().toISOString();
          const payloadWithoutId = omitId<StudentCase>(record)!;
          const payload: Omit<StudentCase, 'id'> = {
            ...(payloadWithoutId as Omit<StudentCase, 'id'>),
            caseNumber: nextCaseNumber,
            _version: 1,
            updatedAt: nowISO,
            updatedBy: record.counselorName || activeActorName,
          };
          tx.set(caseRef, stripUndefined(payload));
          if (stuSnap.exists()) {
            tx.update(studentRef, { caseCount: nextCaseNumber });
          }
          return { id: item.docId, ...payload };
        });

        committedCaseResultsRef.current.set(item.docId, committed);
        setServerCases((prev) => {
          const exists = prev.some((c) => c.id === committed.id);
          return exists
            ? prev.map((c) => (c.id === committed.id ? committed : c))
            : [committed, ...prev];
        });
        setStudents((prev) =>
          prev.map((s) =>
            s.id === committed.studentId ? { ...s, caseCount: committed.caseNumber } : s
          )
        );
        void recordAudit(
          'TAMBAH_KASUS',
          `${committed.studentName} — Kasus ke-${committed.caseNumber} (${committed.category})`
        );
        return;
      }

      if (item.entity === 'cases' && item.action === 'update') {
        const { patch, baseRecord, actorName } = item.payload as CaseUpdatePayload;
        const caseRef = doc(db, 'cases', item.docId);
        const syncedScheduleId = `clog_sch_${item.docId}`;
        const schRef = doc(db, 'schedules', syncedScheduleId);
        const shouldCheckSchedule = typeof patch.status === 'string';

        const mergedResult = await runTransaction(db, async (tx) => {
          const [caseSnap, schSnap] = await Promise.all([
            tx.get(caseRef),
            shouldCheckSchedule ? tx.get(schRef) : Promise.resolve(null),
          ]);
          if (!caseSnap.exists()) return null;

          const serverData = caseSnap.data() as Omit<StudentCase, 'id'>;
          const merged = mergeRecordWithBase<Omit<StudentCase, 'id'>>({
            base: omitId<StudentCase>(baseRecord),
            server: serverData,
            patch: (omitId<StudentCase>(patch) || {}) as Partial<Omit<StudentCase, 'id'>>,
            actorName: actorName || activeActorName,
          });
          tx.set(caseRef, stripUndefined(merged));
          if (schSnap && schSnap.exists() && typeof patch.status === 'string') {
            tx.update(schRef, { completed: patch.status === 'Selesai' });
          }
          return { id: item.docId, ...merged } as StudentCase;
        });

        if (mergedResult) {
          setServerCases((prev) =>
            prev.map((c) => (c.id === item.docId ? mergedResult : c))
          );
        }
        if (typeof patch.status === 'string') {
          setSchedules((prev) =>
            prev.map((s) =>
              s.id === syncedScheduleId ? { ...s, completed: patch.status === 'Selesai' } : s
            )
          );
        }
        void recordAudit('UPDATE_KASUS', item.docId);
        return;
      }

      if (item.entity === 'cases' && item.action === 'delete') {
        const { studentId, syncedScheduleId, remainingCaseIds } = item.payload as CaseDeletePayload;
        const caseRef = doc(db, 'cases', item.docId);
        const schRef = doc(db, 'schedules', syncedScheduleId);
        const stuRef = studentId ? doc(db, 'students', studentId) : null;
        const uniqueRemainingIds = Array.from(
          new Set((remainingCaseIds || []).filter((cid) => cid && cid !== item.docId))
        );

        const renumberedIds = await runTransaction(db, async (tx) => {
          const [caseSnap, schSnap, stuSnap, ...remSnaps] = await Promise.all([
            tx.get(caseRef),
            tx.get(schRef),
            stuRef ? tx.get(stuRef) : Promise.resolve(null),
            ...uniqueRemainingIds.map((cid) => tx.get(doc(db, 'cases', cid))),
          ]);

          if (caseSnap.exists()) {
            tx.delete(caseRef);
          }
          if (schSnap.exists()) {
            tx.delete(schRef);
          }

          const surviving = remSnaps
            .filter((snap) => snap.exists())
            .map((snap) => ({
              id: snap.id,
              ref: snap.ref,
              data: snap.data() as Omit<StudentCase, 'id'>,
            }))
            .sort((a, b) => {
              if (a.data.caseNumber !== b.data.caseNumber) {
                return a.data.caseNumber - b.data.caseNumber;
              }
              return String(a.data.date || '').localeCompare(String(b.data.date || ''));
            });

          const updates: Array<{ id: string; caseNumber: number }> = [];
          surviving.forEach((entry, idx) => {
            const expectedNum = idx + 1;
            updates.push({ id: entry.id, caseNumber: expectedNum });
            if (entry.data.caseNumber !== expectedNum) {
              tx.update(entry.ref, { caseNumber: expectedNum });
            }
          });

          if (stuSnap && stuSnap.exists()) {
            tx.update(stuRef!, { caseCount: surviving.length });
          }
          return updates;
        });

        const renumberMap = new Map(renumberedIds.map((u) => [u.id, u.caseNumber]));
        setServerCases((prev) =>
          prev
            .filter((c) => c.id !== item.docId)
            .map((c) => (renumberMap.has(c.id) ? { ...c, caseNumber: renumberMap.get(c.id)! } : c))
        );
        setSchedules((prev) => prev.filter((s) => s.id !== syncedScheduleId));
        if (studentId) {
          setStudents((prev) =>
            prev.map((s) =>
              s.id === studentId ? { ...s, caseCount: renumberedIds.length } : s
            )
          );
        }
        void recordAudit('HAPUS_KASUS', item.docId);
        return;
      }

      if (item.entity === 'counselingLogs' && item.action === 'create') {
        const { record, syncedScheduleRecord, syncedScheduleId } =
          item.payload as CounselingLogCreatePayload;
        const logRef = doc(db, 'counselingLogs', item.docId);
        const caseRef = doc(db, 'cases', record.caseId);
        const schRef = doc(db, 'schedules', syncedScheduleId);

        const committed = await runTransaction(db, async (tx) => {
          const [logSnap, caseSnap, schSnap] = await Promise.all([
            tx.get(logRef),
            tx.get(caseRef),
            tx.get(schRef),
          ]);
          const nowISO = new Date().toISOString();
          const { id: _logId, ...logBody } = record;
          const storedLog: Omit<CounselingLog, 'id'> = {
            ...logBody,
            _version: 1,
            updatedAt: nowISO,
            updatedBy: record.counselorName || activeActorName,
          };

          if (!logSnap.exists()) {
            tx.set(logRef, stripUndefined(storedLog));
          }
          if (caseSnap.exists()) {
            const serverCase = caseSnap.data() as Record<string, unknown>;
            const nextVer = Math.max(0, Number(serverCase._version) || 0) + 1;
            tx.update(caseRef, {
              status: record.progressStatus,
              _version: nextVer,
              updatedAt: nowISO,
              updatedBy: record.counselorName || activeActorName,
            });
          }
          if (syncedScheduleRecord) {
            const { id: _schId, ...schBody } = syncedScheduleRecord;
            tx.set(schRef, stripUndefined(schBody), { merge: true });
          } else if (schSnap.exists() && record.progressStatus === 'Selesai') {
            tx.update(schRef, { completed: true });
          }

          return { id: item.docId, ...storedLog } as CounselingLog;
        });

        setServerCounselingLogs((prev) => {
          const exists = prev.some((l) => l.id === committed.id);
          return exists
            ? prev.map((l) => (l.id === committed.id ? committed : l))
            : [committed, ...prev];
        });
        setServerCases((prev) =>
          prev.map((c) =>
            c.id === record.caseId ? { ...c, status: record.progressStatus } : c
          )
        );
        if (syncedScheduleRecord) {
          setSchedules((prev) => {
            const exists = prev.some((s) => s.id === syncedScheduleId);
            return exists
              ? prev.map((s) => (s.id === syncedScheduleId ? syncedScheduleRecord : s))
              : [syncedScheduleRecord, ...prev];
          });
        }
        void recordAudit('TAMBAH_KONSELING', `Kasus ${record.caseId} (${record.progressStatus})`);
        return;
      }

      if (item.entity === 'parentCalls' && (item.action === 'create' || item.action === 'update')) {
        const {
          record,
          baseRecord,
          syncedScheduleRecord,
          syncedScheduleId,
          isCompletedCall,
          actorName,
        } = item.payload as ParentCallSavePayload;

        const callRef = doc(db, 'parentCalls', item.docId);
        const schRef = doc(db, 'schedules', syncedScheduleId);
        const stuRef =
          isCompletedCall && record.studentId ? doc(db, 'students', record.studentId) : null;

        const txResult = await runTransaction(db, async (tx) => {
          const [callSnap, schSnap, stuSnap] = await Promise.all([
            tx.get(callRef),
            tx.get(schRef),
            stuRef ? tx.get(stuRef) : Promise.resolve(null),
          ]);

          const nowISO = new Date().toISOString();
          const { id: _callId, ...recordWithoutId } = record;
          let savedCall: ParentCall;

          if (callSnap.exists()) {
            const serverCall = callSnap.data() as Omit<ParentCall, 'id'>;
            const merged = mergeRecordWithBase<Omit<ParentCall, 'id'>>({
              base: omitId<ParentCall>(baseRecord),
              server: serverCall,
              patch: recordWithoutId as Partial<Omit<ParentCall, 'id'>>,
              actorName: actorName || activeActorName,
              nowISO,
            });
            tx.set(callRef, stripUndefined(merged));
            savedCall = { id: item.docId, ...merged };
          } else {
            const initial: Omit<ParentCall, 'id'> = {
              ...recordWithoutId,
              _version: 1,
              updatedAt: nowISO,
              updatedBy: actorName || activeActorName,
            };
            tx.set(callRef, stripUndefined(initial));
            savedCall = { id: item.docId, ...initial };
          }

          if (syncedScheduleRecord) {
            const { id: _schId, ...schBody } = syncedScheduleRecord;
            tx.set(schRef, stripUndefined(schBody), { merge: true });
          } else if (schSnap.exists()) {
            tx.delete(schRef);
          }

          let updatedCycleCount: number | null = null;
          if (stuSnap && stuSnap.exists()) {
            const serverCaseCount = Number(stuSnap.data()?.caseCount || 0);
            const localCaseCount = casesRef.current.filter(
              (c) => c.studentId === record.studentId
            ).length;
            updatedCycleCount = Math.max(serverCaseCount, localCaseCount);
            tx.update(stuRef!, { caseCountAtLastParentCall: updatedCycleCount });
          }

          return { savedCall, updatedCycleCount };
        });

        setServerParentCalls((prev) => {
          const exists = prev.some((p) => p.id === item.docId);
          return exists
            ? prev.map((p) => (p.id === item.docId ? txResult.savedCall : p))
            : [txResult.savedCall, ...prev];
        });
        setSchedules((prev) => {
          if (syncedScheduleRecord) {
            const exists = prev.some((s) => s.id === syncedScheduleId);
            return exists
              ? prev.map((s) => (s.id === syncedScheduleId ? syncedScheduleRecord : s))
              : [syncedScheduleRecord, ...prev];
          }
          return prev.filter((s) => s.id !== syncedScheduleId);
        });
        if (txResult.updatedCycleCount !== null && record.studentId) {
          setStudents((prev) =>
            prev.map((s) =>
              s.id === record.studentId
                ? { ...s, caseCountAtLastParentCall: txResult.updatedCycleCount! }
                : s
            )
          );
        }
        void recordAudit('PEMANGGILAN_ORTU', `${record.studentName} (${record.status})`);
        return;
      }

      if (item.entity === 'parentCalls' && item.action === 'delete') {
        const { syncedScheduleId } = item.payload as ParentCallDeletePayload;
        const callRef = doc(db, 'parentCalls', item.docId);
        const schRef = doc(db, 'schedules', syncedScheduleId);

        await runTransaction(db, async (tx) => {
          const [callSnap, schSnap] = await Promise.all([tx.get(callRef), tx.get(schRef)]);
          if (callSnap.exists()) {
            tx.delete(callRef);
          }
          if (schSnap.exists()) {
            tx.delete(schRef);
          }
        });

        setServerParentCalls((prev) => prev.filter((p) => p.id !== item.docId));
        setSchedules((prev) => prev.filter((s) => s.id !== syncedScheduleId));
      }
    },
    [recordAudit]
  );

  useEffect(() => {
    const queue = syncQueueRef.current!;
    if (!isDemoMode && currentUser) {
      queue.setExecutor(executeQueuedSyncItem);
    } else {
      queue.setExecutor(null);
    }
    return () => {
      queue.setExecutor(null);
    };
  }, [isDemoMode, currentUser, executeQueuedSyncItem]);

  const saveStudent = async (data: Omit<Student, 'id'> & { id?: string }) => {
    const id = data.id || makeId('stu');
    const record: Student = { ...data, id };
    if (isDemoMode) {
      setStudents((prev) => {
        const exists = prev.some((s) => s.id === id);
        return exists ? prev.map((s) => (s.id === id ? record : s)) : [record, ...prev];
      });
      await recordAudit(data.id ? 'EDIT_SISWA' : 'TAMBAH_SISWA', `${record.fullName} (${record.nis})`);
      return;
    }
    try {
      const { id: docId, ...payload } = record;
      await setDoc(doc(db, 'students', docId), stripUndefined(payload), { merge: true });
      await recordAudit(data.id ? 'EDIT_SISWA' : 'TAMBAH_SISWA', `${record.fullName} (${record.nis})`);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `students/${id}`);
    }
  };

  const deleteStudent = async (id: string) => {
    const target = students.find((s) => s.id === id);
    if (isDemoMode) {
      setStudents((prev) => prev.filter((s) => s.id !== id));
      await recordAudit('HAPUS_SISWA', target ? `${target.fullName} (${target.nis})` : id);
      return;
    }
    try {
      await deleteDoc(doc(db, 'students', id));
      await recordAudit('HAPUS_SISWA', target ? `${target.fullName} (${target.nis})` : id);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `students/${id}`);
    }
  };

  const bulkImportStudents = async (rows: Array<Omit<Student, 'id'>>): Promise<number> => {
    let count = 0;
    for (const row of rows) {
      if (!row.nis || !row.fullName) continue;
      await saveStudent(row);
      count++;
    }
    return count;
  };

  const moveStudentClass = async (studentId: string, newClassId: string, newClassName: string) => {
    if (isDemoMode) {
      setStudents((prev) =>
        prev.map((s) =>
          s.id === studentId ? { ...s, classId: newClassId, className: newClassName } : s
        )
      );
      await recordAudit('PINDAH_KELAS', `Siswa ${studentId} -> ${newClassName}`);
      return;
    }
    try {
      await updateDoc(doc(db, 'students', studentId), {
        classId: newClassId,
        className: newClassName,
      });
      await recordAudit('PINDAH_KELAS', `Siswa ${studentId} -> ${newClassName}`);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `students/${studentId}`);
    }
  };

  const bulkPromoteOrGraduateStudents = async (params: {
    mode: 'promote' | 'graduate';
    sourceClassId: string;
    targetClassId?: string;
    studentIds: string[];
    archiveSourceClass: boolean;
  }): Promise<number> => {
    const { mode, sourceClassId, targetClassId, studentIds, archiveSourceClass } = params;
    if (studentIds.length === 0) return 0;

    const sourceClass = classes.find((c) => c.id === sourceClassId);
    const targetClass =
      mode === 'promote' ? classes.find((c) => c.id === targetClassId) : undefined;

    if (mode === 'promote' && !targetClass) {
      throw new Error('Kelas tujuan tidak ditemukan.');
    }

    const idSet = new Set(studentIds);

    if (isDemoMode) {
      setStudents((prev) =>
        prev.map((s) => {
          if (!idSet.has(s.id)) return s;
          if (mode === 'promote' && targetClass) {
            return {
              ...s,
              classId: targetClass.id,
              className: targetClass.name,
              academicYear: targetClass.academicYear,
            };
          }
          return { ...s, status: 'Lulus' };
        })
      );
      if (archiveSourceClass && sourceClass) {
        setClasses((prev) =>
          prev.map((c) => (c.id === sourceClass.id ? { ...c, archived: true } : c))
        );
      }
      const auditAction = mode === 'promote' ? 'KENAIKAN_KELAS_MASSAL' : 'KELULUSAN_MASSAL';
      const auditDetail =
        mode === 'promote' && targetClass
          ? `${studentIds.length} siswa dinaikkan dari Kelas ${sourceClass?.name || sourceClassId} (${sourceClass?.academicYear || '-'}) ke Kelas ${targetClass.name} (${targetClass.academicYear})${archiveSourceClass ? ' [Kelas asal diarsipkan]' : ''}`
          : `${studentIds.length} siswa dari Kelas ${sourceClass?.name || sourceClassId} (${sourceClass?.academicYear || '-'}) diluluskan${archiveSourceClass ? ' [Kelas asal diarsipkan]' : ''}`;
      await recordAudit(auditAction, auditDetail);
      return studentIds.length;
    }

    try {
      let updatedCount = 0;
      for (const studentId of studentIds) {
        if (mode === 'promote' && targetClass) {
          await updateDoc(doc(db, 'students', studentId), {
            classId: targetClass.id,
            className: targetClass.name,
            academicYear: targetClass.academicYear,
          });
        } else {
          await updateDoc(doc(db, 'students', studentId), {
            status: 'Lulus',
          });
        }
        updatedCount++;
      }

      if (archiveSourceClass && sourceClass) {
        await updateDoc(doc(db, 'classes', sourceClass.id), {
          archived: true,
        });
      }

      const auditAction = mode === 'promote' ? 'KENAIKAN_KELAS_MASSAL' : 'KELULUSAN_MASSAL';
      const auditDetail =
        mode === 'promote' && targetClass
          ? `${updatedCount} siswa dinaikkan dari Kelas ${sourceClass?.name || sourceClassId} (${sourceClass?.academicYear || '-'}) ke Kelas ${targetClass.name} (${targetClass.academicYear})${archiveSourceClass ? ' [Kelas asal diarsipkan]' : ''}`
          : `${updatedCount} siswa dari Kelas ${sourceClass?.name || sourceClassId} (${sourceClass?.academicYear || '-'}) diluluskan${archiveSourceClass ? ' [Kelas asal diarsipkan]' : ''}`;
      await recordAudit(auditAction, auditDetail);
      return updatedCount;
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, 'students/bulk');
      return 0;
    }
  };

  const saveClass = async (data: Omit<SchoolClass, 'id'> & { id?: string }) => {
    const id = data.id || makeId('cls');
    const record: SchoolClass = { ...data, id };
    if (isDemoMode) {
      setClasses((prev) => {
        const exists = prev.some((c) => c.id === id);
        return exists ? prev.map((c) => (c.id === id ? record : c)) : [...prev, record];
      });
      await recordAudit(data.id ? 'EDIT_KELAS' : 'TAMBAH_KELAS', `${record.name} (${record.academicYear})`);
      return;
    }
    try {
      const { id: docId, ...payload } = record;
      await setDoc(doc(db, 'classes', docId), stripUndefined(payload), { merge: true });
      await recordAudit(data.id ? 'EDIT_KELAS' : 'TAMBAH_KELAS', `${record.name} (${record.academicYear})`);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `classes/${id}`);
    }
  };

  const deleteClass = async (id: string) => {
    if (isDemoMode) {
      setClasses((prev) => prev.filter((c) => c.id !== id));
      await recordAudit('HAPUS_KELAS', id);
      return;
    }
    try {
      await deleteDoc(doc(db, 'classes', id));
      await recordAudit('HAPUS_KELAS', id);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `classes/${id}`);
    }
  };

  const saveAttendanceBatch = async (records: Array<Omit<AttendanceRecord, 'id'>>) => {
    const withIds: AttendanceRecord[] = records.map((r) => ({
      ...r,
      id: buildAttendanceId(r.date, r.studentId),
    }));

    if (isDemoMode) {
      setAttendance((prev) => {
        const map = new Map(prev.map((a) => [a.id, a]));
        withIds.forEach((item) => map.set(item.id, item));
        return Array.from(map.values());
      });
      if (withIds.length > 0) {
        await recordAudit(
          'SIMPAN_ABSENSI',
          `${withIds[0].className} tanggal ${withIds[0].date} (${withIds.length} siswa)`
        );
      }
      return;
    }

    try {
      for (let i = 0; i < withIds.length; i += 400) {
        const chunk = withIds.slice(i, i + 400);
        const batch = writeBatch(db);
        for (const item of chunk) {
          const { id, ...payload } = item;
          batch.set(doc(db, 'attendance', id), stripUndefined(payload), { merge: true });
        }
        await batch.commit();
      }
      if (withIds.length > 0) {
        await recordAudit(
          'SIMPAN_ABSENSI',
          `${withIds[0].className} tanggal ${withIds[0].date} (${withIds.length} siswa)`
        );
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'attendance');
    }
  };

  const deleteAttendanceByDateAndClass = async (
    date: string,
    classId: string
  ): Promise<number> => {
    const targets = attendance.filter((a) => a.date === date && a.classId === classId);
    if (targets.length === 0) return 0;

    const className =
      targets[0]?.className || classes.find((c) => c.id === classId)?.name || classId;

    if (isDemoMode) {
      const targetIds = new Set(targets.map((t) => t.id));
      setAttendance((prev) => prev.filter((a) => !targetIds.has(a.id)));
      await recordAudit(
        'HAPUS_ABSENSI',
        `Kelas ${className} tanggal ${date} (${targets.length} data)`
      );
      return targets.length;
    }

    try {
      for (let i = 0; i < targets.length; i += 400) {
        const chunk = targets.slice(i, i + 400);
        const batch = writeBatch(db);
        for (const item of chunk) {
          batch.delete(doc(db, 'attendance', item.id));
        }
        await batch.commit();
      }
      await recordAudit(
        'HAPUS_ABSENSI',
        `Kelas ${className} tanggal ${date} (${targets.length} data)`
      );
      return targets.length;
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `attendance/${date}_${classId}`);
      return 0;
    }
  };

  const acquireRecordLock = useCallback(
    async (col: 'cases' | 'parentCalls', id: string): Promise<LockCheckResult> => {
      if (isDemoMode || !id) {
        return { lockedByOther: false, lockOwnerName: '', expiresAt: 0 };
      }
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        return { lockedByOther: false, lockOwnerName: '', expiresAt: 0 };
      }
      const actorName = currentUserRef.current?.name || 'Guru BK';
      const targetRef = doc(db, col, id);
      try {
        return await runTransaction(db, async (tx) => {
          const snap = await tx.get(targetRef);
          if (!snap.exists()) {
            return { lockedByOther: false, lockOwnerName: '', expiresAt: 0 };
          }
          const data = snap.data() as Record<string, unknown>;
          const nowMs = Date.now();
          const check = checkAdvisoryLock(data, actorId, nowMs);
          if (check.lockedByOther) {
            return check;
          }
          const expiresAt = nowMs + ADVISORY_LOCK_TTL_MS;
          tx.update(targetRef, {
            lockBy: actorId,
            lockByName: actorName,
            lockExpiresAt: expiresAt,
          });
          return { lockedByOther: false, lockOwnerName: actorName, expiresAt };
        });
      } catch {
        // Advisory lock is non-blocking when offline or read-only
        return { lockedByOther: false, lockOwnerName: '', expiresAt: 0 };
      }
    },
    [actorId, isDemoMode]
  );

  const releaseRecordLock = useCallback(
    async (col: 'cases' | 'parentCalls', id: string): Promise<void> => {
      if (isDemoMode || !id) return;
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
      const targetRef = doc(db, col, id);
      try {
        await runTransaction(db, async (tx) => {
          const snap = await tx.get(targetRef);
          if (!snap.exists()) return;
          const data = snap.data() as Record<string, unknown>;
          if (data.lockBy === actorId) {
            tx.update(targetRef, {
              lockBy: null,
              lockByName: null,
              lockExpiresAt: null,
            });
          }
        });
      } catch {
        // Ignore silent release failures
      }
    },
    [actorId, isDemoMode]
  );

  const addCaseWithAutoNumber = async (
    data: Omit<StudentCase, 'id' | 'caseNumber' | 'dayName'>
  ): Promise<StudentCase> => {
    const dayName = getIndonesianDayName(data.date);
    const id = makeId('case');
    localCreatedIdsRef.current.add(id);
    const existingStudentCases = cases.filter((c) => c.studentId === data.studentId);
    const nextNumberFromActual = existingStudentCases.length + 1;
    const targetStudent = students.find((s) => s.id === data.studentId);
    const prevStudentCaseCount = targetStudent?.caseCount ?? Math.max(0, existingStudentCases.length);
    const nowISO = new Date().toISOString();
    const optimisticCase: StudentCase = {
      ...data,
      id,
      caseNumber: nextNumberFromActual,
      dayName,
      _version: 1,
      updatedAt: nowISO,
      updatedBy: data.counselorName || currentUser?.name || 'Guru BK',
    };

    if (isDemoMode) {
      setCases((prev) => [optimisticCase, ...prev]);
      setStudents((prev) =>
        prev.map((s) =>
          s.id === data.studentId ? { ...s, caseCount: nextNumberFromActual } : s
        )
      );
      await recordAudit(
        'TAMBAH_KASUS',
        `${data.studentName} — Kasus ke-${nextNumberFromActual} (${data.category})`
      );
      return optimisticCase;
    }

    // Optimistic UI: update student caseCount immediately & enqueue persistent sync
    setStudents((prev) =>
      prev.map((s) =>
        s.id === data.studentId ? { ...s, caseCount: nextNumberFromActual } : s
      )
    );

    await syncQueueRef.current!.enqueue<CaseCreatePayload>({
      entity: 'cases',
      action: 'create',
      docId: id,
      payload: { record: optimisticCase },
      onRollback: () => {
        setStudents((prev) =>
          prev.map((s) =>
            s.id === data.studentId ? { ...s, caseCount: prevStudentCaseCount } : s
          )
        );
      },
    });

    const committed = committedCaseResultsRef.current.get(id);
    if (committed) {
      committedCaseResultsRef.current.delete(id);
      return committed;
    }
    return optimisticCase;
  };

  const updateCase = async (
    id: string,
    patch: Partial<StudentCase>,
    baseRecord?: Partial<StudentCase>
  ) => {
    const syncedScheduleId = `clog_sch_${id}`;
    const existingSynced = schedules.find((s) => s.id === syncedScheduleId);
    const shouldSyncCompletion = typeof patch.status === 'string' && Boolean(existingSynced);
    const nextCompleted = patch.status === 'Selesai';
    const prevCompleted = existingSynced?.completed;
    const snapshotAtCall = baseRecord || cases.find((c) => c.id === id);
    const actorName = currentUser?.name || 'Guru BK';

    if (isDemoMode) {
      setCases((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
      if (shouldSyncCompletion) {
        setSchedules((prev) =>
          prev.map((s) => (s.id === syncedScheduleId ? { ...s, completed: nextCompleted } : s))
        );
      }
      await recordAudit('UPDATE_KASUS', id);
      return;
    }

    if (shouldSyncCompletion) {
      setSchedules((prev) =>
        prev.map((s) => (s.id === syncedScheduleId ? { ...s, completed: nextCompleted } : s))
      );
    }

    await syncQueueRef.current!.enqueue<CaseUpdatePayload>({
      entity: 'cases',
      action: 'update',
      docId: id,
      payload: {
        patch,
        baseRecord: snapshotAtCall,
        actorName,
      },
      onRollback: () => {
        if (shouldSyncCompletion && prevCompleted !== undefined) {
          setSchedules((prev) =>
            prev.map((s) =>
              s.id === syncedScheduleId ? { ...s, completed: prevCompleted } : s
            )
          );
        }
      },
    });
  };

  const deleteCase = async (id: string) => {
    const targetCase = cases.find((c) => c.id === id);
    const studentId = targetCase?.studentId;
    const syncedScheduleId = `clog_sch_${id}`;
    const existingSchedule = schedules.find((s) => s.id === syncedScheduleId);
    const prevStudentCaseCount = studentId
      ? (students.find((s) => s.id === studentId)?.caseCount ?? 0)
      : 0;

    // Remaining cases for this student sorted chronologically so renumbering stays 1..N
    const remainingForStudent = studentId
      ? cases
          .filter((c) => c.studentId === studentId && c.id !== id)
          .sort((a, b) => {
            if (a.caseNumber !== b.caseNumber) return a.caseNumber - b.caseNumber;
            return a.date.localeCompare(b.date);
          })
      : [];

    if (isDemoMode) {
      const renumberMap = new Map<string, number>();
      remainingForStudent.forEach((c, idx) => renumberMap.set(c.id, idx + 1));

      setCases((prev) =>
        prev
          .filter((c) => c.id !== id)
          .map((c) => (renumberMap.has(c.id) ? { ...c, caseNumber: renumberMap.get(c.id)! } : c))
      );
      if (existingSchedule) {
        setSchedules((prev) => prev.filter((s) => s.id !== syncedScheduleId));
      }
      if (studentId) {
        setStudents((prev) =>
          prev.map((s) =>
            s.id === studentId ? { ...s, caseCount: remainingForStudent.length } : s
          )
        );
      }
      await recordAudit('HAPUS_KASUS', id);
      return;
    }

    if (existingSchedule) {
      setSchedules((prev) => prev.filter((s) => s.id !== syncedScheduleId));
    }
    if (studentId) {
      setStudents((prev) =>
        prev.map((s) =>
          s.id === studentId ? { ...s, caseCount: remainingForStudent.length } : s
        )
      );
    }

    await syncQueueRef.current!.enqueue<CaseDeletePayload>({
      entity: 'cases',
      action: 'delete',
      docId: id,
      payload: {
        studentId,
        syncedScheduleId,
        remainingCaseIds: remainingForStudent.map((c) => c.id),
      },
      onRollback: () => {
        if (existingSchedule) {
          setSchedules((prev) =>
            prev.some((s) => s.id === existingSchedule.id)
              ? prev
              : [existingSchedule, ...prev]
          );
        }
        if (studentId) {
          setStudents((prev) =>
            prev.map((s) =>
              s.id === studentId ? { ...s, caseCount: prevStudentCaseCount } : s
            )
          );
        }
      },
    });
  };

  const addCounselingLog = async (data: Omit<CounselingLog, 'id'>) => {
    const id = makeId('clog');
    localCreatedIdsRef.current.add(id);
    const nowISO = new Date().toISOString();
    const record: CounselingLog = {
      ...data,
      id,
      _version: 1,
      updatedAt: nowISO,
      updatedBy: data.counselorName || currentUser?.name || 'Guru BK',
    };
    const stu = students.find((s) => s.id === data.studentId);
    const studentName = stu?.fullName || cases.find((c) => c.id === data.caseId)?.studentName || '';
    const syncedScheduleId = `clog_sch_${data.caseId}`;
    const hasEvalDate = Boolean(
      data.nextEvaluationDate && /^\d{4}-\d{2}-\d{2}$/.test(data.nextEvaluationDate)
    );
    const existingSynced = schedules.find((s) => s.id === syncedScheduleId);
    const syncedScheduleRecord: BKSchedule | null = hasEvalDate
      ? {
          id: syncedScheduleId,
          title: `Evaluasi Konseling: ${studentName || data.studentId}`,
          type: data.progressStatus === 'Perlu tindak lanjut' ? 'Tindak Lanjut' : 'Konseling Siswa',
          date: data.nextEvaluationDate,
          time: '09:00',
          studentId: data.studentId,
          studentName,
          notes: data.followUpPlan || data.topic,
          completed: data.progressStatus === 'Selesai',
        }
      : existingSynced && data.progressStatus === 'Selesai'
        ? { ...existingSynced, completed: true }
        : null;

    if (isDemoMode) {
      setCounselingLogs((prev) => [record, ...prev]);
      setCases((prev) =>
        prev.map((c) =>
          c.id === data.caseId ? { ...c, status: data.progressStatus } : c
        )
      );
      if (syncedScheduleRecord) {
        setSchedules((prev) => {
          const exists = prev.some((s) => s.id === syncedScheduleId);
          return exists
            ? prev.map((s) => (s.id === syncedScheduleId ? syncedScheduleRecord : s))
            : [syncedScheduleRecord, ...prev];
        });
      }
      await recordAudit('TAMBAH_KONSELING', `Kasus ${data.caseId} (${data.progressStatus})`);
      return;
    }

    if (syncedScheduleRecord) {
      setSchedules((prev) => {
        const exists = prev.some((s) => s.id === syncedScheduleId);
        return exists
          ? prev.map((s) => (s.id === syncedScheduleId ? syncedScheduleRecord : s))
          : [syncedScheduleRecord, ...prev];
      });
    }

    await syncQueueRef.current!.enqueue<CounselingLogCreatePayload>({
      entity: 'counselingLogs',
      action: 'create',
      docId: id,
      payload: {
        record,
        syncedScheduleRecord,
        syncedScheduleId,
      },
      onRollback: () => {
        if (syncedScheduleRecord) {
          setSchedules((prev) => {
            if (existingSynced) {
              return prev.map((s) => (s.id === syncedScheduleId ? existingSynced : s));
            }
            return prev.filter((s) => s.id !== syncedScheduleId);
          });
        }
      },
    });
  };

  const markStudentParentCallCompleted = async (studentId: string) => {
    const totalCases = cases.filter((c) => c.studentId === studentId).length;
    const targetStudent = students.find((s) => s.id === studentId);
    if (isDemoMode) {
      setStudents((prev) =>
        prev.map((s) =>
          s.id === studentId ? { ...s, caseCountAtLastParentCall: totalCases } : s
        )
      );
      await recordAudit(
        'PEMANGGILAN_ORTU_SELESAI',
        `${targetStudent?.fullName || studentId} (reset siklus pada kasus ke-${totalCases})`
      );
      return;
    }
    try {
      await updateDoc(doc(db, 'students', studentId), {
        caseCountAtLastParentCall: totalCases,
      });
      await recordAudit(
        'PEMANGGILAN_ORTU_SELESAI',
        `${targetStudent?.fullName || studentId} (reset siklus pada kasus ke-${totalCases})`
      );
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `students/${studentId}`);
    }
  };

  const saveParentCall = async (
    data: Omit<ParentCall, 'id'> & { id?: string },
    baseRecord?: Partial<ParentCall>
  ) => {
    const isUpdate = Boolean(data.id);
    const id = data.id || makeId('pcall');
    if (!isUpdate) {
      localCreatedIdsRef.current.add(id);
    }
    const actorName = currentUser?.name || 'Guru BK';
    const existingCall = isUpdate ? parentCalls.find((p) => p.id === id) : undefined;
    const record: ParentCall = {
      ...data,
      id,
      _version: existingCall?._version,
      updatedAt: new Date().toISOString(),
      updatedBy: actorName,
    };
    const isCompletedCall = isParentCallCompleted(record.status);
    const parsedSchedule = parseMeetingSchedule(
      record.meetingSchedule,
      record.meetingDate,
      record.meetingTime
    );
    const syncedScheduleId = `pcall_sch_${id}`;
    const existingSynced = schedules.find((s) => s.id === syncedScheduleId);
    const prevCycleCount = record.studentId
      ? students.find((s) => s.id === record.studentId)?.caseCountAtLastParentCall
      : undefined;
    const optimisticTotalCases = record.studentId
      ? cases.filter((c) => c.studentId === record.studentId).length
      : 0;
    const syncedScheduleRecord: BKSchedule | null = parsedSchedule.date
      ? {
          id: syncedScheduleId,
          title: `Pemanggilan Ortu: ${record.studentName} (${record.className})`,
          type: 'Pemanggilan Orang Tua',
          date: parsedSchedule.date,
          time: parsedSchedule.time || '09:00',
          studentId: record.studentId,
          studentName: record.studentName,
          notes: record.reason,
          completed: isCompletedCall,
        }
      : null;

    if (isDemoMode) {
      setParentCalls((prev) => {
        const exists = prev.some((p) => p.id === id);
        return exists ? prev.map((p) => (p.id === id ? record : p)) : [record, ...prev];
      });
      setSchedules((prev) => {
        if (syncedScheduleRecord) {
          const exists = prev.some((s) => s.id === syncedScheduleId);
          return exists
            ? prev.map((s) => (s.id === syncedScheduleId ? syncedScheduleRecord : s))
            : [syncedScheduleRecord, ...prev];
        }
        return prev.filter((s) => s.id !== syncedScheduleId);
      });
      if (isCompletedCall && record.studentId) {
        await markStudentParentCallCompleted(record.studentId);
      }
      await recordAudit('PEMANGGILAN_ORTU', `${record.studentName} (${record.status})`);
      return;
    }

    setSchedules((prev) => {
      if (syncedScheduleRecord) {
        const exists = prev.some((s) => s.id === syncedScheduleId);
        return exists
          ? prev.map((s) => (s.id === syncedScheduleId ? syncedScheduleRecord : s))
          : [syncedScheduleRecord, ...prev];
      }
      return prev.filter((s) => s.id !== syncedScheduleId);
    });
    if (isCompletedCall && record.studentId) {
      setStudents((prev) =>
        prev.map((s) =>
          s.id === record.studentId
            ? { ...s, caseCountAtLastParentCall: optimisticTotalCases }
            : s
        )
      );
    }

    await syncQueueRef.current!.enqueue<ParentCallSavePayload>({
      entity: 'parentCalls',
      action: isUpdate ? 'update' : 'create',
      docId: id,
      payload: {
        record,
        baseRecord: baseRecord || existingCall,
        syncedScheduleRecord,
        syncedScheduleId,
        isCompletedCall,
        actorName,
      },
      onRollback: () => {
        setSchedules((prev) => {
          if (existingSynced) {
            const exists = prev.some((s) => s.id === syncedScheduleId);
            return exists
              ? prev.map((s) => (s.id === syncedScheduleId ? existingSynced : s))
              : [existingSynced, ...prev];
          }
          return prev.filter((s) => s.id !== syncedScheduleId);
        });
        if (isCompletedCall && record.studentId) {
          setStudents((prev) =>
            prev.map((s) =>
              s.id === record.studentId
                ? { ...s, caseCountAtLastParentCall: prevCycleCount }
                : s
            )
          );
        }
      },
    });
  };

  const deleteParentCall = async (id: string) => {
    const syncedScheduleId = `pcall_sch_${id}`;
    const existingSynced = schedules.find((s) => s.id === syncedScheduleId);
    if (isDemoMode) {
      setParentCalls((prev) => prev.filter((p) => p.id !== id));
      setSchedules((prev) => prev.filter((s) => s.id !== syncedScheduleId));
      return;
    }
    if (existingSynced) {
      setSchedules((prev) => prev.filter((s) => s.id !== syncedScheduleId));
    }
    await syncQueueRef.current!.enqueue<ParentCallDeletePayload>({
      entity: 'parentCalls',
      action: 'delete',
      docId: id,
      payload: { syncedScheduleId },
      onRollback: () => {
        if (existingSynced) {
          setSchedules((prev) =>
            prev.some((s) => s.id === existingSynced.id) ? prev : [existingSynced, ...prev]
          );
        }
      },
    });
  };

  const addMonitoringNote = async (data: Omit<MonitoringNote, 'id'>) => {
    const id = makeId('mnote');
    const record: MonitoringNote = { ...data, id };
    setMonitoringNotes((prev) => [record, ...prev]);
    if (isDemoMode) {
      await recordAudit('TAMBAH_PEMANTAUAN', `Siswa ${data.studentId}`);
      return;
    }
    const { id: docId, ...payload } = record;
    const writePromise = setDoc(doc(db, 'monitoringNotes', docId), stripUndefined(payload));
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      void writePromise.catch((error) => {
        setMonitoringNotes((prev) => prev.filter((n) => n.id !== id));
        handleFirestoreError(error, OperationType.CREATE, `monitoringNotes/${id}`);
      });
      return;
    }
    try {
      await writePromise;
      void recordAudit('TAMBAH_PEMANTAUAN', `Siswa ${data.studentId}`);
    } catch (error) {
      setMonitoringNotes((prev) => prev.filter((n) => n.id !== id));
      handleFirestoreError(error, OperationType.CREATE, `monitoringNotes/${id}`);
    }
  };

  const updateMonitoringNote = async (
    id: string,
    patch: Partial<Omit<MonitoringNote, 'id'>>
  ) => {
    const previous = monitoringNotes.find((n) => n.id === id);
    if (!previous) return;
    const updated: MonitoringNote = { ...previous, ...patch, id };
    setMonitoringNotes((prev) => prev.map((n) => (n.id === id ? updated : n)));
    if (isDemoMode) {
      await recordAudit('EDIT_PEMANTAUAN', `Catatan ${id}`);
      return;
    }
    const { id: docId, ...payload } = updated;
    const writePromise = setDoc(doc(db, 'monitoringNotes', docId), stripUndefined(payload), {
      merge: true,
    });
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      void writePromise.catch((error) => {
        setMonitoringNotes((prev) => prev.map((n) => (n.id === id ? previous : n)));
        handleFirestoreError(error, OperationType.UPDATE, `monitoringNotes/${id}`);
      });
      return;
    }
    try {
      await writePromise;
      void recordAudit('EDIT_PEMANTAUAN', `Catatan ${id}`);
    } catch (error) {
      setMonitoringNotes((prev) => prev.map((n) => (n.id === id ? previous : n)));
      handleFirestoreError(error, OperationType.UPDATE, `monitoringNotes/${id}`);
    }
  };

  const deleteMonitoringNote = async (id: string) => {
    const previous = monitoringNotes.find((n) => n.id === id);
    setMonitoringNotes((prev) => prev.filter((n) => n.id !== id));
    if (isDemoMode) {
      await recordAudit('HAPUS_PEMANTAUAN', `Catatan ${id}`);
      return;
    }
    const delPromise = deleteDoc(doc(db, 'monitoringNotes', id));
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      void delPromise.catch((error) => {
        if (previous) {
          setMonitoringNotes((prev) => [previous, ...prev]);
        }
        handleFirestoreError(error, OperationType.DELETE, `monitoringNotes/${id}`);
      });
      return;
    }
    try {
      await delPromise;
      void recordAudit('HAPUS_PEMANTAUAN', `Catatan ${id}`);
    } catch (error) {
      if (previous) {
        setMonitoringNotes((prev) => [previous, ...prev]);
      }
      handleFirestoreError(error, OperationType.DELETE, `monitoringNotes/${id}`);
    }
  };

  const updateStudentMonitoringStatus = async (
    studentId: string,
    monitoringStatus: Student['monitoringStatus']
  ) => {
    const prevStudent = students.find((s) => s.id === studentId);
    const prevStatus = prevStudent?.monitoringStatus;
    setStudents((prev) =>
      prev.map((s) => (s.id === studentId ? { ...s, monitoringStatus } : s))
    );
    if (isDemoMode) {
      await recordAudit('STATUS_PEMANTAUAN', `${prevStudent?.fullName || studentId} -> ${monitoringStatus}`);
      return;
    }
    const writePromise = updateDoc(doc(db, 'students', studentId), { monitoringStatus });
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      void writePromise.catch((error) => {
        if (prevStatus) {
          setStudents((prev) =>
            prev.map((s) =>
              s.id === studentId ? { ...s, monitoringStatus: prevStatus } : s
            )
          );
        }
        handleFirestoreError(error, OperationType.UPDATE, `students/${studentId}`);
      });
      return;
    }
    try {
      await writePromise;
      void recordAudit('STATUS_PEMANTAUAN', `${prevStudent?.fullName || studentId} -> ${monitoringStatus}`);
    } catch (error) {
      if (prevStatus) {
        setStudents((prev) =>
          prev.map((s) =>
            s.id === studentId ? { ...s, monitoringStatus: prevStatus } : s
          )
        );
      }
      handleFirestoreError(error, OperationType.UPDATE, `students/${studentId}`);
    }
  };

  const saveSchedule = async (data: Omit<BKSchedule, 'id'> & { id?: string }) => {
    const id = data.id || makeId('sch');
    const record: BKSchedule = { ...data, id };
    if (isDemoMode) {
      setSchedules((prev) => {
        const exists = prev.some((s) => s.id === id);
        return exists ? prev.map((s) => (s.id === id ? record : s)) : [record, ...prev];
      });
      return;
    }
    try {
      const { id: docId, ...payload } = record;
      await setDoc(doc(db, 'schedules', docId), stripUndefined(payload), { merge: true });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `schedules/${id}`);
    }
  };

  const deleteSchedule = async (id: string) => {
    if (isDemoMode) {
      setSchedules((prev) => prev.filter((s) => s.id !== id));
      return;
    }
    try {
      await deleteDoc(doc(db, 'schedules', id));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `schedules/${id}`);
    }
  };

  const saveUserAccount = async (data: Omit<UserAccount, 'id'> & { id?: string }) => {
    const id = data.id || data.uid || makeId('usr');
    const record: UserAccount = { ...data, id, uid: data.uid || id };
    if (isDemoMode) {
      setUsers((prev) => {
        const exists = prev.some((u) => u.id === id);
        return exists ? prev.map((u) => (u.id === id ? record : u)) : [...prev, record];
      });
      if (currentUser?.id === id) {
        setCurrentUser(record);
        sessionStorage.setItem('sibk_session_user', JSON.stringify(record));
        sessionStorage.setItem('sibk_session_role', record.role);
      }
      return;
    }
    try {
      const { id: docId, ...payload } = record;
      await setDoc(doc(db, 'users', docId), stripUndefined(payload), { merge: true });
      if (currentUser?.id === id) {
        setCurrentUser(record);
        sessionStorage.setItem('sibk_session_user', JSON.stringify(record));
        sessionStorage.setItem('sibk_session_role', record.role);
      }
      await recordAudit(
        'SIMPAN_PENGGUNA',
        `${record.name} (${record.username || record.email} · ${record.role})`
      );
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `users/${id}`);
    }
  };

  const deleteUserAccount = async (id: string) => {
    const target = users.find((u) => u.id === id);
    if (isDemoMode) {
      setUsers((prev) => prev.filter((u) => u.id !== id));
      return;
    }
    try {
      await deleteDoc(doc(db, 'users', id));
      if (target) {
        await recordAudit(
          'HAPUS_PENGGUNA',
          `${target.name} (${target.username || target.email})`
        );
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `users/${id}`);
    }
  };

  const saveSettings = async (data: SystemSettings) => {
    if (isDemoMode) {
      setSettings(data);
      await recordAudit('UPDATE_PENGATURAN', `${data.schoolName} (${data.activeAcademicYear})`);
      return;
    }
    try {
      const { id: _id, ...payload } = data;
      await setDoc(doc(db, 'settings', 'global'), stripUndefined(payload), { merge: true });
      await recordAudit('UPDATE_PENGATURAN', `${data.schoolName} (${data.activeAcademicYear})`);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'settings/global');
    }
  };

  const createFullBackupSnapshot = async (): Promise<BackupDatabaseSnapshot> => {
    if (isDemoMode || !firebaseUser) {
      return {
        settings,
        classes,
        students,
        attendance,
        cases,
        counselingLogs,
        parentCalls,
        monitoringNotes,
        schedules,
        users,
        auditLogs,
      };
    }

    const fetchCollection = async <T extends { id: string }>(
      colName: string,
      fallback: T[]
    ): Promise<T[]> => {
      try {
        const snap = await getDocs(collection(db, colName));
        return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<T, 'id'>) } as T));
      } catch {
        return fallback;
      }
    };

    const fetchSettings = async (): Promise<SystemSettings> => {
      try {
        const snap = await getDoc(doc(db, 'settings', 'global'));
        if (snap.exists()) {
          return { id: snap.id, ...(snap.data() as Omit<SystemSettings, 'id'>) };
        }
      } catch {
        // Fallback to active settings state
      }
      return settings;
    };

    const [
      freshSettings,
      freshClasses,
      freshStudents,
      freshAttendance,
      freshCases,
      freshCounselingLogs,
      freshParentCalls,
      freshMonitoringNotes,
      freshSchedules,
      freshUsers,
      freshAuditLogs,
    ] = await Promise.all([
      fetchSettings(),
      fetchCollection<SchoolClass>('classes', classes),
      fetchCollection<Student>('students', students),
      fetchCollection<AttendanceRecord>('attendance', attendance),
      fetchCollection<StudentCase>('cases', cases),
      fetchCollection<CounselingLog>('counselingLogs', counselingLogs),
      fetchCollection<ParentCall>('parentCalls', parentCalls),
      fetchCollection<MonitoringNote>('monitoringNotes', monitoringNotes),
      fetchCollection<BKSchedule>('schedules', schedules),
      fetchCollection<UserAccount>('users', users),
      fetchCollection<AuditLog>('auditLogs', auditLogs),
    ]);

    return {
      settings: freshSettings,
      classes: freshClasses,
      students: freshStudents,
      attendance: freshAttendance,
      cases: freshCases,
      counselingLogs: freshCounselingLogs,
      parentCalls: freshParentCalls,
      monitoringNotes: freshMonitoringNotes,
      schedules: freshSchedules,
      users: freshUsers,
      auditLogs: freshAuditLogs,
    };
  };

  const restoreFromBackupJSON = async (
    backup: Record<string, unknown>,
    options?: RestoreBackupOptions
  ): Promise<RestoreExecutionResult> => {
    const driveFiles = Array.isArray(backup.driveFiles)
      ? (backup.driveFiles as BackedUpDriveFile[])
      : [];
    const backupSettings =
      backup.settings && typeof backup.settings === 'object'
        ? (backup.settings as Partial<SystemSettings>)
        : undefined;
    const effectiveTargetFolderUrl =
      options?.targetFolderUrl ?? backupSettings?.driveFolderUrl ?? settings.driveFolderUrl;

    let restoredDriveMap: Record<string, RestoredDriveLinkInfo> = {};
    let restoredDriveFiles = 0;
    let reusedExistingDriveFiles = 0;
    const driveWarnings: string[] = [];

    if (options?.restoreDriveFiles && driveFiles.length > 0) {
      if (options.driveAccessToken) {
        options.onProgress?.(`Memeriksa & memulihkan ${driveFiles.length} file Google Drive...`);
        const driveRes = await restoreDriveFilesToGoogleDrive({
          driveFiles,
          folderUrlOrId: effectiveTargetFolderUrl,
          accessToken: options.driveAccessToken,
          onProgress: ({ current, total, fileName }) => {
            options.onProgress?.(`Memulihkan file Google Drive (${current}/${total}): ${fileName}`);
          },
        });
        restoredDriveMap = driveRes.restoredDriveMap;
        restoredDriveFiles = driveRes.uploadedCount;
        reusedExistingDriveFiles = driveRes.reusedCount;
        driveWarnings.push(...driveRes.warnings);
      } else {
        driveWarnings.push(
          'Akun Google Drive belum terhubung saat Restore. Database tetap dipulihkan, namun file fisik Google Drive belum diunggah ulang.'
        );
      }
    }

    if (isDemoMode) {
      let restoredDocs = 0;
      let skippedAuditLogs = 0;

      if (backup.settings && typeof backup.settings === 'object') {
        setSettings({ ...DEFAULT_SETTINGS, ...(backup.settings as SystemSettings), id: 'global' });
        restoredDocs += 1;
      }
      if (Array.isArray(backup.classes)) {
        setClasses(backup.classes as SchoolClass[]);
        restoredDocs += backup.classes.length;
      }
      if (Array.isArray(backup.students)) {
        setStudents(backup.students as Student[]);
        restoredDocs += backup.students.length;
      }
      if (Array.isArray(backup.attendance)) {
        setAttendance(backup.attendance as AttendanceRecord[]);
        restoredDocs += backup.attendance.length;
      }
      if (Array.isArray(backup.cases)) {
        const relinkedCases =
          Object.keys(restoredDriveMap).length > 0
            ? relinkCasesWithRestoredDriveFiles(backup.cases, restoredDriveMap)
            : (backup.cases as StudentCase[]);
        setCases(relinkedCases);
        restoredDocs += relinkedCases.length;
      }
      if (Array.isArray(backup.counselingLogs)) {
        setCounselingLogs(backup.counselingLogs as CounselingLog[]);
        restoredDocs += backup.counselingLogs.length;
      }
      if (Array.isArray(backup.parentCalls)) {
        setParentCalls(backup.parentCalls as ParentCall[]);
        restoredDocs += backup.parentCalls.length;
      }
      if (Array.isArray(backup.monitoringNotes)) {
        setMonitoringNotes(backup.monitoringNotes as MonitoringNote[]);
        restoredDocs += backup.monitoringNotes.length;
      }
      if (Array.isArray(backup.schedules)) {
        setSchedules(backup.schedules as BKSchedule[]);
        restoredDocs += backup.schedules.length;
      }
      if (Array.isArray(backup.users)) {
        setUsers(backup.users as UserAccount[]);
        restoredDocs += backup.users.length;
      }
      if (Array.isArray(backup.auditLogs)) {
        const existingIds = new Set(auditLogs.map((a) => a.id));
        const incoming = (backup.auditLogs as AuditLog[]).filter((a) => {
          if (a && a.id && existingIds.has(a.id)) {
            skippedAuditLogs += 1;
            return false;
          }
          return Boolean(a && typeof a === 'object');
        });
        setAuditLogs((prev) => [...incoming, ...prev]);
        restoredDocs += incoming.length;
      }
      await recordAudit(
        'RESTORE_BACKUP_JSON',
        `Memulihkan ${restoredDocs} data (${restoredDriveFiles} file Drive baru)`
      );
      return {
        restoredDocs,
        skippedAuditLogs,
        restoredDriveFiles,
        reusedExistingDriveFiles,
        driveWarnings,
      };
    }

    try {
      options?.onProgress?.('Memeriksa log audit yang sudah ada...');
      const existingAuditIds = new Set<string>(auditLogs.map((a) => a.id));
      try {
        const auditSnap = await getDocs(collection(db, 'auditLogs'));
        auditSnap.docs.forEach((d) => existingAuditIds.add(d.id));
      } catch {
        // Use in-memory auditLogs set if list read is restricted
      }

      const plan = planFirestoreRestoreOperations({
        backup,
        existingAuditLogIds: existingAuditIds,
        restoredDriveMap,
        batchSize: 400,
      });

      for (let i = 0; i < plan.batches.length; i += 1) {
        options?.onProgress?.(
          `Menulis data ke Firebase Firestore (batch ${i + 1}/${plan.batches.length})...`
        );
        const batch = writeBatch(db);
        for (const op of plan.batches[i]) {
          const ref = doc(db, op.colName, op.docId);
          if (op.colName === 'auditLogs') {
            batch.set(ref, op.payload);
          } else {
            batch.set(ref, op.payload, { merge: true });
          }
        }
        await batch.commit();
      }

      // Note if any cases had Drive links but backup had no binaries & Drive isn't available
      const rawCases = Array.isArray(backup.cases) ? (backup.cases as Partial<StudentCase>[]) : [];
      const linkedCasesCount = rawCases.filter((c) => Boolean(extractDriveFileIdFromCase(c))).length;
      if (linkedCasesCount > 0 && driveFiles.length === 0) {
        driveWarnings.push(
          `Ada ${linkedCasesCount} kasus dengan tautan foto Google Drive, tetapi file backup ini tidak menyertakan file fisik Drive (hanya tautan).`
        );
      }

      await recordAudit(
        'RESTORE_BACKUP_JSON',
        `Memulihkan ${plan.writes.length} dokumen ke Firestore (${restoredDriveFiles} file Drive diunggah ulang, ${reusedExistingDriveFiles} dipertahankan)`
      );

      return {
        restoredDocs: plan.writes.length,
        skippedAuditLogs: plan.skippedExistingAuditLogs,
        restoredDriveFiles,
        reusedExistingDriveFiles,
        driveWarnings,
      };
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'backup/restore');
    }
  };

  const sortedClasses = useMemo(() => {
    const levelOrder: Record<string, number> = {
      VII: 1,
      '7': 1,
      VIII: 2,
      '8': 2,
      IX: 3,
      '9': 3,
      X: 4,
      '10': 4,
      XI: 5,
      '11': 5,
      XII: 6,
      '12': 6,
    };
    return [...classes].sort((a, b) => {
      const la = levelOrder[a.level.trim().toUpperCase()] ?? 99;
      const lb = levelOrder[b.level.trim().toUpperCase()] ?? 99;
      if (la !== lb) return la - lb;
      return a.name.localeCompare(b.name, 'id', { numeric: true, sensitivity: 'base' });
    });
  }, [classes]);

  const isAdmin = currentUser?.role === 'Administrator';
  const isCounselor = currentUser?.role === 'Administrator' || currentUser?.role === 'Guru BK';
  const isHomeroom = currentUser?.role === 'Wali Kelas';
  const canViewCounseling = isCounselor;
  const canManageClasses = isAdmin;
  const canDeleteRecords = isAdmin;

  return (
    <SibkContext.Provider
      value={{
        authReady,
        isDemoMode,
        currentUser,
        loginWithCredentials,
        loginWithGoogle,
        enterDemoMode,
        logout,
        users,
        classes: sortedClasses,
        students,
        attendance,
        cases,
        counselingLogs,
        parentCalls,
        monitoringNotes,
        schedules,
        settings,
        auditLogs,
        isAdmin,
        isCounselor,
        isHomeroom,
        canViewCounseling,
        canManageClasses,
        canDeleteRecords,
        saveStudent,
        deleteStudent,
        bulkImportStudents,
        moveStudentClass,
        bulkPromoteOrGraduateStudents,
        saveClass,
        deleteClass,
        saveAttendanceBatch,
        deleteAttendanceByDateAndClass,
        addCaseWithAutoNumber,
        updateCase,
        deleteCase,
        addCounselingLog,
        saveParentCall,
        deleteParentCall,
        markStudentParentCallCompleted,
        acquireRecordLock,
        releaseRecordLock,
        syncError: syncSnapshot.lastError,
        clearSyncError: () => syncQueueRef.current?.clearError(),
        realtimeNotifications,
        dismissRealtimeNotification,
        addMonitoringNote,
        updateMonitoringNote,
        deleteMonitoringNote,
        updateStudentMonitoringStatus,
        saveSchedule,
        deleteSchedule,
        saveUserAccount,
        deleteUserAccount,
        saveSettings,
        createFullBackupSnapshot,
        restoreFromBackupJSON,
      }}
    >
      {children}
    </SibkContext.Provider>
  );
};

export function useSibk(): SibkContextValue {
  const ctx = useContext(SibkContext);
  if (!ctx) throw new Error('useSibk must be used within SibkProvider');
  return ctx;
}
