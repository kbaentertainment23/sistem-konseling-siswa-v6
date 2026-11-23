import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Plus,
  AlertTriangle,
  MessageSquarePlus,
  X,
  Trash2,
  Lock,
  Camera,
  Image as ImageIcon,
  Upload,
  HardDrive,
  CheckCircle2,
  ExternalLink,
  Loader2,
  Pencil,
  AlertCircle,
  BellRing,
  CalendarClock,
  PhoneCall,
  Search,
} from 'lucide-react';
import { useSibk } from '../context/SibkContext';
import type { CaseStatus, Student, StudentCase } from '../types/sibk';
import {
  DEFAULT_COUNSELORS,
  evaluateCaseThreshold,
  formatDateShort,
  getIndonesianDayName,
  getNextCaseNumber,
  getTodayISO,
} from '../utils/sibkLogic';
import {
  buildCasePhotoFileName,
  buildInitialCounselingTopic,
  buildParentCallReasonFromCase,
  canTriggerParentCallFromCase,
  CASE_DESCRIPTION_TEMPLATES,
  CASE_INITIAL_ACTION_TEMPLATES,
  computeCaseAttentionSummary,
  COUNSELING_COMMITMENT_TEMPLATES,
  COUNSELING_FOLLOWUP_TEMPLATES,
  COUNSELING_SOLUTION_TEMPLATES,
  getCaseEvaluationUrgency,
  getCaseStage,
  type CaseFilterStage,
} from '../utils/caseLogic';
import {
  connectGoogleDrive,
  extractDriveFolderId,
  getConnectedDriveEmail,
  getDriveAccessToken,
  uploadPhotoToGoogleDrive,
} from '../lib/googleDrive';
import { ConfirmDeleteModal } from '../components/ConfirmDeleteModal';
import { ErrorToast } from '../components/ErrorToast';
import { useModalScrollLock } from '../utils/useModalScrollLock';
import { useModalDismiss } from '../utils/useModalDismiss';

function compressImageFile(file: File, maxDimension = 1280, quality = 0.78): Promise<string> {
  return new Promise((resolve, reject) => {
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    const allowedExts = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'];
    if (file.size === 0) {
      reject(new Error(`File "${file.name}" kosong (0 KB) dan tidak dapat dimuat.`));
      return;
    }
    if (ext === 'heic' || ext === 'heif' || file.type === 'image/heic' || file.type === 'image/heif') {
      reject(
        new Error(
          'Format foto HEIC/HEIF (iPhone/kamera baru) belum didukung browser. Ubah ke JPG/PNG atau gunakan tombol Kamera Langsung.'
        )
      );
      return;
    }
    if (
      (file.type && !file.type.startsWith('image/')) ||
      (!file.type && ext && !allowedExts.includes(ext))
    ) {
      reject(
        new Error(
          `File "${file.name}" bukan file gambar yang valid. Pilih foto berformat JPG, PNG, atau WEBP.`
        )
      );
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      reject(
        new Error(
          `Ukuran foto "${file.name}" terlalu besar (${(file.size / (1024 * 1024)).toFixed(1)} MB). Batas maksimal file adalah 20 MB.`
        )
      );
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(
        new Error(
          `Foto "${file.name}" tidak dapat dimuat. Pastikan formatnya JPG, PNG, atau WEBP yang tidak rusak.`
        )
      );
    };
    img.onload = () => {
      try {
        const vw = img.naturalWidth || img.width;
        const vh = img.naturalHeight || img.height;
        const scale = Math.min(1, maxDimension / Math.max(vw, vh));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(vw * scale));
        canvas.height = Math.max(1, Math.round(vh * scale));
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          URL.revokeObjectURL(objectUrl);
          reject(new Error('Browser gagal memproses kanvas gambar. Coba foto lain.'));
          return;
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        URL.revokeObjectURL(objectUrl);
        resolve(dataUrl);
      } catch {
        URL.revokeObjectURL(objectUrl);
        reject(
          new Error(
            'Gagal mengompres foto (ukuran resolusi terlalu besar untuk memori HP). Coba ambil foto langsung dari tombol Kamera.'
          )
        );
      }
    };
    img.src = objectUrl;
  });
}

interface CasesViewProps {
  preselectedStudent?: Student | null;
  onClearPreselected?: () => void;
  onSelectStudent: (student: Student) => void;
  onCreateParentCallForCase?: (draft: {
    student: Student;
    reason: string;
    relatedCaseId?: string;
  }) => void;
}

const CASE_STATUSES: CaseStatus[] = [
  'Belum ditangani',
  'Sedang ditangani',
  'Dalam pemantauan',
  'Selesai',
  'Perlu tindak lanjut',
];

function getCaseStatusBadgeClass(status: CaseStatus): string {
  switch (status) {
    case 'Selesai':
      return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    case 'Belum ditangani':
    case 'Perlu tindak lanjut':
      return 'bg-red-50 text-red-700 border-red-200';
    case 'Dalam pemantauan':
      return 'bg-amber-50 text-amber-800 border-amber-200';
    case 'Sedang ditangani':
    default:
      return 'bg-sky-50 text-sky-800 border-sky-200';
  }
}

