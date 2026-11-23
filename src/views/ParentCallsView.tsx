import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  BellRing,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ClipboardCheck,
  Clock,
  MessageCircle,
  Pencil,
  Plus,
  Printer,
  RefreshCw,
  Search,
  Trash2,
  UserCheck,
  X,
} from 'lucide-react';
import { useSibk } from '../context/SibkContext';
import type { ParentCall, ParentCallStatus, Student } from '../types/sibk';
import { formatDateShort, formatOfficialNumber, getTodayISO } from '../utils/sibkLogic';
import {
  addDaysISO,
  buildParentCallWhatsAppUrl,
  computeParentCallAttentionSummary,
  formatMeetingScheduleText,
  getNextLetterSequence,
  getParentCallFilterStage,
  getParentCallReminderBucket,
  isParentCallCompleted,
  PARENT_CALL_AGREEMENT_TEMPLATES,
  PARENT_CALL_REASON_TEMPLATES,
  parseMeetingSchedule,
  type ParentCallFilterStage,
  type ParentCallQueueItem,
} from '../utils/parentCallLogic';
import { exportParentCallLetterPDF } from '../utils/exportUtils';
import { ConfirmDeleteModal } from '../components/ConfirmDeleteModal';
import { ErrorToast } from '../components/ErrorToast';
import { useModalDismiss } from '../utils/useModalDismiss';

const CALL_STATUSES: ParentCallStatus[] = [
  'Belum dijadwalkan',
  'Sudah dijadwalkan',
  'Sudah dipanggil',
  'Hadir',
  'Tidak hadir',
  'Perlu pemanggilan ulang',
  'Selesai',
];

type ModalMode = 'create' | 'edit' | 'result' | 'reschedule';

interface ParentCallFormState {
  letterNumber: string;
  studentId: string;
  studentName: string;
  className: string;
  parentName: string;
  parentPhone: string;
  callDate: string;
  meetingDate: string;
  meetingTime: string;
  meetingSchedule: string;
  reason: string;
  relatedCaseId: string;
  previousCallId: string;
  meetingResult: string;
  agreement: string;
  followUpNote: string;
  status: ParentCallStatus;
}

function getStatusBadgeStyle(status: ParentCallStatus): string {
  switch (status) {
    case 'Hadir':
    case 'Selesai':
      return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    case 'Tidak hadir':
    case 'Perlu pemanggilan ulang':
      return 'bg-red-50 text-red-700 border-red-200';
    case 'Belum dijadwalkan':
      return 'bg-amber-50 text-amber-800 border-amber-200';
    case 'Sudah dijadwalkan':
    case 'Sudah dipanggil':
    default:
      return 'bg-sky-50 text-sky-800 border-sky-200';
  }
}

interface ParentCallsViewProps {
  preselectedDraft?: {
    student: Student;
    reason: string;
    relatedCaseId?: string;
  } | null;
  onClearPreselectedDraft?: () => void;
}

