export type UserRole = 'Administrator' | 'Guru BK' | 'Wali Kelas';

export interface UserAccount {
  id: string;
  uid: string;
  email: string;
  username?: string;
  password?: string;
  name: string;
  role: UserRole;
  assignedClassId?: string;
  active: boolean;
  createdAt: string;
}

export interface SchoolClass {
  id: string;
  name: string;
  level: string;
  homeroomTeacher: string;
  academicYear: string;
  archived?: boolean;
}

export type StudentStatus = 'Aktif' | 'Pindah' | 'Lulus' | 'Keluar';
export type MonitoringStatus = 'Normal' | 'Perlu Perhatian' | 'Dalam Pemantauan' | 'Prioritas Tinggi';

export interface Student {
  id: string;
  nis: string;
  nisn: string;
  fullName: string;
  gender: 'Laki-laki' | 'Perempuan';
  birthPlace: string;
  birthDate: string;
  religion?: string;
  classId: string;
  className: string;
  address: string;
  studentPhone: string;
  fatherName: string;
  motherName: string;
  guardianName?: string;
  parentPhone: string;
  parentAddress?: string;
  entryYear: string;
  status: StudentStatus;
  notes?: string;
  monitoringStatus: MonitoringStatus;
  caseCount: number;
  caseCountAtLastParentCall?: number;
  academicYear: string;
}

export type AttendanceStatus = 'Hadir' | 'Sakit' | 'Izin' | 'Alpa' | 'Dispensasi';

export interface AttendanceRecord {
  id: string; // Deterministic: `${date}_${studentId}`
  date: string; // YYYY-MM-DD
  studentId: string;
  studentName: string;
  nis: string;
  classId: string;
  className: string;
  status: AttendanceStatus;
  note: string;
  academicYear: string;
  recordedBy: string;
}

export type CaseStatus =
  | 'Belum ditangani'
  | 'Sedang ditangani'
  | 'Dalam pemantauan'
  | 'Selesai'
  | 'Perlu tindak lanjut';

export interface StudentCase {
  id: string;
  studentId: string;
  studentName: string;
  nis: string;
  classId: string;
  className: string;
  caseNumber: number;
  date: string; // YYYY-MM-DD
  dayName: string;
  category: string;
  description: string;
  reporter: string;
  initialAction: string;
  counselorName: string;
  status: CaseStatus;
  photoUrl?: string;
  photoDriveFileId?: string;
  photoDriveWebViewLink?: string;
  academicYear: string;
  _version?: number;
  updatedAt?: string;
  updatedBy?: string;
  lockBy?: string | null;
  lockByName?: string | null;
  lockExpiresAt?: number | null;
}

export interface CounselingLog {
  id: string;
  caseId: string;
  studentId: string;
  date: string;
  counselorName: string;
  topic: string;
  result: string;
  solution: string;
  studentCommitment: string;
  followUpPlan: string;
  nextEvaluationDate: string;
  progressStatus: CaseStatus;
  _version?: number;
  updatedAt?: string;
  updatedBy?: string;
}

export type ParentCallStatus =
  | 'Belum dijadwalkan'
  | 'Sudah dijadwalkan'
  | 'Sudah dipanggil'
  | 'Hadir'
  | 'Tidak hadir'
  | 'Perlu pemanggilan ulang'
  | 'Selesai';

export interface ParentCall {
  id: string;
  letterNumber: string;
  studentId: string;
  studentName: string;
  className: string;
  parentName: string;
  parentPhone: string;
  callDate: string;
  meetingDate?: string;
  meetingTime?: string;
  meetingSchedule: string;
  reason: string;
  relatedCaseId?: string;
  previousCallId?: string;
  meetingResult: string;
  agreement: string;
  followUpNote: string;
  status: ParentCallStatus;
  _version?: number;
  updatedAt?: string;
  updatedBy?: string;
  lockBy?: string | null;
  lockByName?: string | null;
  lockExpiresAt?: number | null;
}

export type ProgressLevel = 'Membaik' | 'Stabil' | 'Perlu Perhatian' | 'Menurun';

export interface MonitoringNote {
  id: string;
  studentId: string;
  date: string;
  counselorName: string;
  observation: string;
  progressLevel: ProgressLevel;
}

export type ScheduleType =
  | 'Konseling Siswa'
  | 'Pemanggilan Orang Tua'
  | 'Tindak Lanjut'
  | 'Koordinasi Wali Kelas'
  | 'Kegiatan BK';

export interface BKSchedule {
  id: string;
  title: string;
  type: ScheduleType;
  date: string;
  time: string;
  studentId?: string;
  studentName?: string;
  notes: string;
  completed: boolean;
}

export interface SystemSettings {
  id: string;
  letterheadLine1?: string;
  letterheadLine2?: string;
  schoolName: string;
  schoolAddress: string;
  schoolPhone: string;
  schoolEmailSocial?: string;
  schoolLogoUrl?: string;
  principalName: string;
  principalNip: string;
  activeAcademicYear: string;
  activeSemester: 'Ganjil' | 'Genap';
  warningThreshold1: number;
  warningThreshold2: number;
  maxCaseThreshold: number;
  maxSickThreshold?: number;
  maxPermissionThreshold?: number;
  maxAlphaThreshold?: number;
  reportNumberFormat: string;
  categories: string[];
  counselors?: string[];
  driveFolderUrl?: string;
}

export interface AuditLog {
  id: string;
  userEmail: string;
  userName: string;
  action: string;
  target: string;
  timestamp: string;
}

export type NavSection =
  | 'dashboard'
  | 'students'
  | 'classes'
  | 'attendance'
  | 'attendance-recap'
  | 'cases'
  | 'monitoring'
  | 'parent-calls'
  | 'schedules'
  | 'reports'
  | 'users'
  | 'settings';