export const CasesView: React.FC<CasesViewProps> = ({
  preselectedStudent,
  onClearPreselected,
  onSelectStudent,
  onCreateParentCallForCase,
}) => {
  const {
    students,
    classes,
    cases,
    counselingLogs,
    parentCalls,
    settings,
    currentUser,
    isCounselor,
    canViewCounseling,
    canDeleteRecords,
    addCaseWithAutoNumber,
    updateCase,
    deleteCase,
    addCounselingLog,
    acquireRecordLock,
    releaseRecordLock,
    syncError,
    clearSyncError,
  } = useSibk();

  const todayISO = getTodayISO();

  const counselorOptions = useMemo(() => {
    const list = settings.counselors && settings.counselors.length > 0 ? settings.counselors : DEFAULT_COUNSELORS;
    return list;
  }, [settings.counselors]);

  const [search, setSearch] = useState('');
  const [classFilter, setClassFilter] = useState('all');
  const [monthFilter, setMonthFilter] = useState('');
  const [stageFilter, setStageFilter] = useState<CaseFilterStage>('all');
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [editingCase, setEditingCase] = useState<StudentCase | null>(null);
  const [editDate, setEditDate] = useState('');
  const [editCategory, setEditCategory] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editReporter, setEditReporter] = useState('');
  const [editInitialAction, setEditInitialAction] = useState('');
  const [editCounselor, setEditCounselor] = useState('');
  const [editStatus, setEditStatus] = useState<CaseStatus>('Belum ditangani');
  const [editPhotoDataUrl, setEditPhotoDataUrl] = useState('');
  const [uploadingEditPhoto, setUploadingEditPhoto] = useState(false);
  const [editLockNotice, setEditLockNotice] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [selectedCaseForLog, setSelectedCaseForLog] = useState<StudentCase | null>(null);
  const [previewPhotoCase, setPreviewPhotoCase] = useState<StudentCase | null>(null);
  const [deleteTargetCase, setDeleteTargetCase] = useState<StudentCase | null>(null);

  const isAnyModalOpen =
    addModalOpen ||
    Boolean(editingCase) ||
    Boolean(selectedCaseForLog) ||
    Boolean(previewPhotoCase) ||
    Boolean(deleteTargetCase);

  useModalScrollLock(isAnyModalOpen);
  const [feedback, setFeedback] = useState('');
  const [errorToast, setErrorToast] = useState('');
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [driveEmail, setDriveEmail] = useState<string | null>(
    getDriveAccessToken() ? getConnectedDriveEmail() : null
  );
  const [driveConnecting, setDriveConnecting] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [submittingCase, setSubmittingCase] = useState(false);
  const [submittingLog, setSubmittingLog] = useState(false);
  const [driveError, setDriveError] = useState('');

  const addCaseBackdropProps = useModalDismiss({
    open: addModalOpen,
    onClose: () => setAddModalOpen(false),
    disabled: cameraOpen || uploadingPhoto || submittingCase,
  });
  const counselingLogBackdropProps = useModalDismiss({
    open: Boolean(selectedCaseForLog && canViewCounseling),
    onClose: () => setSelectedCaseForLog(null),
    disabled: submittingLog,
  });
  const previewPhotoBackdropProps = useModalDismiss({
    open: Boolean(previewPhotoCase && previewPhotoCase.photoUrl),
    onClose: () => setPreviewPhotoCase(null),
  });
  const editCaseBackdropProps = useModalDismiss({
    open: Boolean(editingCase && isCounselor),
    onClose: () => closeEditCaseModal(),
    disabled: cameraOpen || uploadingEditPhoto || savingEdit,
  });
  useModalDismiss({
    open: cameraOpen,
    onClose: () => stopCamera(),
  });
  const photoTargetRef = useRef<'add' | 'edit'>('add');
  const photoInputRef = useRef<HTMLInputElement>(null);
  const cameraFallbackInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // New Case Form
  const [formClassId, setFormClassId] = useState('');
  const [formStudentId, setFormStudentId] = useState('');
  const [formDate, setFormDate] = useState(getTodayISO());
  const [formCategory, setFormCategory] = useState(settings.categories[0] || 'Kedisiplinan');
  const [formDescription, setFormDescription] = useState('');
  const [formReporter, setFormReporter] = useState('');
  const [formInitialAction, setFormInitialAction] = useState('');
  const [formCounselor, setFormCounselor] = useState(counselorOptions[0] || currentUser?.name || 'Guru BK');
  const [formPhotoUrl, setFormPhotoUrl] = useState('');
  const [formStatus, setFormStatus] = useState<CaseStatus>('Sedang ditangani');

  // New Counseling Log Form
  const [logDate, setLogDate] = useState(getTodayISO());
  const [logTopic, setLogTopic] = useState('');
  const [logResult, setLogResult] = useState('');
  const [logSolution, setLogSolution] = useState('');
  const [logCommitment, setLogCommitment] = useState('');
  const [logFollowUp, setLogFollowUp] = useState('');
  const [logNextEval, setLogNextEval] = useState('');
  const [logStatus, setLogStatus] = useState<CaseStatus>('Dalam pemantauan');

  useEffect(() => {
    if (preselectedStudent) {
      setFormClassId(preselectedStudent.classId);
      setFormStudentId(preselectedStudent.id);
      setAddModalOpen(true);
      onClearPreselected?.();
    }
  }, [preselectedStudent, onClearPreselected]);

  const studentsInSelectedClass = useMemo(() => {
    if (!formClassId) return students.filter((s) => s.status === 'Aktif');
    return students.filter((s) => s.classId === formClassId && s.status === 'Aktif');
  }, [students, formClassId]);

  const chosenStudent = students.find((s) => s.id === formStudentId);
  const chosenStudentPreviousCases = useMemo(
    () =>
      formStudentId
        ? cases
            .filter((c) => c.studentId === formStudentId)
            .sort((a, b) => a.caseNumber - b.caseNumber)
        : [],
    [cases, formStudentId]
  );
  const nextCaseNumberPreview = formStudentId ? getNextCaseNumber(formStudentId, cases) : 1;
  const previewThreshold = evaluateCaseThreshold(nextCaseNumberPreview, settings);

  const studentCaseCountMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of cases) {
      map.set(c.studentId, (map.get(c.studentId) || 0) + 1);
    }
    return map;
  }, [cases]);

  const attentionSummary = useMemo(
    () =>
      computeCaseAttentionSummary({
        cases,
        counselingLogs,
        students,
        parentCalls,
        settings,
        todayISO,
        canViewCounseling,
      }),
    [cases, counselingLogs, students, parentCalls, settings, todayISO, canViewCounseling]
  );

  const stageCounts = useMemo(() => {
    let pending = 0;
    let active = 0;
    let done = 0;
    for (const c of cases) {
      const stage = getCaseStage(c.status);
      if (stage === 'pending') pending++;
      else if (stage === 'active') active++;
      else done++;
    }
    return {
      all: cases.length,
      pending,
      active,
      done,
    };
  }, [cases]);

  const filteredCases = useMemo(() => {
    const q = search.trim().toLowerCase();
    return cases
      .filter((c) => {
        if (classFilter !== 'all' && c.className !== classFilter) return false;
        if (monthFilter && !c.date.startsWith(monthFilter)) return false;
        if (stageFilter !== 'all' && getCaseStage(c.status) !== stageFilter) return false;
        if (!q) return true;
        return (
          c.studentName.toLowerCase().includes(q) ||
          c.nis.toLowerCase().includes(q) ||
          c.category.toLowerCase().includes(q) ||
          c.description.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => {
        const getCreatedTs = (id: string): number => {
          const match = id.match(/^case_(\d+)_/);
          return match ? Number(match[1]) : 0;
        };
        const tsDiff = getCreatedTs(b.id) - getCreatedTs(a.id);
        if (tsDiff !== 0) return tsDiff;
        return b.date.localeCompare(a.date) || b.caseNumber - a.caseNumber;
      });
  }, [cases, search, classFilter, monthFilter, stageFilter]);

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setCameraOpen(false);
    setCameraError('');
  };

  const [cameraMirrored, setCameraMirrored] = useState(false);

  const openLiveCamera = async () => {
    setCameraError('');
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      cameraFallbackInputRef.current?.click();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });
      const videoTrack = stream.getVideoTracks()[0];
      const trackSettings = videoTrack?.getSettings?.();
      const isMobileOrTablet =
        /android|iphone|ipad|ipod|tablet/i.test(navigator.userAgent) ||
        window.matchMedia('(pointer: coarse)').matches;
      const isRearCamera =
        trackSettings?.facingMode === 'environment' ||
        (!trackSettings?.facingMode && isMobileOrTablet);
      setCameraMirrored(!isRearCamera);

      streamRef.current = stream;
      setCameraOpen(true);
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => {});
        }
      }, 60);
    } catch {
      // Fallback to native mobile camera input if permission denied or no webcam
      setCameraError('Kamera langsung tidak tersedia. Membuka kamera perangkat...');
      cameraFallbackInputRef.current?.click();
    }
  };

  const captureFromCamera = () => {
    const video = videoRef.current;
    if (!video) return;
    const vw = video.videoWidth || 1280;
    const vh = video.videoHeight || 720;
    const maxDimension = 1280;
    const scale = Math.min(1, maxDimension / Math.max(vw, vh));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(vw * scale);
    canvas.height = Math.round(vh * scale);
    const ctx = canvas.getContext('2d');
    if (ctx) {
      if (cameraMirrored) {
        ctx.translate(canvas.width, 0);
        ctx.scale(-1, 1);
      }
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.78);
      if (photoTargetRef.current === 'edit') {
        setEditPhotoDataUrl(dataUrl);
      } else {
        setFormPhotoUrl(dataUrl);
      }
    }
    stopCamera();
  };

  const handlePhotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCameraError('');
    setErrorToast('');
    try {
      const compressed = await compressImageFile(file);
      if (photoTargetRef.current === 'edit') {
        setEditPhotoDataUrl(compressed);
      } else {
        setFormPhotoUrl(compressed);
      }
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : 'Gagal memproses file foto. Pastikan format gambar valid (JPG/PNG/WEBP).';
      setCameraError(msg);
      setErrorToast(msg);
    }
    if (photoInputRef.current) photoInputRef.current.value = '';
    if (cameraFallbackInputRef.current) cameraFallbackInputRef.current.value = '';
  };

  const handleConnectDrive = async (): Promise<string | null> => {
    setDriveError('');
    setDriveConnecting(true);
    try {
      const res = await connectGoogleDrive();
      setDriveEmail(res.email || 'Akun Google Terhubung');
      return res.accessToken;
    } catch (err) {
      setDriveError(
        err instanceof Error ? err.message : 'Gagal menghubungkan akun Google Drive.'
      );
      return null;
    } finally {
      setDriveConnecting(false);
    }
  };

  const handleAddCase = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chosenStudent || !formDescription.trim()) return;
    setDriveError('');

    let savedPhotoUrl: string | undefined;
    let savedDriveFileId: string | undefined;
    let savedDriveWebViewLink: string | undefined;

    if (formPhotoUrl) {
      setUploadingPhoto(true);
      try {
        let token = getDriveAccessToken();
        if (!token) {
          token = await handleConnectDrive();
        }
        if (!token) {
          setUploadingPhoto(false);
          return;
        }
        const fileName = buildCasePhotoFileName({
          date: formDate,
          className: chosenStudent.className,
          studentName: chosenStudent.fullName,
          nis: chosenStudent.nis,
          caseNumber: nextCaseNumberPreview,
          category: formCategory,
        });
        const uploaded = await uploadPhotoToGoogleDrive({
          dataUrl: formPhotoUrl,
          fileName,
          folderUrlOrId: settings.driveFolderUrl,
          accessToken: token,
        });
        savedPhotoUrl = uploaded.thumbnailUrl;
        savedDriveFileId = uploaded.fileId;
        savedDriveWebViewLink = uploaded.webViewLink;
      } catch (err) {
        setDriveError(
          err instanceof Error
            ? err.message
            : 'Gagal mengunggah foto ke Google Drive. Silakan coba lagi.'
        );
        setUploadingPhoto(false);
        return;
      } finally {
        setUploadingPhoto(false);
      }
    }

    setSubmittingCase(true);
    try {
      const created = await addCaseWithAutoNumber({
        studentId: chosenStudent.id,
        studentName: chosenStudent.fullName,
        nis: chosenStudent.nis,
        classId: chosenStudent.classId,
        className: chosenStudent.className,
        date: formDate,
        category: formCategory,
        description: formDescription.trim(),
        reporter: formReporter.trim() || currentUser?.name || 'Guru BK',
        initialAction: formInitialAction.trim(),
        counselorName: formCounselor || currentUser?.name || 'Guru BK',
        status: formStatus,
        photoUrl: savedPhotoUrl,
        photoDriveFileId: savedDriveFileId,
        photoDriveWebViewLink: savedDriveWebViewLink,
        academicYear: settings.activeAcademicYear,
      });

      setAddModalOpen(false);
      setFormDescription('');
      setFormInitialAction('');
      setFormPhotoUrl('');
      setDriveError('');
      setFeedback(
        savedDriveFileId
          ? `Kasus ke-${created.caseNumber} untuk ${created.studentName} berhasil dicatat & foto tersimpan di Google Drive.`
          : `Kasus ke-${created.caseNumber} untuk ${created.studentName} berhasil dicatat secara otomatis.`
      );
      setTimeout(() => setFeedback(''), 4500);
    } catch (err) {
      setErrorToast(
        err instanceof Error && !err.message.startsWith('{')
          ? err.message
          : 'Gagal menyimpan catatan kasus ke database. Periksa koneksi atau izin akses Anda.'
      );
    } finally {
      setSubmittingCase(false);
    }
  };

  const handleAddCounselingLog = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCaseForLog || !logTopic.trim() || !logResult.trim() || submittingLog) return;

    const currentEvalDate = logNextEval;
    setSubmittingLog(true);
    try {
      await addCounselingLog({
        caseId: selectedCaseForLog.id,
        studentId: selectedCaseForLog.studentId,
        date: logDate,
        counselorName: currentUser?.name || 'Guru BK',
        topic: logTopic.trim(),
        result: logResult.trim(),
        solution: logSolution.trim(),
        studentCommitment: logCommitment.trim(),
        followUpPlan: logFollowUp.trim(),
        nextEvaluationDate: currentEvalDate,
        progressStatus: logStatus,
      });

      setLogTopic(buildInitialCounselingTopic(selectedCaseForLog));
      setLogResult('');
      setLogSolution('');
      setLogCommitment('');
      setLogFollowUp('');
      setLogNextEval('');
      setFeedback(dataNextEvalMessage(currentEvalDate));
      setTimeout(() => setFeedback(''), 4000);
    } catch (err) {
      setErrorToast(
        err instanceof Error && !err.message.startsWith('{')
          ? err.message
          : 'Gagal menyimpan catatan sesi konseling. Periksa koneksi atau izin akses Anda.'
      );
    } finally {
      setSubmittingLog(false);
    }
  };

  function dataNextEvalMessage(nextEval: string): string {
    return nextEval
      ? 'Catatan sesi konseling disimpan & tanggal evaluasi otomatis disinkronkan ke Jadwal BK.'
      : 'Catatan sesi konseling baru berhasil ditambahkan ke riwayat.';
  }

  const openCounselingForCase = (c: StudentCase) => {
    setSelectedCaseForLog(c);
    setLogDate(getTodayISO());
    setLogTopic(buildInitialCounselingTopic(c));
    setLogStatus(c.status === 'Belum ditangani' ? 'Dalam pemantauan' : c.status);
  };

  const openEditCaseModal = (c: StudentCase) => {
    setEditingCase(c);
    setEditDate(c.date);
    setEditCategory(c.category);
    setEditDescription(c.description);
    setEditReporter(c.reporter || '');
    setEditInitialAction(c.initialAction || '');
    setEditCounselor(c.counselorName || counselorOptions[0] || '');
    setEditStatus(c.status);
    setEditPhotoDataUrl('');
    setCameraError('');
    setDriveError('');
    setEditLockNotice('');
    void acquireRecordLock('cases', c.id).then((res) => {
      if (res.lockedByOther) {
        setEditLockNotice(
          `Catatan ini sedang disunting oleh ${res.lockOwnerName}. Perubahan Anda tetap dapat disimpan dan akan digabungkan otomatis per kolom.`
        );
      }
    });
  };

  const closeEditCaseModal = () => {
    if (editingCase) {
      void releaseRecordLock('cases', editingCase.id);
    }
    setEditingCase(null);
    setEditPhotoDataUrl('');
    setCameraError('');
    setDriveError('');
    setEditLockNotice('');
  };

  const appendCaseTemplate = (
    setter: React.Dispatch<React.SetStateAction<string>>,
    currentValue: string,
    snippet: string
  ) => {
    const trimmed = currentValue.trim();
    if (!trimmed) {
      setter(snippet);
      return;
    }
    if (trimmed.toLowerCase().includes(snippet.toLowerCase())) return;
    setter(`${trimmed}; ${snippet}`);
  };

  const triggerParentCallForCase = (c: StudentCase) => {
    if (!onCreateParentCallForCase) return;
    const stu = students.find((s) => s.id === c.studentId);
    if (!stu) return;
    const totalCases = studentCaseCountMap.get(c.studentId) || c.caseNumber;
    onCreateParentCallForCase({
      student: stu,
      reason: buildParentCallReasonFromCase(c, totalCases),
      relatedCaseId: c.id,
    });
  };

  const activeCaseLogs = selectedCaseForLog
    ? counselingLogs
        .filter((l) => l.caseId === selectedCaseForLog.id)
        .sort((a, b) => b.date.localeCompare(a.date))
    : [];

  const hasCaseReminders =
    attentionSummary.overdueEvaluations.length > 0 ||
    attentionSummary.dueTodayEvaluations.length > 0 ||
    attentionSummary.pendingCases.length > 0 ||
    (isCounselor && Boolean(onCreateParentCallForCase) && attentionSummary.maxThresholdNeedCall.length > 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900">Manajemen Kasus & Konseling Siswa</h1>
          <p className="text-sm text-slate-600 mt-1">
            Nomor urut kasus dihitung otomatis per siswa (berdasarkan ID/NIS) · Batas maksimal:{' '}
            {settings.maxCaseThreshold} kasus
          </p>
        </div>
        <button
          type="button"
          onClick={() => setAddModalOpen(true)}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-[#1E3A5F] hover:bg-[#162C49] rounded-lg self-start sm:self-auto whitespace-nowrap"
        >
          <Plus className="w-4 h-4" /> Catat Kasus / Rujukan Baru
        </button>
      </div>

      {feedback && (
        <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-sm text-emerald-800">
          {feedback}
        </div>
      )}

      {/* Priority Reminder Banner */}
      {hasCaseReminders && (
        <section
          aria-label="Pengingat Prioritas Kasus dan Konseling"
          className="bg-white border border-amber-200 rounded-xl p-4 space-y-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <BellRing className="w-4 h-4 text-amber-600 shrink-0" />
              <h2 className="text-base font-bold text-slate-900">
                Pengingat Kasus &amp; Evaluasi Konseling
              </h2>
            </div>
            <span className="text-xs font-mono tabular-nums text-amber-800 font-medium">
              {attentionSummary.totalAttentionCount} kasus perlu perhatian
            </span>
          </div>

          <div className="divide-y divide-slate-100 border-t border-slate-100">
            {attentionSummary.overdueEvaluations.slice(0, 3).map(({ studentCase, evaluationDate }) => (
              <div
                key={`rem-over-${studentCase.id}`}
                className="py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-sm"
              >
                <div className="flex items-start gap-2.5 min-w-0">
                  <CalendarClock className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <span className="font-semibold text-red-700">Evaluasi Terlewat</span>
                    <span className="text-slate-400 mx-1.5">·</span>
                    <span className="font-semibold text-slate-900">
                      {studentCase.studentName} ({studentCase.className})
                    </span>
                    <span className="text-slate-400 mx-1.5">·</span>
                    <span className="text-slate-600 font-mono text-xs sm:text-sm">
                      Target {formatDateShort(evaluationDate)} · {studentCase.category}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => openCounselingForCase(studentCase)}
                  className="px-3 py-1.5 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded-md whitespace-nowrap self-start sm:self-auto"
                >
                  Catat Evaluasi
                </button>
              </div>
            ))}

            {attentionSummary.dueTodayEvaluations.slice(0, 3).map(({ studentCase }) => (
              <div
                key={`rem-today-${studentCase.id}`}
                className="py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-sm"
              >
                <div className="flex items-start gap-2.5 min-w-0">
                  <CalendarClock className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <span className="font-semibold text-amber-800">Evaluasi Hari Ini</span>
                    <span className="text-slate-400 mx-1.5">·</span>
                    <span className="font-semibold text-slate-900">
                      {studentCase.studentName} ({studentCase.className})
                    </span>
                    <span className="text-slate-400 mx-1.5">·</span>
                    <span className="text-slate-600">
                      Kasus ke-{studentCase.caseNumber} ({studentCase.category})
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => openCounselingForCase(studentCase)}
                  className="px-3 py-1.5 text-xs font-semibold text-white bg-[#1E3A5F] hover:bg-[#162C49] rounded-md whitespace-nowrap self-start sm:self-auto"
                >
                  Catat Evaluasi
                </button>
              </div>
            ))}

            {attentionSummary.pendingCases.slice(0, 3).map((c) => (
              <div
                key={`rem-pend-${c.id}`}
                className="py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-sm"
              >
                <div className="flex items-start gap-2.5 min-w-0">
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <span className="font-semibold text-amber-800">{c.status}</span>
                    <span className="text-slate-400 mx-1.5">·</span>
                    <span className="font-semibold text-slate-900">
                      {c.studentName} ({c.className})
                    </span>
                    <span className="text-slate-400 mx-1.5">·</span>
                    <span className="text-slate-600 line-clamp-1">
                      Kasus ke-{c.caseNumber} ({c.category})
                    </span>
                  </div>
                </div>
                {canViewCounseling && (
                  <button
                    type="button"
                    onClick={() => openCounselingForCase(c)}
                    className="px-3 py-1.5 text-xs font-semibold text-[#1E3A5F] bg-sky-50 hover:bg-sky-100 border border-sky-200 rounded-md whitespace-nowrap self-start sm:self-auto"
                  >
                    Tangani / Konseling
                  </button>
                )}
              </div>
            ))}

            {isCounselor &&
              onCreateParentCallForCase &&
              attentionSummary.maxThresholdNeedCall.slice(0, 3).map(({ studentCase, student, cycleCount }) => (
                <div
                  key={`rem-call-${student.id}`}
                  className="py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-sm"
                >
                  <div className="flex items-start gap-2.5 min-w-0">
                    <PhoneCall className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <span className="font-semibold text-red-700">Mencapai Batas Maksimal</span>
                      <span className="text-slate-400 mx-1.5">·</span>
                      <span className="font-semibold text-slate-900">
                        {student.fullName} ({student.className})
                      </span>
                      <span className="text-slate-400 mx-1.5">·</span>
                      <span className="text-slate-600 font-mono text-xs sm:text-sm">
                        {cycleCount} kasus baru belum dijadwalkan pemanggilan ortu
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => triggerParentCallForCase(studentCase)}
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 rounded-md whitespace-nowrap self-start sm:self-auto"
                  >
                    <PhoneCall className="w-3.5 h-3.5" /> Panggil Ortu
                  </button>
                </div>
              ))}
          </div>
        </section>
      )}

      {/* 4 Stage Tabs + Filters */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
        <div
          className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto"
          role="tablist"
          aria-label="Filter tahap penanganan kasus"
        >
          {(
            [
              { id: 'all', label: 'Semua', count: stageCounts.all },
              { id: 'pending', label: 'Perlu Ditangani', count: stageCounts.pending },
              { id: 'active', label: 'Diproses & Dipantau', count: stageCounts.active },
              { id: 'done', label: 'Selesai', count: stageCounts.done },
            ] as const
          ).map((tab) => {
            const active = stageFilter === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setStageFilter(tab.id)}
                className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors whitespace-nowrap shrink-0 inline-flex items-center gap-1.5 ${
                  active
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <span>{tab.label}</span>
                <span
                  className={`font-mono tabular-nums text-xs ${
                    active ? 'text-[#1E3A5F] font-semibold' : 'text-slate-500'
                  }`}
                >
                  ({tab.count})
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex flex-col lg:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cari nama siswa, NIS, kategori, atau deskripsi kasus..."
              aria-label="Cari kasus siswa"
              className="w-full pl-9 pr-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:bg-white focus:border-sky-600"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Filter kelas kasus"
              value={classFilter}
              onChange={(e) => setClassFilter(e.target.value)}
              className="px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
            >
              <option value="all">Semua Kelas</option>
              {classes
                .filter((c) => !c.archived)
                .map((c) => (
                  <option key={c.id} value={c.name}>
                    Kelas {c.name}
                  </option>
                ))}
            </select>
            <input
              type="month"
              aria-label="Filter bulan kasus"
              value={monthFilter}
              onChange={(e) => setMonthFilter(e.target.value)}
              className="px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
            />
            {(search || classFilter !== 'all' || monthFilter || stageFilter !== 'all') && (
              <button
                type="button"
                onClick={() => {
                  setSearch('');
                  setClassFilter('all');
                  setMonthFilter('');
                  setStageFilter('all');
                }}
                className="px-3 py-2 text-sm font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg whitespace-nowrap"
              >
                Reset
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Responsive Mobile Card List */}
      <div className="md:hidden space-y-3">
        {filteredCases.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-sm text-slate-500">
            Belum ada catatan kasus yang sesuai filter.
          </div>
        ) : (
          filteredCases.map((c) => {
            const stu = students.find((s) => s.id === c.studentId);
            const evalThreshold = evaluateCaseThreshold(c.caseNumber, settings);
            const logCount = counselingLogs.filter((l) => l.caseId === c.id).length;
            const evalUrgency = canViewCounseling
              ? getCaseEvaluationUrgency(c, counselingLogs, todayISO)
              : { dueToday: false, overdue: false, evaluationDate: '' };
            const showCallButton =
              isCounselor &&
              Boolean(onCreateParentCallForCase) &&
              Boolean(stu) &&
              canTriggerParentCallFromCase({
                studentCase: c,
                student: stu,
                totalStudentCases: studentCaseCountMap.get(c.studentId) || c.caseNumber,
                parentCalls,
                settings,
              });

            return (
              <div
                key={`card-${c.id}`}
                className="bg-white border border-slate-200 rounded-xl p-4 space-y-3 text-sm"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span
                        className={`font-mono font-bold text-xs ${
                          evalThreshold.level === 'max'
                            ? 'text-red-700'
                            : evalThreshold.level === 'warning2'
                              ? 'text-amber-700'
                              : 'text-slate-900'
                        }`}
                      >
                        Kasus ke-{c.caseNumber}
                      </span>
                      {evalThreshold.level === 'max' && (
                        <span className="px-1.5 py-0.5 text-xs font-semibold bg-red-50 text-red-700 border border-red-200 rounded">
                          Batas Maks
                        </span>
                      )}
                      {evalThreshold.level === 'warning2' && (
                        <span className="px-1.5 py-0.5 text-xs font-semibold bg-amber-50 text-amber-800 border border-amber-200 rounded">
                          Peringatan
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => stu && onSelectStudent(stu)}
                      className="text-base font-bold text-slate-900 hover:text-sky-700 text-left mt-1"
                    >
                      {c.studentName}
                    </button>
                    <div className="text-xs text-slate-500 font-mono">
                      Kelas {c.className} · NIS {c.nis} · {formatDateShort(c.date)}
                    </div>
                  </div>
                  <span
                    className={`inline-flex px-2 py-0.5 rounded border text-xs font-semibold shrink-0 ${getCaseStatusBadgeClass(
                      c.status
                    )}`}
                  >
                    {c.status}
                  </span>
                </div>

                <div>
                  <div className="font-semibold text-slate-800">{c.category}</div>
                  <p className="text-slate-600 mt-0.5">{c.description}</p>
                  {evalUrgency.overdue && (
                    <div className="text-xs font-semibold text-red-700 mt-1">
                      Evaluasi terlewat (target {formatDateShort(evalUrgency.evaluationDate)})
                    </div>
                  )}
                  {evalUrgency.dueToday && (
                    <div className="text-xs font-semibold text-amber-800 mt-1">
                      Jadwal evaluasi konseling Hari Ini
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100">
                  {canViewCounseling ? (
                    <button
                      type="button"
                      onClick={() => openCounselingForCase(c)}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-sky-800 bg-sky-50 hover:bg-sky-100 border border-sky-200 rounded-md"
                    >
                      <MessageSquarePlus className="w-3.5 h-3.5" />
                      Konseling ({logCount})
                    </button>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs text-slate-400">
                      <Lock className="w-3.5 h-3.5" /> Rahasia
                    </span>
                  )}
                  {showCallButton && (
                    <button
                      type="button"
                      onClick={() => triggerParentCallForCase(c)}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 rounded-md"
                    >
                      <PhoneCall className="w-3.5 h-3.5" />
                      Panggil Ortu
                    </button>
                  )}
                  {c.photoUrl && (
                    <button
                      type="button"
                      onClick={() => setPreviewPhotoCase(c)}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-emerald-800 bg-emerald-50 hover:bg-emerald-100 rounded-md"
                    >
                      <ImageIcon className="w-3.5 h-3.5" />
                      Foto
                    </button>
                  )}
                  {isCounselor && (
                    <button
                      type="button"
                      onClick={() => openEditCaseModal(c)}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                      Edit
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Desktop Cases Table */}
      <div className="hidden md:block bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 border-b border-slate-200 text-xs text-slate-600">
              <tr>
                <th className="pl-4 pr-3 py-3 font-semibold">Urutan</th>
                <th className="px-3 py-3 font-semibold">Siswa &amp; Kelas</th>
                <th className="px-3 py-3 font-semibold">Tanggal</th>
                <th className="px-3 py-3 font-semibold">Kategori &amp; Permasalahan</th>
                <th className="px-3 py-3 font-semibold">Status</th>
                <th className="pl-3 pr-4 py-3 font-semibold text-right">Aksi &amp; Konseling</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredCases.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                    Belum ada catatan kasus yang sesuai filter.
                  </td>
                </tr>
              ) : (
                filteredCases.map((c) => {
                  const stu = students.find((s) => s.id === c.studentId);
                  const evalThreshold = evaluateCaseThreshold(c.caseNumber, settings);
                  const logCount = counselingLogs.filter((l) => l.caseId === c.id).length;
                  const evalUrgency = canViewCounseling
                    ? getCaseEvaluationUrgency(c, counselingLogs, todayISO)
                    : { dueToday: false, overdue: false, evaluationDate: '' };
                  const showCallButton =
                    isCounselor &&
                    Boolean(onCreateParentCallForCase) &&
                    Boolean(stu) &&
                    canTriggerParentCallFromCase({
                      studentCase: c,
                      student: stu,
                      totalStudentCases: studentCaseCountMap.get(c.studentId) || c.caseNumber,
                      parentCalls,
                      settings,
                    });

                  return (
                    <tr key={c.id} className="hover:bg-slate-50/70 align-top">
                      <td className="pl-4 pr-3 py-3 font-mono font-semibold whitespace-nowrap">
                        <div
                          className={
                            evalThreshold.level === 'max'
                              ? 'text-red-700'
                              : evalThreshold.level === 'warning2'
                                ? 'text-amber-700'
                                : 'text-slate-900'
                          }
                        >
                          Kasus ke-{c.caseNumber}
                        </div>
                        {evalThreshold.level === 'max' && (
                          <span className="inline-block mt-1 font-sans px-1.5 py-0.5 text-xs font-semibold bg-red-50 text-red-700 border border-red-200 rounded">
                            Batas Maks
                          </span>
                        )}
                        {evalThreshold.level === 'warning2' && (
                          <span className="inline-block mt-1 font-sans px-1.5 py-0.5 text-xs font-semibold bg-amber-50 text-amber-800 border border-amber-200 rounded">
                            Peringatan
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <button
                          type="button"
                          onClick={() => stu && onSelectStudent(stu)}
                          className="font-semibold text-slate-900 hover:text-sky-700 text-left"
                        >
                          {c.studentName}
                        </button>
                        <div className="text-xs text-slate-500 font-mono">
                          {c.className} · NIS {c.nis}
                        </div>
                      </td>
                      <td className="px-3 py-3 font-mono text-slate-600 whitespace-nowrap">
                        <div>{formatDateShort(c.date)}</div>
                        <div className="text-xs text-slate-500">{c.dayName}</div>
                      </td>
                      <td className="px-3 py-3 max-w-sm">
                        <div className="font-semibold text-slate-800">{c.category}</div>
                        <div className="text-slate-600 line-clamp-2 mt-0.5">{c.description}</div>
                        <div className="text-xs text-slate-500 mt-0.5">
                          Pendamping: {c.counselorName || '-'}
                        </div>
                        {evalUrgency.overdue && (
                          <div className="inline-flex items-center gap-1 mt-1 px-1.5 py-0.5 text-xs font-semibold bg-red-50 text-red-700 border border-red-200 rounded">
                            Evaluasi terlewat ({formatDateShort(evalUrgency.evaluationDate)})
                          </div>
                        )}
                        {evalUrgency.dueToday && (
                          <div className="inline-flex items-center gap-1 mt-1 px-1.5 py-0.5 text-xs font-semibold bg-amber-50 text-amber-800 border border-amber-200 rounded">
                            Evaluasi Hari Ini
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap">
                        {isCounselor ? (
                          <select
                            aria-label={`Ubah status kasus ${c.studentName}`}
                            value={c.status}
                            onChange={async (e) => {
                              try {
                                await updateCase(c.id, { status: e.target.value as CaseStatus }, c);
                              } catch (err) {
                                setErrorToast(
                                  err instanceof Error && !err.message.startsWith('{')
                                    ? err.message
                                    : 'Gagal memperbarui status kasus. Periksa koneksi atau izin akses Anda.'
                                );
                              }
                            }}
                            className={`px-2 py-1 text-xs font-medium border rounded-md ${getCaseStatusBadgeClass(
                              c.status
                            )}`}
                          >
                            {CASE_STATUSES.map((st) => (
                              <option key={st} value={st} className="bg-white text-slate-900">
                                {st}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span
                            className={`inline-flex px-2 py-0.5 rounded border text-xs font-semibold ${getCaseStatusBadgeClass(
                              c.status
                            )}`}
                          >
                            {c.status}
                          </span>
                        )}
                      </td>
                      <td className="pl-3 pr-4 py-3 text-right whitespace-nowrap">
                        <div className="inline-flex flex-wrap xl:flex-nowrap items-center justify-end gap-1">
                          {c.photoUrl && (
                            <button
                              type="button"
                              onClick={() => setPreviewPhotoCase(c)}
                              className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-emerald-800 bg-emerald-50 hover:bg-emerald-100 rounded-md"
                            >
                              <ImageIcon className="w-3.5 h-3.5" />
                              Foto
                            </button>
                          )}
                          {canViewCounseling ? (
                            <button
                              type="button"
                              onClick={() => openCounselingForCase(c)}
                              className="inline-flex items-center gap-1 px-2 py-1 text-xs font-semibold text-sky-800 bg-sky-50 hover:bg-sky-100 border border-sky-200 rounded-md"
                            >
                              <MessageSquarePlus className="w-3.5 h-3.5" />
                              Konseling ({logCount})
                            </button>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-xs text-slate-400">
                              <Lock className="w-3.5 h-3.5" /> Rahasia
                            </span>
                          )}
                          {showCallButton && (
                            <button
                              type="button"
                              onClick={() => triggerParentCallForCase(c)}
                              className="inline-flex items-center gap-1 px-2 py-1 text-xs font-semibold text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 rounded-md"
                            >
                              <PhoneCall className="w-3.5 h-3.5" />
                              Panggil Ortu
                            </button>
                          )}
                          {isCounselor && (
                            <button
                              type="button"
                              aria-label={`Edit kasus ${c.studentName}`}
                              onClick={() => openEditCaseModal(c)}
                              className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                              Edit
                            </button>
                          )}
                          {canDeleteRecords && (
                            <button
                              type="button"
                              aria-label={`Hapus kasus ${c.studentName}`}
                              onClick={() => setDeleteTargetCase(c)}
                              className="p-1.5 text-slate-400 hover:text-red-700 rounded-md"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Case Modal */}
      {addModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4 overflow-y-auto"
          role="dialog"
          aria-modal="true"
          {...addCaseBackdropProps}
        >
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex items-start justify-between gap-3">
              <h2 className="text-lg font-bold text-slate-900">Catat Kasus / Permasalahan Baru</h2>
              <button
                type="button"
                aria-label="Tutup form kasus"
                title="Keluar"
                onClick={() => setAddModalOpen(false)}
                className="p-1.5 text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleAddCase} className="p-6 overflow-y-auto space-y-4 text-sm">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Filter Kelas</label>
                  <select
                    value={formClassId}
                    onChange={(e) => {
                      setFormClassId(e.target.value);
                      setFormStudentId('');
                    }}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg bg-white"
                  >
                    <option value="">Semua Kelas</option>
                    {classes
                      .filter((c) => !c.archived)
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          Kelas {c.name}
                        </option>
                      ))}
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Pilih Siswa *</label>
                  <select
                    required
                    value={formStudentId}
                    onChange={(e) => setFormStudentId(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg bg-white"
                  >
                    <option value="">-- Pilih Siswa --</option>
                    {studentsInSelectedClass.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.fullName} ({s.className} · NIS {s.nis})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Automatic Case Number & History Preview */}
              {chosenStudent && (
                <div
                  className={`p-4 rounded-xl border ${
                    previewThreshold.level === 'max'
                      ? 'bg-red-50 border-red-200 text-red-900'
                      : 'bg-sky-50/70 border-sky-200 text-slate-800'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 font-semibold mb-1">
                    <span>
                      Nomor Kasus Otomatis: <strong className="font-mono">Kasus ke-{nextCaseNumberPreview}</strong>
                    </span>
                    <span className="font-mono text-xs">
                      Riwayat sebelumnya: {chosenStudentPreviousCases.length} kasus
                    </span>
                  </div>
                  {previewThreshold.level !== 'none' && (
                    <div className="flex items-center gap-1.5 text-xs font-semibold mt-1">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                      <span>{previewThreshold.label} — Pertimbangkan asesmen & tindak lanjut.</span>
                    </div>
                  )}
                  {chosenStudentPreviousCases.length > 0 && (
                    <div className="mt-2 pt-2 border-t border-slate-200/70 space-y-1 text-xs">
                      {chosenStudentPreviousCases.slice(-3).map((prev) => (
                        <div key={prev.id}>
                          <span className="font-mono font-semibold">Kasus ke-{prev.caseNumber}</span> (
                          {formatDateShort(prev.date)}): {prev.category} — {prev.description}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Tanggal Kejadian *</label>
                  <input
                    type="date"
                    required
                    value={formDate}
                    onChange={(e) => setFormDate(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Hari (Otomatis)</label>
                  <input
                    readOnly
                    value={getIndonesianDayName(formDate)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg bg-slate-50 text-slate-600"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Kategori Permasalahan *</label>
                  <select
                    value={formCategory}
                    onChange={(e) => setFormCategory(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg bg-white"
                  >
                    {settings.categories.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="block font-medium text-slate-700">
                  Deskripsi Permasalahan *
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {CASE_DESCRIPTION_TEMPLATES.map((tpl) => (
                    <button
                      key={tpl}
                      type="button"
                      onClick={() => appendCaseTemplate(setFormDescription, formDescription, tpl)}
                      className="px-2.5 py-1 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors text-left"
                    >
                      + {tpl}
                    </button>
                  ))}
                </div>
                <textarea
                  required
                  rows={3}
                  placeholder="Pilih template di atas atau jelaskan kronologi permasalahan siswa..."
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    Guru BK Pendamping *
                  </label>
                  <select
                    required
                    value={formCounselor}
                    onChange={(e) => setFormCounselor(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg bg-white"
                  >
                    {counselorOptions.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Sumber Informasi / Pelapor</label>
                  <input
                    placeholder="Contoh: Wali Kelas VIII A"
                    value={formReporter}
                    onChange={(e) => setFormReporter(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Status Penanganan</label>
                  <select
                    value={formStatus}
                    onChange={(e) => setFormStatus(e.target.value as CaseStatus)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg bg-white"
                  >
                    {CASE_STATUSES.map((st) => (
                      <option key={st} value={st}>
                        {st}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="block font-medium text-slate-700">Tindakan Awal</label>
                <div className="flex flex-wrap gap-1.5">
                  {CASE_INITIAL_ACTION_TEMPLATES.map((tpl) => (
                    <button
                      key={tpl}
                      type="button"
                      onClick={() => appendCaseTemplate(setFormInitialAction, formInitialAction, tpl)}
                      className="px-2.5 py-1 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors text-left"
                    >
                      + {tpl}
                    </button>
                  ))}
                </div>
                <textarea
                  rows={2}
                  placeholder="Tindakan segera yang telah dilakukan..."
                  value={formInitialAction}
                  onChange={(e) => setFormInitialAction(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg"
                />
              </div>

              {/* Photo Documentation Upload: Direct Camera OR Gallery -> Google Drive */}
              <div>
                <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                  <label className="font-medium text-slate-700 flex items-center gap-1.5">
                    <HardDrive className="w-4 h-4 text-sky-700" />
                    Dokumentasi Foto Penanganan (Disimpan ke Google Drive)
                  </label>
                  {driveEmail ? (
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Drive terhubung ({driveEmail})
                    </span>
                  ) : (
                    <button
                      type="button"
                      disabled={driveConnecting}
                      onClick={() => handleConnectDrive()}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-slate-300 bg-white hover:bg-slate-50 text-xs font-medium text-slate-700 disabled:opacity-60"
                    >
                      <svg className="w-3.5 h-3.5" viewBox="0 0 48 48" aria-hidden="true">
                        <path
                          fill="#EA4335"
                          d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                        />
                        <path
                          fill="#4285F4"
                          d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                        />
                        <path
                          fill="#FBBC05"
                          d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                        />
                        <path
                          fill="#34A853"
                          d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                        />
                      </svg>
                      <span>{driveConnecting ? 'Menghubungkan...' : 'Hubungkan Google Drive'}</span>
                    </button>
                  )}
                </div>
                <p className="text-xs text-slate-500 mb-2">
                  {extractDriveFolderId(settings.driveFolderUrl)
                    ? 'Foto akan otomatis masuk ke folder Google Drive bersama milik sekolah (bisa pakai akun Google guru masing-masing selama folder sudah di-Share sebagai Editor).'
                    : 'Atur Link/ID Folder Google Drive di menu Pengaturan agar semua foto berkumpul di satu folder.'}
                </p>

                {!formPhotoUrl ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        photoTargetRef.current = 'add';
                        void openLiveCamera();
                      }}
                      className="py-4 px-4 border border-dashed border-slate-300 rounded-xl bg-slate-50 hover:bg-sky-50/60 hover:border-sky-500 transition-colors flex flex-col items-center justify-center gap-1.5 text-slate-700"
                    >
                      <Camera className="w-5 h-5 text-sky-700" />
                      <span className="font-semibold text-slate-900">Foto Langsung (Kamera)</span>
                      <span className="text-xs text-slate-500">
                        Buka kamera perangkat & jepret bukti
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        photoTargetRef.current = 'add';
                        photoInputRef.current?.click();
                      }}
                      className="py-4 px-4 border border-dashed border-slate-300 rounded-xl bg-slate-50 hover:bg-sky-50/60 hover:border-sky-500 transition-colors flex flex-col items-center justify-center gap-1.5 text-slate-700"
                    >
                      <Upload className="w-5 h-5 text-slate-600" />
                      <span className="font-semibold text-slate-900">Ambil dari Galeri</span>
                      <span className="text-xs text-slate-500">
                        Pilih file foto JPG/PNG dari perangkat
                      </span>
                    </button>
                  </div>
                ) : (
                  <div className="relative inline-block border border-slate-200 rounded-xl overflow-hidden bg-slate-50">
                    <img
                      src={formPhotoUrl}
                      alt="Pratinjau dokumentasi penanganan"
                      className="max-h-48 w-auto object-contain"
                    />
                    <button
                      type="button"
                      aria-label="Hapus foto dokumentasi"
                      onClick={() => setFormPhotoUrl('')}
                      className="absolute top-2 right-2 p-1.5 bg-slate-900/75 text-white rounded-lg hover:bg-red-600"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}

                {cameraError && (
                  <div
                    role="alert"
                    className="mt-2 p-2.5 rounded-lg bg-red-50 border border-red-200 flex items-start gap-2 text-xs text-red-800"
                  >
                    <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                    <span className="flex-1 font-medium">{cameraError}</span>
                    <button
                      type="button"
                      onClick={() => setCameraError('')}
                      aria-label="Tutup pesan error foto"
                      className="text-red-500 hover:text-red-800"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
                {driveError && (
                  <p className="text-xs text-red-700 mt-1.5 font-medium">{driveError}</p>
                )}
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  disabled={uploadingPhoto || submittingCase}
                  onClick={() => setAddModalOpen(false)}
                  className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 rounded-lg disabled:opacity-60"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={uploadingPhoto || submittingCase}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-[#1E3A5F] hover:bg-[#162C49] rounded-lg disabled:opacity-60"
                >
                  {uploadingPhoto ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Mengunggah ke Google Drive...
                    </>
                  ) : submittingCase ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Menyimpan Kasus...
                    </>
                  ) : (
                    <>Simpan Kasus ke-{nextCaseNumberPreview}</>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Counseling Logs Modal (Confidential) */}
      {selectedCaseForLog && canViewCounseling && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/50 overscroll-none flex items-center justify-center p-4 overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-labelledby="counseling-history-title"
          {...counselingLogBackdropProps}
        >
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden shadow-xl">
            <div className="px-6 py-4 sm:px-7 sm:py-5 border-b border-slate-200 flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h2
                  id="counseling-history-title"
                  className="text-lg sm:text-xl font-bold text-slate-900"
                >
                  Riwayat Konseling — {selectedCaseForLog.studentName} (Kasus ke-
                  {selectedCaseForLog.caseNumber})
                </h2>
                <p className="text-sm text-slate-600 mt-1 leading-relaxed">
                  {selectedCaseForLog.category} · {selectedCaseForLog.description}
                </p>
              </div>
              <button
                type="button"
                aria-label="Tutup riwayat konseling"
                title="Keluar"
                onClick={() => setSelectedCaseForLog(null)}
                className="p-2 text-white bg-red-600 hover:bg-red-700 rounded-lg shadow-xs transition-colors shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 sm:p-7 overflow-y-auto overscroll-contain space-y-6">
              {/* Add New Counseling Session Form */}
              <form
                onSubmit={handleAddCounselingLog}
                className="border border-slate-200 rounded-xl p-5 space-y-4 text-sm bg-slate-50/50"
              >
                <h3 className="text-base font-bold text-slate-900">
                  Tambah Catatan Sesi Konseling Baru (Tidak Menimpa Riwayat Lama)
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1.5">
                      Tanggal Konseling *
                    </label>
                    <input
                      type="date"
                      required
                      value={logDate}
                      onChange={(e) => setLogDate(e.target.value)}
                      className="w-full px-3.5 py-2.5 text-sm border border-slate-200 rounded-lg bg-white"
                    />
                  </div>
                  <div>
                    <label
                      className="block text-sm font-medium text-slate-700 mb-1.5"
                      title="Jika diisi, otomatis masuk sebagai agenda Jadwal BK"
                    >
                      Evaluasi (Jadwal BK)
                    </label>
                    <input
                      type="date"
                      value={logNextEval}
                      onChange={(e) => setLogNextEval(e.target.value)}
                      className="w-full px-3.5 py-2.5 text-sm border border-slate-200 rounded-lg bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1.5">
                      Status Perkembangan
                    </label>
                    <select
                      value={logStatus}
                      onChange={(e) => setLogStatus(e.target.value as CaseStatus)}
                      className="w-full px-3.5 py-2.5 text-sm border border-slate-200 rounded-lg bg-white"
                    >
                      {CASE_STATUSES.map((st) => (
                        <option key={st} value={st}>
                          {st}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">
                    Permasalahan yang Dibahas *
                  </label>
                  <input
                    required
                    value={logTopic}
                    onChange={(e) => setLogTopic(e.target.value)}
                    className="w-full px-3.5 py-2.5 text-sm border border-slate-200 rounded-lg bg-white"
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1.5">
                      Hasil Konseling *
                    </label>
                    <textarea
                      required
                      rows={3}
                      placeholder="Ringkasan dialog, faktor penyebab, dan respons siswa..."
                      value={logResult}
                      onChange={(e) => setLogResult(e.target.value)}
                      className="w-full px-3.5 py-2.5 text-sm border border-slate-200 rounded-lg bg-white leading-relaxed"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1.5">
                      Solusi / Arahan Guru BK
                    </label>
                    <textarea
                      rows={3}
                      placeholder="Arahan atau solusi pembinaan..."
                      value={logSolution}
                      onChange={(e) => setLogSolution(e.target.value)}
                      className="w-full px-3.5 py-2.5 text-sm border border-slate-200 rounded-lg bg-white leading-relaxed"
                    />
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {COUNSELING_SOLUTION_TEMPLATES.map((tpl) => (
                    <button
                      key={tpl}
                      type="button"
                      onClick={() => appendCaseTemplate(setLogSolution, logSolution, tpl)}
                      className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 rounded-md transition-colors text-left"
                    >
                      + Solusi: {tpl}
                    </button>
                  ))}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="block text-sm font-medium text-slate-700">
                      Komitmen Siswa
                    </label>
                    <input
                      placeholder="Komitmen perbaikan dari siswa..."
                      value={logCommitment}
                      onChange={(e) => setLogCommitment(e.target.value)}
                      className="w-full px-3.5 py-2.5 text-sm border border-slate-200 rounded-lg bg-white"
                    />
                    <div className="flex flex-wrap gap-1.5">
                      {COUNSELING_COMMITMENT_TEMPLATES.map((tpl) => (
                        <button
                          key={tpl}
                          type="button"
                          onClick={() => appendCaseTemplate(setLogCommitment, logCommitment, tpl)}
                          className="px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 rounded-md text-left"
                        >
                          + {tpl}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="block text-sm font-medium text-slate-700">
                      Rencana Tindak Lanjut
                    </label>
                    <input
                      placeholder="Langkah pemantauan berikutnya..."
                      value={logFollowUp}
                      onChange={(e) => setLogFollowUp(e.target.value)}
                      className="w-full px-3.5 py-2.5 text-sm border border-slate-200 rounded-lg bg-white"
                    />
                    <div className="flex flex-wrap gap-1.5">
                      {COUNSELING_FOLLOWUP_TEMPLATES.map((tpl) => (
                        <button
                          key={tpl}
                          type="button"
                          onClick={() => appendCaseTemplate(setLogFollowUp, logFollowUp, tpl)}
                          className="px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 rounded-md text-left"
                        >
                          + {tpl}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="flex justify-end pt-1">
                  <button
                    type="submit"
                    disabled={submittingLog}
                    className="px-5 py-2.5 text-sm font-semibold text-white bg-[#1E3A5F] hover:bg-[#162C49] disabled:opacity-60 rounded-lg"
                  >
                    {submittingLog ? 'Menyimpan...' : 'Simpan Catatan Konseling'}
                  </button>
                </div>
              </form>

              {/* Existing Logs */}
              <div className="space-y-3.5">
                <h3 className="text-base font-bold text-slate-900">
                  Riwayat Tersimpan ({activeCaseLogs.length} sesi)
                </h3>
                {activeCaseLogs.length === 0 ? (
                  <p className="text-sm text-slate-500">Belum ada catatan sesi konseling.</p>
                ) : (
                  activeCaseLogs.map((l) => (
                    <div
                      key={l.id}
                      className="border border-slate-200 rounded-xl p-5 text-sm space-y-2.5 bg-white"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2 text-slate-600">
                        <span className="font-mono text-sm">
                          {formatDateShort(l.date)} · {l.counselorName}
                        </span>
                        <span
                          className={`inline-flex px-2.5 py-0.5 rounded border text-xs font-semibold ${getCaseStatusBadgeClass(
                            l.progressStatus
                          )}`}
                        >
                          {l.progressStatus}
                        </span>
                      </div>
                      <div className="text-base font-bold text-slate-900">{l.topic}</div>
                      <div className="space-y-1.5 leading-relaxed text-slate-700">
                        <p>
                          <span className="font-semibold text-slate-900">Hasil:</span> {l.result}
                        </p>
                        <p>
                          <span className="font-semibold text-slate-900">Solusi:</span>{' '}
                          {l.solution || '-'}
                        </p>
                        <p>
                          <span className="font-semibold text-slate-900">Komitmen:</span>{' '}
                          {l.studentCommitment || '-'}
                        </p>
                        <p>
                          <span className="font-semibold text-slate-900">Tindak Lanjut:</span>{' '}
                          {l.followUpPlan || '-'}
                          {l.nextEvaluationDate
                            ? ` (Evaluasi: ${formatDateShort(l.nextEvaluationDate)})`
                            : ''}
                        </p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Photo Documentation Preview Modal */}
      {previewPhotoCase && previewPhotoCase.photoUrl && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/70 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          {...previewPhotoBackdropProps}
        >
          <div className="bg-white border border-slate-200 rounded-2xl max-w-2xl w-full overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-bold text-slate-900">
                  Dokumentasi Penanganan — {previewPhotoCase.studentName} (Kasus ke-
                  {previewPhotoCase.caseNumber})
                </h3>
                <p className="text-sm text-slate-500 mt-0.5">
                  {formatDateShort(previewPhotoCase.date)} · Pendamping:{' '}
                  {previewPhotoCase.counselorName}
                </p>
              </div>
              <button
                type="button"
                aria-label="Tutup pratinjau foto"
                title="Keluar"
                onClick={() => setPreviewPhotoCase(null)}
                className="p-1.5 text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 bg-slate-50 flex flex-col items-center justify-center gap-3">
              <img
                src={previewPhotoCase.photoUrl}
                alt={`Dokumentasi penanganan kasus ${previewPhotoCase.studentName}`}
                className="max-h-[65vh] w-auto rounded-lg object-contain"
              />
              {previewPhotoCase.photoDriveWebViewLink && (
                <a
                  href={previewPhotoCase.photoDriveWebViewLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-semibold text-sky-800 bg-sky-50 hover:bg-sky-100 border border-sky-200 rounded-lg"
                >
                  <ExternalLink className="w-4 h-4" />
                  Buka Foto Asli di Google Drive
                </a>
              )}
            </div>
          </div>
        </div>
      )}

      <ConfirmDeleteModal
        open={Boolean(deleteTargetCase)}
        title="Hapus Data Kasus BK?"
        itemName={
          deleteTargetCase
            ? `${deleteTargetCase.studentName} — Kasus ke-${deleteTargetCase.caseNumber} (${deleteTargetCase.category})`
            : undefined
        }
        description="Catatan kasus ini akan dihapus permanen dari database. Apakah Anda yakin ingin menghapusnya?"
        onCancel={() => setDeleteTargetCase(null)}
        onConfirm={async () => {
          if (!deleteTargetCase) return;
          try {
            await deleteCase(deleteTargetCase.id);
            setDeleteTargetCase(null);
          } catch (err) {
            setDeleteTargetCase(null);
            setErrorToast(
              err instanceof Error && !err.message.startsWith('{')
                ? err.message
                : 'Gagal menghapus kasus. Periksa koneksi atau izin akses Anda.'
            );
          }
        }}
      />

      {/* Edit Case Modal */}
      {editingCase && isCounselor && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          {...editCaseBackdropProps}
        >
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-xl max-h-[90vh] flex flex-col shadow-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-slate-900">
                  Edit Catatan Kasus — Kasus ke-{editingCase.caseNumber}
                </h2>
                <p className="text-sm text-slate-500 mt-0.5">
                  {editingCase.studentName} (Kelas {editingCase.className} · NIS {editingCase.nis})
                </p>
              </div>
              <button
                type="button"
                onClick={closeEditCaseModal}
                title="Keluar"
                className="p-1.5 text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors shrink-0"
                aria-label="Tutup modal edit kasus"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!editDescription.trim()) return;
                setDriveError('');

                let uploadedPhotoPatch: Partial<StudentCase> = {};
                if (editPhotoDataUrl) {
                  setUploadingEditPhoto(true);
                  try {
                    let token = getDriveAccessToken();
                    if (!token) {
                      token = await handleConnectDrive();
                    }
                    if (!token) {
                      setUploadingEditPhoto(false);
                      return;
                    }
                    const fileName = buildCasePhotoFileName({
                      date: editDate,
                      className: editingCase.className,
                      studentName: editingCase.studentName,
                      nis: editingCase.nis,
                      caseNumber: editingCase.caseNumber,
                      category: editCategory,
                    });
                    const uploaded = await uploadPhotoToGoogleDrive({
                      dataUrl: editPhotoDataUrl,
                      fileName,
                      folderUrlOrId: settings.driveFolderUrl,
                      accessToken: token,
                    });
                    uploadedPhotoPatch = {
                      photoUrl: uploaded.thumbnailUrl,
                      photoDriveFileId: uploaded.fileId,
                      photoDriveWebViewLink: uploaded.webViewLink,
                    };
                  } catch (err) {
                    setDriveError(
                      err instanceof Error
                        ? err.message
                        : 'Gagal mengunggah foto ke Google Drive. Silakan coba lagi.'
                    );
                    setUploadingEditPhoto(false);
                    return;
                  } finally {
                    setUploadingEditPhoto(false);
                  }
                }

                setSavingEdit(true);
                try {
                  await updateCase(
                    editingCase.id,
                    {
                      date: editDate,
                      dayName: getIndonesianDayName(editDate),
                      category: editCategory,
                      description: editDescription.trim(),
                      reporter: editReporter.trim(),
                      initialAction: editInitialAction.trim(),
                      counselorName: editCounselor,
                      status: editStatus,
                      ...uploadedPhotoPatch,
                    },
                    editingCase
                  );
                  setFeedback(
                    uploadedPhotoPatch.photoDriveFileId
                      ? `Catatan Kasus ke-${editingCase.caseNumber} (${editingCase.studentName}) diperbarui & foto tersimpan di Google Drive.`
                      : `Catatan Kasus ke-${editingCase.caseNumber} (${editingCase.studentName}) berhasil diperbarui.`
                  );
                  setTimeout(() => setFeedback(''), 4000);
                  setEditingCase(null);
                  setEditPhotoDataUrl('');
                  setEditLockNotice('');
                } catch (err) {
                  setErrorToast(
                    err instanceof Error && !err.message.startsWith('{')
                      ? err.message
                      : 'Gagal menyimpan perubahan kasus. Periksa koneksi atau izin akses Anda.'
                  );
                } finally {
                  setSavingEdit(false);
                }
              }}
              className="p-6 space-y-4 overflow-y-auto text-sm"
            >
              {editLockNotice && (
                <div
                  role="alert"
                  className="p-3 rounded-lg bg-amber-50 border border-amber-200 flex items-start gap-2 text-amber-900 font-medium"
                >
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <span>{editLockNotice}</span>
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    Tanggal Kejadian *
                  </label>
                  <input
                    type="date"
                    required
                    value={editDate}
                    onChange={(e) => setEditDate(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    Kategori Permasalahan *
                  </label>
                  <select
                    value={editCategory}
                    onChange={(e) => setEditCategory(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg bg-white"
                  >
                    {Array.from(new Set([...settings.categories, editCategory])).map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">
                  Uraian / Kronologi Kasus *
                </label>
                <textarea
                  required
                  rows={3}
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Pelapor</label>
                  <input
                    type="text"
                    value={editReporter}
                    onChange={(e) => setEditReporter(e.target.value)}
                    placeholder="Nama guru / wali kelas / siswa"
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    Guru BK Pendamping
                  </label>
                  <select
                    value={editCounselor}
                    onChange={(e) => setEditCounselor(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg bg-white"
                  >
                    {Array.from(new Set([...counselorOptions, editCounselor].filter(Boolean))).map(
                      (name) => (
                        <option key={name} value={name}>
                          {name}
                        </option>
                      )
                    )}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Tindakan Awal</label>
                  <input
                    type="text"
                    value={editInitialAction}
                    onChange={(e) => setEditInitialAction(e.target.value)}
                    placeholder="Teguran lisan, pembinaan, dll."
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Status Kasus</label>
                  <select
                    value={editStatus}
                    onChange={(e) => setEditStatus(e.target.value as CaseStatus)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg bg-white"
                  >
                    {CASE_STATUSES.map((st) => (
                      <option key={st} value={st}>
                        {st}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Photo Documentation Section in Edit Modal */}
              <div className="pt-2 border-t border-slate-100">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                  <label className="font-medium text-slate-700 flex items-center gap-1.5">
                    <HardDrive className="w-4 h-4 text-sky-700" />
                    Dokumentasi Foto Penanganan (Google Drive)
                  </label>
                  {driveEmail ? (
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Drive terhubung ({driveEmail})
                    </span>
                  ) : (
                    <button
                      type="button"
                      disabled={driveConnecting}
                      onClick={() => handleConnectDrive()}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-slate-300 bg-white hover:bg-slate-50 text-xs font-medium text-slate-700 disabled:opacity-60"
                    >
                      <span>{driveConnecting ? 'Menghubungkan...' : 'Hubungkan Google Drive'}</span>
                    </button>
                  )}
                </div>

                {editPhotoDataUrl ? (
                  <div className="space-y-2">
                    <div className="relative inline-block border border-slate-200 rounded-xl overflow-hidden bg-slate-50">
                      <img
                        src={editPhotoDataUrl}
                        alt="Pratinjau foto baru dokumentasi kasus"
                        className="max-h-44 w-auto object-contain"
                      />
                      <button
                        type="button"
                        aria-label="Hapus foto baru"
                        onClick={() => setEditPhotoDataUrl('')}
                        className="absolute top-2 right-2 p-1.5 bg-slate-900/75 text-white rounded-lg hover:bg-red-600"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <p className="text-xs text-sky-800 font-medium">
                      Foto siap diunggah ke Google Drive saat Anda menekan Simpan Perubahan.
                    </p>
                  </div>
                ) : editingCase.photoUrl ? (
                  <div className="p-3 rounded-xl bg-emerald-50/60 border border-emerald-200 space-y-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-emerald-900 text-xs font-medium">
                        Foto dokumentasi sudah tersimpan untuk Kasus ke-{editingCase.caseNumber}.
                      </span>
                      {editingCase.photoDriveWebViewLink && (
                        <a
                          href={editingCase.photoDriveWebViewLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs font-semibold text-sky-800 hover:underline"
                        >
                          <ExternalLink className="w-3.5 h-3.5" /> Buka di Drive
                        </a>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          photoTargetRef.current = 'edit';
                          void openLiveCamera();
                        }}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg"
                      >
                        <Camera className="w-3.5 h-3.5 text-sky-700" />
                        Ganti via Kamera
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          photoTargetRef.current = 'edit';
                          photoInputRef.current?.click();
                        }}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg"
                      >
                        <Upload className="w-3.5 h-3.5 text-slate-600" />
                        Ganti dari Galeri
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <p className="text-xs text-slate-500">
                      Belum ada foto dokumentasi. Tambahkan lewat kamera langsung atau galeri:
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <button
                        type="button"
                        onClick={() => {
                          photoTargetRef.current = 'edit';
                          void openLiveCamera();
                        }}
                        className="py-3.5 px-4 border border-dashed border-slate-300 rounded-xl bg-slate-50 hover:bg-sky-50/60 hover:border-sky-500 transition-colors flex flex-col items-center justify-center gap-1 text-slate-700"
                      >
                        <Camera className="w-5 h-5 text-sky-700" />
                        <span className="font-semibold text-slate-900">Foto Langsung (Kamera)</span>
                        <span className="text-xs text-slate-500">
                          Jepret bukti langsung sekarang
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          photoTargetRef.current = 'edit';
                          photoInputRef.current?.click();
                        }}
                        className="py-3.5 px-4 border border-dashed border-slate-300 rounded-xl bg-slate-50 hover:bg-sky-50/60 hover:border-sky-500 transition-colors flex flex-col items-center justify-center gap-1 text-slate-700"
                      >
                        <Upload className="w-5 h-5 text-slate-600" />
                        <span className="font-semibold text-slate-900">Ambil dari Galeri</span>
                        <span className="text-xs text-slate-500">
                          Pilih file foto JPG/PNG dari perangkat
                        </span>
                      </button>
                    </div>
                  </div>
                )}

                {cameraError && (
                  <div
                    role="alert"
                    className="mt-2 p-2.5 rounded-lg bg-red-50 border border-red-200 flex items-start gap-2 text-xs text-red-800"
                  >
                    <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                    <span className="flex-1 font-medium">{cameraError}</span>
                    <button
                      type="button"
                      onClick={() => setCameraError('')}
                      aria-label="Tutup pesan error foto"
                      className="text-red-500 hover:text-red-800"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
                {driveError && (
                  <p className="text-xs text-red-700 mt-1.5 font-medium">{driveError}</p>
                )}
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  disabled={uploadingEditPhoto || savingEdit}
                  onClick={closeEditCaseModal}
                  className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={uploadingEditPhoto || savingEdit}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-[#1E3A5F] hover:bg-[#162C49] disabled:opacity-50 rounded-lg"
                >
                  {uploadingEditPhoto ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Mengunggah ke Google Drive...
                    </>
                  ) : savingEdit ? (
                    'Menyimpan...'
                  ) : (
                    'Simpan Perubahan'
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Shared Hidden File Inputs & Live Camera Modal (used by both Add and Edit Case modals) */}
      <input
        ref={photoInputRef}
        type="file"
        accept="image/*"
        onChange={handlePhotoChange}
        className="hidden"
      />
      <input
        ref={cameraFallbackInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handlePhotoChange}
        className="hidden"
      />

      {cameraOpen && (
        <div className="fixed inset-0 z-[70] bg-black flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 bg-black/75 text-white shrink-0">
            <div>
              <div className="text-base font-semibold">Kamera Dokumentasi BK</div>
              <div className="text-xs text-slate-300">
                Mendukung posisi Landscape &amp; Portrait · Tanpa mirror kamera belakang
              </div>
            </div>
            <button
              type="button"
              onClick={stopCamera}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors shrink-0"
            >
              <X className="w-4 h-4" /> Keluar
            </button>
          </div>

          <div className="flex-1 min-h-0 flex items-center justify-center bg-black overflow-hidden">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className={`w-full h-full object-contain ${
                cameraMirrored ? '-scale-x-100' : ''
              }`}
            />
          </div>

          <div className="px-4 py-4 bg-black/80 flex items-center justify-center gap-4 shrink-0">
            <button
              type="button"
              onClick={stopCamera}
              className="px-4 py-2.5 text-sm font-semibold text-slate-200 bg-slate-800 hover:bg-slate-700 rounded-xl transition-colors"
            >
              Batal
            </button>
            <button
              type="button"
              onClick={captureFromCamera}
              className="inline-flex items-center gap-2 px-6 py-3 text-sm font-bold text-white bg-sky-600 hover:bg-sky-500 rounded-full shadow-lg ring-4 ring-white/20 transition-all active:scale-95"
            >
              <Camera className="w-5 h-5" /> Ambil Foto
            </button>
          </div>
        </div>
      )}

      <ErrorToast
        message={errorToast || syncError || ''}
        onClose={() => {
          setErrorToast('');
          clearSyncError();
        }}
      />
    </div>
  );
};