export const ParentCallsView: React.FC<ParentCallsViewProps> = ({
  preselectedDraft,
  onClearPreselectedDraft,
}) => {
  const {
    students,
    attendance,
    cases,
    parentCalls,
    settings,
    currentUser,
    canDeleteRecords,
    saveParentCall,
    deleteParentCall,
    acquireRecordLock,
    releaseRecordLock,
    syncError,
    clearSyncError,
  } = useSibk();

  const todayISO = getTodayISO();

  const [stageFilter, setStageFilter] = useState<ParentCallFilterStage>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [queueExpanded, setQueueExpanded] = useState(true);
  const [feedbackNotice, setFeedbackNotice] = useState<string | null>(null);
  const [errorToast, setErrorToast] = useState('');

  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<ModalMode>('create');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingBaseRecord, setEditingBaseRecord] = useState<ParentCall | null>(null);
  const [editLockNotice, setEditLockNotice] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ParentCall | null>(null);

  const modalBackdropProps = useModalDismiss({
    open: modalOpen,
    onClose: () => closeModal(),
    disabled: saving,
  });

  const resultInputRef = useRef<HTMLTextAreaElement | null>(null);
  const phoneInputRef = useRef<HTMLInputElement | null>(null);
  const [focusPhoneOnOpen, setFocusPhoneOnOpen] = useState(false);

  const [form, setForm] = useState<ParentCallFormState>({
    letterNumber: '',
    studentId: '',
    studentName: '',
    className: '',
    parentName: '',
    parentPhone: '',
    callDate: todayISO,
    meetingDate: addDaysISO(todayISO, 1),
    meetingTime: '09:00',
    meetingSchedule: '',
    reason: '',
    relatedCaseId: '',
    previousCallId: '',
    meetingResult: '',
    agreement: '',
    followUpNote: '',
    status: 'Sudah dijadwalkan',
  });

  useEffect(() => {
    if (!modalOpen) return;
    const timer = setTimeout(() => {
      if (focusPhoneOnOpen && phoneInputRef.current) {
        phoneInputRef.current.focus();
        setFocusPhoneOnOpen(false);
      } else if (modalMode === 'result' && resultInputRef.current) {
        resultInputRef.current.focus();
        resultInputRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 80);
    return () => clearTimeout(timer);
  }, [modalOpen, modalMode, focusPhoneOnOpen]);

  useEffect(() => {
    if (!preselectedDraft) return;
    const today = getTodayISO();
    const s = preselectedDraft.student;
    setModalMode('create');
    setEditingId(null);
    setEditingBaseRecord(null);
    setEditLockNotice(null);
    setFormError(null);
    setForm({
      letterNumber: formatOfficialNumber(
        settings.reportNumberFormat,
        getNextLetterSequence(parentCalls),
        today
      ),
      studentId: s.id,
      studentName: s.fullName,
      className: s.className,
      parentName: s.fatherName || s.motherName || s.guardianName || '',
      parentPhone: s.parentPhone || '',
      callDate: today,
      meetingDate: addDaysISO(today, 1),
      meetingTime: '09:00',
      meetingSchedule: '',
      reason: preselectedDraft.reason,
      relatedCaseId: preselectedDraft.relatedCaseId || '',
      previousCallId: '',
      meetingResult: '',
      agreement: '',
      followUpNote: '',
      status: 'Sudah dijadwalkan',
    });
    setModalOpen(true);
    onClearPreselectedDraft?.();
  }, [preselectedDraft, onClearPreselectedDraft, parentCalls, settings.reportNumberFormat]);

  useEffect(() => {
    if (!feedbackNotice) return;
    const t = setTimeout(() => setFeedbackNotice(null), 5000);
    return () => clearTimeout(t);
  }, [feedbackNotice]);

  const attentionSummary = useMemo(
    () =>
      computeParentCallAttentionSummary({
        students,
        attendance,
        cases,
        parentCalls,
        settings,
        todayISO,
      }),
    [students, attendance, cases, parentCalls, settings, todayISO]
  );

  const stageCounts = useMemo(() => {
    let waiting = 0;
    let followup = 0;
    let done = 0;
    for (const call of parentCalls) {
      const st = getParentCallFilterStage(call, todayISO);
      if (st === 'waiting') waiting++;
      else if (st === 'followup') followup++;
      else done++;
    }
    return {
      all: parentCalls.length,
      waiting,
      followup,
      done,
    };
  }, [parentCalls, todayISO]);

  const filteredCalls = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return parentCalls
      .filter((call) => {
        if (stageFilter !== 'all' && getParentCallFilterStage(call, todayISO) !== stageFilter) {
          return false;
        }
        if (!q) return true;
        return (
          call.studentName.toLowerCase().includes(q) ||
          call.className.toLowerCase().includes(q) ||
          call.parentName.toLowerCase().includes(q) ||
          (call.letterNumber || '').toLowerCase().includes(q) ||
          call.reason.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => {
        const rank = (c: ParentCall) => {
          const bucket = getParentCallReminderBucket(c, todayISO);
          if (bucket === 'overdue') return 0;
          if (bucket === 'reschedule') return 1;
          if (bucket === 'today') return 2;
          if (bucket === 'unscheduled') return 3;
          if (bucket === 'tomorrow') return 4;
          if (bucket === 'upcoming') return 5;
          return 6;
        };
        const diff = rank(a) - rank(b);
        if (diff !== 0) return diff;
        return b.callDate.localeCompare(a.callDate);
      });
  }, [parentCalls, stageFilter, searchQuery, todayISO]);

  const nextLetterNumber = (dateStr: string) =>
    formatOfficialNumber(
      settings.reportNumberFormat,
      getNextLetterSequence(parentCalls),
      dateStr
    );

  const openAdd = () => {
    const today = getTodayISO();
    setModalMode('create');
    setEditingId(null);
    setEditingBaseRecord(null);
    setEditLockNotice(null);
    setFormError(null);
    setForm({
      letterNumber: nextLetterNumber(today),
      studentId: '',
      studentName: '',
      className: '',
      parentName: '',
      parentPhone: '',
      callDate: today,
      meetingDate: addDaysISO(today, 1),
      meetingTime: '09:00',
      meetingSchedule: '',
      reason: '',
      relatedCaseId: '',
      previousCallId: '',
      meetingResult: '',
      agreement: '',
      followUpNote: '',
      status: 'Sudah dijadwalkan',
    });
    setModalOpen(true);
  };

  const openFromQueue = (item: ParentCallQueueItem) => {
    const today = getTodayISO();
    const s = item.student;
    setModalMode('create');
    setEditingId(null);
    setEditingBaseRecord(null);
    setEditLockNotice(null);
    setFormError(null);
    setForm({
      letterNumber: nextLetterNumber(today),
      studentId: s.id,
      studentName: s.fullName,
      className: s.className,
      parentName: s.fatherName || s.motherName || s.guardianName || '',
      parentPhone: s.parentPhone || '',
      callDate: today,
      meetingDate: addDaysISO(today, 1),
      meetingTime: '09:00',
      meetingSchedule: '',
      reason: item.draftReason,
      relatedCaseId: '',
      previousCallId: '',
      meetingResult: '',
      agreement: '',
      followUpNote: '',
      status: 'Sudah dijadwalkan',
    });
    setModalOpen(true);
  };

  const openEdit = (call: ParentCall, mode: ModalMode = 'edit', focusPhone = false) => {
    const parsed = parseMeetingSchedule(call.meetingSchedule, call.meetingDate, call.meetingTime);
    setModalMode(mode);
    setEditingId(call.id);
    setEditingBaseRecord(call);
    setEditLockNotice(null);
    setFormError(focusPhone ? 'Lengkapi nomor HP / WhatsApp orang tua terlebih dahulu.' : null);
    setFocusPhoneOnOpen(focusPhone);
    setForm({
      letterNumber: call.letterNumber || '',
      studentId: call.studentId,
      studentName: call.studentName,
      className: call.className,
      parentName: call.parentName,
      parentPhone: call.parentPhone || '',
      callDate: call.callDate,
      meetingDate: parsed.date,
      meetingTime: parsed.time || (parsed.date ? '09:00' : ''),
      meetingSchedule: call.meetingSchedule || '',
      reason: call.reason,
      relatedCaseId: call.relatedCaseId || '',
      previousCallId: call.previousCallId || '',
      meetingResult: call.meetingResult || '',
      agreement: call.agreement || '',
      followUpNote: call.followUpNote || '',
      status:
        mode === 'result' &&
        (call.status === 'Sudah dijadwalkan' ||
          call.status === 'Sudah dipanggil' ||
          call.status === 'Belum dijadwalkan')
          ? 'Hadir'
          : call.status,
    });
    setModalOpen(true);
    void acquireRecordLock('parentCalls', call.id).then((res) => {
      if (res.lockedByOther) {
        setEditLockNotice(
          `Catatan ini sedang disunting oleh ${res.lockOwnerName}. Perubahan Anda tetap dapat disimpan dan akan digabungkan otomatis per kolom.`
        );
      }
    });
  };

  const openReschedule = (call: ParentCall) => {
    const today = getTodayISO();
    const cleanBaseReason = call.reason.replace(/\s*\(Pemanggilan lanjutan.*\)$/i, '').trim();
    setModalMode('reschedule');
    setEditingId(null);
    setEditingBaseRecord(null);
    setEditLockNotice(null);
    setFormError(null);
    setForm({
      letterNumber: nextLetterNumber(today),
      studentId: call.studentId,
      studentName: call.studentName,
      className: call.className,
      parentName: call.parentName,
      parentPhone: call.parentPhone || '',
      callDate: today,
      meetingDate: addDaysISO(today, 1),
      meetingTime: '09:00',
      meetingSchedule: '',
      reason: `${cleanBaseReason} (Pemanggilan lanjutan setelah surat ${call.letterNumber || formatDateShort(call.callDate)})`,
      relatedCaseId: call.relatedCaseId || '',
      previousCallId: call.id,
      meetingResult: '',
      agreement: '',
      followUpNote: '',
      status: 'Sudah dijadwalkan',
    });
    setModalOpen(true);
  };

  const closeModal = () => {
    if (editingId) {
      void releaseRecordLock('parentCalls', editingId);
    }
    setModalOpen(false);
    setEditingBaseRecord(null);
    setEditLockNotice(null);
  };

  const handleStudentSelect = (studentId: string) => {
    const stu = students.find((s) => s.id === studentId);
    if (!stu) {
      setForm((prev) => ({ ...prev, studentId: '', studentName: '', className: '' }));
      return;
    }
    setForm((prev) => ({
      ...prev,
      studentId: stu.id,
      studentName: stu.fullName,
      className: stu.className,
      parentName: stu.fatherName || stu.motherName || stu.guardianName || prev.parentName,
      parentPhone: stu.parentPhone || prev.parentPhone,
    }));
  };

  const appendTemplateText = (field: 'reason' | 'agreement', snippet: string) => {
    setForm((prev) => {
      const current = prev[field].trim();
      if (!current) return { ...prev, [field]: snippet };
      if (current.toLowerCase().includes(snippet.toLowerCase())) return prev;
      return { ...prev, [field]: `${current}; ${snippet}` };
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.studentId) {
      setFormError('Pilih siswa terlebih dahulu.');
      return;
    }
    if (!form.parentName.trim()) {
      setFormError('Nama orang tua / wali wajib diisi.');
      return;
    }
    if (!form.reason.trim()) {
      setFormError('Alasan pemanggilan wajib diisi.');
      return;
    }

    setFormError(null);
    setSaving(true);
    try {
      const formattedSchedule = formatMeetingScheduleText(
        form.meetingDate,
        form.meetingTime,
        form.meetingDate ? '' : form.meetingSchedule
      );
      const nextStatus: ParentCallStatus =
        !form.meetingDate && form.status === 'Sudah dijadwalkan'
          ? 'Belum dijadwalkan'
          : form.status;

      await saveParentCall(
        {
          id: editingId || undefined,
          letterNumber: form.letterNumber.trim(),
          studentId: form.studentId,
          studentName: form.studentName,
          className: form.className,
          parentName: form.parentName.trim(),
          parentPhone: form.parentPhone.trim(),
          callDate: form.callDate,
          meetingDate: form.meetingDate || '',
          meetingTime: form.meetingTime || '',
          meetingSchedule: formattedSchedule,
          reason: form.reason.trim(),
          relatedCaseId: form.relatedCaseId || '',
          previousCallId: form.previousCallId || '',
          meetingResult: form.meetingResult.trim(),
          agreement: form.agreement.trim(),
          followUpNote: form.followUpNote.trim(),
          status: nextStatus,
        },
        editingBaseRecord || undefined
      );

      setModalOpen(false);
      setEditingBaseRecord(null);
      setEditLockNotice(null);
      setFeedbackNotice(
        form.meetingDate
          ? isParentCallCompleted(nextStatus)
            ? `Pemanggilan ${form.studentName} ditandai selesai dan agenda Jadwal BK diperbarui.`
            : `Pemanggilan ${form.studentName} tersimpan dan disinkronkan ke Jadwal BK.`
          : `Data pemanggilan ${form.studentName} berhasil disimpan.`
      );
    } catch (err) {
      setFormError(
        err instanceof Error && !err.message.startsWith('{')
          ? err.message
          : 'Gagal menyimpan data pemanggilan orang tua. Periksa koneksi atau izin akses Anda.'
      );
    } finally {
      setSaving(false);
    }
  };

  const formattedPreviewSchedule = useMemo(
    () => formatMeetingScheduleText(form.meetingDate, form.meetingTime, form.meetingSchedule),
    [form.meetingDate, form.meetingTime, form.meetingSchedule]
  );

  const hasReminders =
    attentionSummary.todayCalls.length > 0 ||
    attentionSummary.tomorrowCalls.length > 0 ||
    attentionSummary.overdueCalls.length > 0 ||
    attentionSummary.rescheduleCalls.length > 0 ||
    attentionSummary.unscheduledCalls.length > 0;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900">Pemanggilan Orang Tua / Wali</h1>
          <p className="text-sm text-slate-600 mt-1">
            Pengingat otomatis, antrean siswa prioritas, undangan WhatsApp &amp; PDF, serta sinkron
            ke Jadwal BK
          </p>
        </div>
        <button
          type="button"
          onClick={openAdd}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-[#1E3A5F] hover:bg-[#162C49] rounded-lg self-start sm:self-auto whitespace-nowrap shrink-0"
        >
          <Plus className="w-4 h-4" /> Buat Pemanggilan Baru
        </button>
      </div>

      {/* Inline Save Feedback */}
      {feedbackNotice && (
        <div
          role="status"
          className="flex items-center justify-between gap-3 px-4 py-3 bg-emerald-50 border border-emerald-200 rounded-xl text-sm text-emerald-900"
        >
          <div className="flex items-center gap-2 font-medium">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{feedbackNotice}</span>
          </div>
          <button
            type="button"
            aria-label="Tutup pemberitahuan"
            onClick={() => setFeedbackNotice(null)}
            className="text-emerald-700 hover:text-emerald-900 p-0.5"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Priority Reminder Banner */}
      {hasReminders && (
        <section
          aria-label="Pengingat Prioritas Pemanggilan"
          className="bg-white border border-amber-200 rounded-xl p-4 space-y-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <BellRing className="w-4 h-4 text-amber-600 shrink-0" />
              <h2 className="text-base font-bold text-slate-900">
                Pengingat Jadwal &amp; Tindak Lanjut Hari Ini
              </h2>
            </div>
            <span className="text-xs font-mono tabular-nums text-amber-800 font-medium">
              {attentionSummary.todayCalls.length +
                attentionSummary.tomorrowCalls.length +
                attentionSummary.overdueCalls.length +
                attentionSummary.rescheduleCalls.length +
                attentionSummary.unscheduledCalls.length}{' '}
              agenda perlu perhatian
            </span>
          </div>

          <div className="divide-y divide-slate-100 border-t border-slate-100">
            {attentionSummary.overdueCalls.map((call) => {
              const parsed = parseMeetingSchedule(
                call.meetingSchedule,
                call.meetingDate,
                call.meetingTime
              );
              return (
                <div
                  key={`rem-over-${call.id}`}
                  className="py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
                >
                  <div className="flex items-start gap-2.5 min-w-0">
                    <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <span className="font-semibold text-red-700">Terlewat</span>
                      <span className="text-slate-400 mx-1.5">·</span>
                      <span className="font-semibold text-slate-900">
                        {call.studentName} ({call.className})
                      </span>
                      <span className="text-slate-400 mx-1.5">·</span>
                      <span className="text-slate-600 font-mono">
                        Jadwal {formatDateShort(parsed.date)} belum diisi hasilnya
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => openEdit(call, 'result')}
                      className="px-2.5 py-1.5 font-semibold text-white bg-red-600 hover:bg-red-700 rounded-md whitespace-nowrap"
                    >
                      Catat Hasil
                    </button>
                  </div>
                </div>
              );
            })}

            {attentionSummary.rescheduleCalls.map((call) => (
              <div
                key={`rem-resc-${call.id}`}
                className="py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
              >
                <div className="flex items-start gap-2.5 min-w-0">
                  <RefreshCw className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <span className="font-semibold text-red-700">{call.status}</span>
                    <span className="text-slate-400 mx-1.5">·</span>
                    <span className="font-semibold text-slate-900">
                      {call.studentName} ({call.className})
                    </span>
                    <span className="text-slate-400 mx-1.5">·</span>
                    <span className="text-slate-600">Wali {call.parentName}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => openReschedule(call)}
                    className="px-2.5 py-1.5 font-semibold text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 rounded-md whitespace-nowrap"
                  >
                    Panggil Ulang
                  </button>
                </div>
              </div>
            ))}

            {attentionSummary.todayCalls.map((call) => {
              const parsed = parseMeetingSchedule(
                call.meetingSchedule,
                call.meetingDate,
                call.meetingTime
              );
              const waUrl = buildParentCallWhatsAppUrl(call, settings.schoolName);
              return (
                <div
                  key={`rem-today-${call.id}`}
                  className="py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
                >
                  <div className="flex items-start gap-2.5 min-w-0">
                    <Clock className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <span className="font-semibold text-amber-800">
                        Hari Ini{parsed.time ? ` (${parsed.time} WIB)` : ''}
                      </span>
                      <span className="text-slate-400 mx-1.5">·</span>
                      <span className="font-semibold text-slate-900">
                        {call.studentName} ({call.className})
                      </span>
                      <span className="text-slate-400 mx-1.5">·</span>
                      <span className="text-slate-600">Wali {call.parentName}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {waUrl && (
                      <a
                        href={waUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-md whitespace-nowrap"
                      >
                        <MessageCircle className="w-3.5 h-3.5" /> WA
                      </a>
                    )}
                    <button
                      type="button"
                      onClick={() => openEdit(call, 'result')}
                      className="px-2.5 py-1.5 font-semibold text-white bg-[#1E3A5F] hover:bg-[#162C49] rounded-md whitespace-nowrap"
                    >
                      Catat Hasil
                    </button>
                  </div>
                </div>
              );
            })}

            {attentionSummary.tomorrowCalls.map((call) => {
              const parsed = parseMeetingSchedule(
                call.meetingSchedule,
                call.meetingDate,
                call.meetingTime
              );
              const waUrl = buildParentCallWhatsAppUrl(call, settings.schoolName);
              return (
                <div
                  key={`rem-tmrw-${call.id}`}
                  className="py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
                >
                  <div className="flex items-start gap-2.5 min-w-0">
                    <CalendarClock className="w-4 h-4 text-sky-700 shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <span className="font-semibold text-sky-800">
                        Besok{parsed.time ? ` (${parsed.time} WIB)` : ''}
                      </span>
                      <span className="text-slate-400 mx-1.5">·</span>
                      <span className="font-semibold text-slate-900">
                        {call.studentName} ({call.className})
                      </span>
                      <span className="text-slate-400 mx-1.5">·</span>
                      <span className="text-slate-600">Pastikan undangan WA sudah dikirim</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {waUrl ? (
                      <a
                        href={waUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-md whitespace-nowrap"
                      >
                        <MessageCircle className="w-3.5 h-3.5" /> Kirim WA
                      </a>
                    ) : (
                      <button
                        type="button"
                        onClick={() => openEdit(call, 'edit', true)}
                        className="px-2.5 py-1.5 font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md whitespace-nowrap"
                      >
                        Lengkapi No. HP
                      </button>
                    )}
                  </div>
                </div>
              );
            })}

            {attentionSummary.unscheduledCalls.map((call) => (
              <div
                key={`rem-unsch-${call.id}`}
                className="py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
              >
                <div className="flex items-start gap-2.5 min-w-0">
                  <CalendarClock className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <span className="font-semibold text-amber-800">Belum Dijadwalkan</span>
                    <span className="text-slate-400 mx-1.5">·</span>
                    <span className="font-semibold text-slate-900">
                      {call.studentName} ({call.className})
                    </span>
                    <span className="text-slate-400 mx-1.5">·</span>
                    <span className="text-slate-600">Tentukan tanggal &amp; jam pertemuan</span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => openEdit(call, 'edit')}
                  className="px-2.5 py-1.5 font-semibold text-amber-900 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-md whitespace-nowrap self-start sm:self-auto"
                >
                  Atur Jadwal
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Automatic Queue: Students Needing Parent Call */}
      {attentionSummary.queue.length > 0 && (
        <section
          aria-label="Antrean Siswa Perlu Dipanggil"
          className="bg-white border border-slate-200 rounded-xl p-4 space-y-3"
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-slate-900">
                Siswa Perlu Dipanggil ({attentionSummary.queue.length})
              </h2>
              <p className="text-sm text-slate-500 mt-0.5">
                Terdeteksi otomatis melewati batas kasus atau absensi sekolah dan belum memiliki
                pemanggilan aktif
              </p>
            </div>
            <button
              type="button"
              onClick={() => setQueueExpanded((v) => !v)}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg whitespace-nowrap shrink-0"
            >
              {queueExpanded ? (
                <>
                  Sembunyikan <ChevronUp className="w-3.5 h-3.5" />
                </>
              ) : (
                <>
                  Tampilkan <ChevronDown className="w-3.5 h-3.5" />
                </>
              )}
            </button>
          </div>

          {queueExpanded && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 pt-1">
              {attentionSummary.queue.map((item) => {
                const guardian =
                  item.student.fatherName ||
                  item.student.motherName ||
                  item.student.guardianName ||
                  'Orang Tua/Wali';
                return (
                  <div
                    key={item.student.id}
                    className="p-3.5 bg-slate-50/70 border border-slate-200 rounded-lg flex flex-col justify-between gap-3"
                  >
                    <div className="space-y-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <div className="text-sm font-bold text-slate-900 truncate">
                          {item.student.fullName}
                        </div>
                        <span className="text-xs font-mono text-slate-500 shrink-0">
                          Kelas {item.student.className}
                        </span>
                      </div>
                      <div className="text-sm text-red-700 font-medium">
                        {item.reasons.join(' · ')}
                      </div>
                      <div className="text-xs text-slate-500">
                        Wali: {guardian}
                        {item.student.parentPhone ? (
                          <>
                            {' · '}
                            <span className="font-mono">{item.student.parentPhone}</span>
                          </>
                        ) : (
                          ' · No. HP belum diisi'
                        )}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => openFromQueue(item)}
                      className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-semibold text-white bg-[#1E3A5F] hover:bg-[#162C49] rounded-lg whitespace-nowrap"
                    >
                      <Plus className="w-4 h-4" /> Buat Panggilan
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* 4 Stage Filter Tabs + Search */}
      <div className="bg-white border border-slate-200 rounded-xl p-3 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div
          className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto"
          role="tablist"
          aria-label="Filter tahap pemanggilan orang tua"
        >
          {(
            [
              { id: 'all', label: 'Semua', count: stageCounts.all },
              { id: 'waiting', label: 'Menunggu Kedatangan', count: stageCounts.waiting },
              { id: 'followup', label: 'Perlu Tindak Lanjut', count: stageCounts.followup },
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

        <div className="relative w-full lg:w-72">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Cari siswa, kelas, nomor surat, wali..."
            aria-label="Cari data pemanggilan orang tua"
            className="w-full pl-9 pr-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:bg-white focus:border-sky-600"
          />
        </div>
      </div>

      {/* Main Data Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 text-xs">
              <tr>
                <th className="px-4 py-3 font-semibold whitespace-nowrap">No. Surat &amp; Tanggal</th>
                <th className="px-4 py-3 font-semibold whitespace-nowrap">Siswa &amp; Orang Tua</th>
                <th className="px-4 py-3 font-semibold">Jadwal &amp; Alasan</th>
                <th className="px-4 py-3 font-semibold whitespace-nowrap">Status</th>
                <th className="px-4 py-3 font-semibold text-right whitespace-nowrap">Aksi Cepat</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredCalls.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-slate-400">
                    {parentCalls.length === 0
                      ? 'Belum ada data pemanggilan orang tua. Klik "Buat Pemanggilan Baru" atau pilih siswa dari daftar antrean di atas.'
                      : 'Tidak ada data pemanggilan yang sesuai dengan filter atau pencarian ini.'}
                  </td>
                </tr>
              ) : (
                filteredCalls.map((call) => {
                  const bucket = getParentCallReminderBucket(call, todayISO);
                  const waUrl = buildParentCallWhatsAppUrl(call, settings.schoolName);
                  const needsReschedule =
                    call.status === 'Tidak hadir' || call.status === 'Perlu pemanggilan ulang';
                  const isDone = isParentCallCompleted(call.status);

                  return (
                    <tr key={call.id} className="hover:bg-slate-50/70 align-top">
                      <td className="px-4 py-3 font-mono whitespace-nowrap tabular-nums">
                        <div className="font-semibold text-slate-900">
                          {call.letterNumber || '-'}
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5">
                          Surat: {formatDateShort(call.callDate)}
                        </div>
                      </td>

                      <td className="px-4 py-3 min-w-[180px]">
                        <div className="font-semibold text-slate-900">
                          {call.studentName} ({call.className})
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5">
                          Wali: {call.parentName}
                          {call.parentPhone ? (
                            <>
                              {' · '}
                              <span className="font-mono">{call.parentPhone}</span>
                            </>
                          ) : (
                            ' · No. HP kosong'
                          )}
                        </div>
                      </td>

                      <td className="px-4 py-3 min-w-[230px] max-w-md">
                        <div className="flex flex-wrap items-center gap-1.5 font-mono text-xs text-sky-900 font-semibold">
                          <span className="whitespace-nowrap">
                            {call.meetingSchedule || 'Belum dijadwalkan'}
                          </span>
                          {bucket === 'today' && (
                            <span className="font-sans px-1.5 py-0.5 text-xs font-semibold bg-amber-50 text-amber-800 border border-amber-200 rounded">
                              Hari Ini
                            </span>
                          )}
                          {bucket === 'tomorrow' && (
                            <span className="font-sans px-1.5 py-0.5 text-xs font-semibold bg-sky-50 text-sky-800 border border-sky-200 rounded">
                              Besok
                            </span>
                          )}
                          {bucket === 'overdue' && (
                            <span className="font-sans px-1.5 py-0.5 text-xs font-semibold bg-red-50 text-red-700 border border-red-200 rounded">
                              Terlewat · Belum ada hasil
                            </span>
                          )}
                        </div>
                        <div className="text-slate-600 line-clamp-2 mt-1">{call.reason}</div>
                        {call.agreement && (
                          <div className="text-xs text-emerald-700 mt-1 line-clamp-1">
                            Kesepakatan: {call.agreement}
                          </div>
                        )}
                      </td>

                      <td className="px-4 py-3 whitespace-nowrap">
                        <span
                          className={`inline-flex px-2 py-0.5 rounded border text-xs font-semibold ${getStatusBadgeStyle(
                            call.status
                          )}`}
                        >
                          {call.status}
                        </span>
                      </td>

                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <div className="inline-flex flex-wrap items-center justify-end gap-1.5">
                          {waUrl ? (
                            <a
                              href={waUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              aria-label={`Kirim WhatsApp ke orang tua ${call.studentName}`}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-md whitespace-nowrap"
                            >
                              <MessageCircle className="w-3.5 h-3.5" /> Kirim WA
                            </a>
                          ) : (
                            <button
                              type="button"
                              onClick={() => openEdit(call, 'edit', true)}
                              title="Isi nomor HP untuk mengirim undangan WA"
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-500 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-md whitespace-nowrap"
                            >
                              <MessageCircle className="w-3.5 h-3.5" /> Isi No. WA
                            </button>
                          )}

                          {!isDone && (
                            <button
                              type="button"
                              onClick={() => openEdit(call, 'result')}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-[#1E3A5F] bg-sky-50 hover:bg-sky-100 border border-sky-200 rounded-md whitespace-nowrap"
                            >
                              <UserCheck className="w-3.5 h-3.5" /> Catat Hasil
                            </button>
                          )}

                          {needsReschedule && (
                            <button
                              type="button"
                              onClick={() => openReschedule(call)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 rounded-md whitespace-nowrap"
                            >
                              <RefreshCw className="w-3.5 h-3.5" /> Panggil Ulang
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() =>
                              exportParentCallLetterPDF(call, settings, {
                                counselorName: currentUser?.name,
                              })
                            }
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md whitespace-nowrap"
                          >
                            <Printer className="w-3.5 h-3.5" /> Cetak Surat
                          </button>

                          <button
                            type="button"
                            aria-label={`Edit pemanggilan ${call.studentName}`}
                            onClick={() => openEdit(call, 'edit')}
                            className="p-1.5 text-slate-600 hover:text-slate-900 rounded-md"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>

                          {canDeleteRecords && (
                            <button
                              type="button"
                              aria-label={`Hapus pemanggilan ${call.studentName}`}
                              onClick={() => setDeleteTarget(call)}
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

      {/* Structured 2-Section Add/Edit/Result Modal */}
      {modalOpen && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4 overflow-y-auto"
          {...modalBackdropProps}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="parent-call-modal-title"
            className="bg-white border border-slate-200 rounded-xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden"
          >
            <div className="px-6 py-4 border-b border-slate-200 flex items-start justify-between gap-3">
              <div>
                <h2 id="parent-call-modal-title" className="text-lg font-bold text-slate-900">
                  {modalMode === 'result'
                    ? `Catat Kehadiran & Hasil Pertemuan — ${form.studentName}`
                    : modalMode === 'reschedule'
                      ? `Panggil Ulang Orang Tua — ${form.studentName}`
                      : editingId
                        ? 'Edit Pemanggilan Orang Tua'
                        : 'Buat Pemanggilan Orang Tua Baru'}
                </h2>
                <p className="text-sm text-slate-500 mt-0.5">
                  Jadwal dengan tanggal otomatis masuk ke menu Jadwal BK
                </p>
              </div>
              <button
                type="button"
                aria-label="Tutup form"
                title="Keluar"
                onClick={closeModal}
                className="p-1.5 text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 overflow-y-auto space-y-5 text-sm">
              {editLockNotice && (
                <div
                  role="alert"
                  className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-900 font-medium flex items-start gap-2"
                >
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <span>{editLockNotice}</span>
                </div>
              )}

              {formError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 font-medium">
                  {formError}
                </div>
              )}

              {/* Bagian A: Identitas & Jadwal Surat */}
              <div className="space-y-4">
                <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                  <h3 className="text-base font-bold text-slate-800">
                    Bagian A. Identitas Siswa, Surat &amp; Jadwal Pertemuan
                  </h3>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">
                      Nomor Surat Resmi
                    </label>
                    <input
                      value={form.letterNumber}
                      onChange={(e) => setForm({ ...form, letterNumber: e.target.value })}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg font-mono"
                    />
                  </div>
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">Pilih Siswa *</label>
                    <select
                      required
                      value={form.studentId}
                      onChange={(e) => handleStudentSelect(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg bg-white"
                    >
                      <option value="">-- Pilih Siswa --</option>
                      {students.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.fullName} ({s.className})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">
                      Nama Orang Tua / Wali *
                    </label>
                    <input
                      required
                      value={form.parentName}
                      onChange={(e) => setForm({ ...form, parentName: e.target.value })}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">
                      Nomor HP / WhatsApp Orang Tua
                    </label>
                    <input
                      ref={phoneInputRef}
                      placeholder="Contoh: 081234567890"
                      value={form.parentPhone}
                      onChange={(e) => setForm({ ...form, parentPhone: e.target.value })}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg font-mono"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">Tanggal Surat</label>
                    <input
                      type="date"
                      value={form.callDate}
                      onChange={(e) => setForm({ ...form, callDate: e.target.value })}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">
                      Tanggal Pertemuan
                    </label>
                    <input
                      type="date"
                      value={form.meetingDate}
                      onChange={(e) => setForm({ ...form, meetingDate: e.target.value })}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">Jam Pertemuan</label>
                    <input
                      type="time"
                      value={form.meetingTime}
                      onChange={(e) => setForm({ ...form, meetingTime: e.target.value })}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">Status</label>
                    <select
                      value={form.status}
                      onChange={(e) =>
                        setForm({ ...form, status: e.target.value as ParentCallStatus })
                      }
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg bg-white"
                    >
                      {CALL_STATUSES.map((st) => (
                        <option key={st} value={st}>
                          {st}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="text-xs text-slate-500">
                  Tampilan jadwal di surat &amp; WA:{' '}
                  <span className="font-semibold text-slate-800">{formattedPreviewSchedule}</span>
                </div>

                <div className="space-y-1.5">
                  <label className="block font-medium text-slate-700">Alasan Pemanggilan *</label>
                  <div className="flex flex-wrap gap-1.5">
                    {PARENT_CALL_REASON_TEMPLATES.map((tpl) => (
                      <button
                        key={tpl}
                        type="button"
                        onClick={() => appendTemplateText('reason', tpl)}
                        className="px-2.5 py-1 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors text-left"
                      >
                        + {tpl}
                      </button>
                    ))}
                  </div>
                  <textarea
                    required
                    rows={2}
                    placeholder="Tuliskan atau pilih template alasan pemanggilan..."
                    value={form.reason}
                    onChange={(e) => setForm({ ...form, reason: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg"
                  />
                </div>
              </div>

              {/* Bagian B: Hasil Pertemuan & Kesepakatan */}
              <div
                className={`space-y-4 pt-4 border-t border-slate-200 ${
                  modalMode === 'result' ? 'bg-sky-50/50 -mx-6 px-6 py-4 border-y border-sky-200' : ''
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-base font-bold text-slate-800 inline-flex items-center gap-1.5">
                    <ClipboardCheck className="w-4 h-4 text-[#1E3A5F]" />
                    Bagian B. Kehadiran, Hasil Pertemuan &amp; Kesepakatan
                  </h3>
                  <span className="text-xs text-slate-500">
                    Diisi setelah pertemuan berlangsung
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">
                      Hasil Pertemuan
                    </label>
                    <textarea
                      ref={resultInputRef}
                      rows={3}
                      placeholder="Ringkasan pembicaraan bersama orang tua/wali..."
                      value={form.meetingResult}
                      onChange={(e) => setForm({ ...form, meetingResult: e.target.value })}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg bg-white"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="block font-medium text-slate-700">
                      Kesepakatan Sekolah &amp; Ortu
                    </label>
                    <textarea
                      rows={3}
                      placeholder="Tindak lanjut & komitmen bersama..."
                      value={form.agreement}
                      onChange={(e) => setForm({ ...form, agreement: e.target.value })}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg bg-white"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <span className="block text-xs font-medium text-slate-600">
                    Pilihan Cepat Kesepakatan:
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {PARENT_CALL_AGREEMENT_TEMPLATES.map((tpl) => (
                      <button
                        key={tpl}
                        type="button"
                        onClick={() => appendTemplateText('agreement', tpl)}
                        className="px-2.5 py-1 text-xs font-medium text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 rounded-md transition-colors text-left"
                      >
                        + {tpl}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={closeModal}
                  className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 text-sm font-semibold text-white bg-[#1E3A5F] hover:bg-[#162C49] rounded-lg disabled:opacity-60"
                >
                  {saving ? 'Menyimpan...' : 'Simpan Pemanggilan'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmDeleteModal
        open={Boolean(deleteTarget)}
        title="Hapus Data Pemanggilan Orang Tua?"
        itemName={
          deleteTarget
            ? `${deleteTarget.studentName} (${deleteTarget.className}) — ${deleteTarget.letterNumber || formatDateShort(deleteTarget.callDate)}`
            : undefined
        }
        description="Data pemanggilan orang tua dan jadwal BK yang tersinkron akan dihapus permanen. Lanjutkan?"
        onCancel={() => setDeleteTarget(null)}
        onConfirm={async () => {
          if (!deleteTarget) return;
          try {
            await deleteParentCall(deleteTarget.id);
            setDeleteTarget(null);
            setFeedbackNotice('Data pemanggilan orang tua berhasil dihapus.');
          } catch (err) {
            setDeleteTarget(null);
            setErrorToast(
              err instanceof Error && !err.message.startsWith('{')
                ? err.message
                : 'Gagal menghapus data pemanggilan orang tua. Periksa koneksi atau izin akses Anda.'
            );
          }
        }}
      />

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
