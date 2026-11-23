import React, { useMemo, useRef, useState } from 'react';
import {
  CalendarPlus,
  ClipboardPlus,
  Pencil,
  PhoneCall,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  User,
  Users,
  X,
} from 'lucide-react';
import { useSibk } from '../context/SibkContext';
import type { MonitoringNote, MonitoringStatus, ProgressLevel, Student } from '../types/sibk';
import { formatDateShort, getTodayISO } from '../utils/sibkLogic';
import {
  appendMonitoringObservationTemplate,
  buildMonitoringStudentSummaries,
  computeMonitoringTabCounts,
  filterMonitoringStudents,
  getEligibleStudentsForManualMonitoring,
  getMonitoringStatusBadgeClass,
  getMonitoringTrendBadgeClass,
  getMonitoringTrendButtonClass,
  MONITORING_OBSERVATION_TEMPLATES,
  MONITORING_STATUS_OPTIONS,
  MONITORING_TREND_OPTIONS,
  type MonitoringTabFilter,
} from '../utils/monitoringLogic';
import { ConfirmDeleteModal } from '../components/ConfirmDeleteModal';
import { useModalScrollLock } from '../utils/useModalScrollLock';
import { useModalDismiss } from '../utils/useModalDismiss';

interface MonitoringViewProps {
  onSelectStudent: (student: Student) => void;
  onAddCaseForStudent?: (student: Student) => void;
  onCreateParentCallForStudent?: (student: Student, reasons: string[]) => void;
  onScheduleForStudent?: (student: Student) => void;
}

const MANUAL_MONITORING_STATUSES: MonitoringStatus[] = [
  'Perlu Perhatian',
  'Dalam Pemantauan',
  'Prioritas Tinggi',
];

export const MonitoringView: React.FC<MonitoringViewProps> = ({
  onSelectStudent,
  onAddCaseForStudent,
  onCreateParentCallForStudent,
  onScheduleForStudent,
}) => {
  const {
    classes,
    students,
    attendance,
    cases,
    monitoringNotes,
    settings,
    currentUser,
    addMonitoringNote,
    updateMonitoringNote,
    deleteMonitoringNote,
    updateStudentMonitoringStatus,
  } = useSibk();

  // Filter & Selection State
  const [tabFilter, setTabFilter] = useState<MonitoringTabFilter>('all');
  const [selectedClassId, setSelectedClassId] = useState<string>('all');
  const [studentSearch, setStudentSearch] = useState<string>('');
  const [selectedStudentId, setSelectedStudentId] = useState<string>('');

  // Quick Add Observation Form State
  const [noteDate, setNoteDate] = useState(getTodayISO());
  const [progressLevel, setProgressLevel] = useState<ProgressLevel>('Stabil');
  const [observation, setObservation] = useState('');
  const [savingNote, setSavingNote] = useState(false);

  // Manual Add Normal Student Modal State
  const [addStudentModalOpen, setAddStudentModalOpen] = useState(false);
  const [manualClassFilter, setManualClassFilter] = useState<string>('all');
  const [manualSearch, setManualSearch] = useState('');
  const [manualTargetStudentId, setManualTargetStudentId] = useState('');
  const [manualInitialStatus, setManualInitialStatus] =
    useState<MonitoringStatus>('Dalam Pemantauan');
  const [savingManualStudent, setSavingManualStudent] = useState(false);

  // Edit Note Modal & Delete Confirmation State
  const [editingNote, setEditingNote] = useState<MonitoringNote | null>(null);
  const [editDate, setEditDate] = useState(getTodayISO());
  const [editProgressLevel, setEditProgressLevel] = useState<ProgressLevel>('Stabil');
  const [editObservation, setEditObservation] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [deleteTargetNote, setDeleteTargetNote] = useState<MonitoringNote | null>(null);

  // Feedback Toast Banner
  const [feedback, setFeedback] = useState('');
  const feedbackTimerRef = useRef<number | null>(null);

  const isAnyModalOpen =
    addStudentModalOpen || Boolean(editingNote) || Boolean(deleteTargetNote);
  useModalScrollLock(isAnyModalOpen);

  const addStudentBackdropProps = useModalDismiss({
    open: addStudentModalOpen,
    onClose: () => setAddStudentModalOpen(false),
    disabled: savingManualStudent,
  });
  const editNoteBackdropProps = useModalDismiss({
    open: Boolean(editingNote),
    onClose: () => setEditingNote(null),
    disabled: savingEdit,
  });

  const showToast = (msg: string) => {
    setFeedback(msg);
    if (feedbackTimerRef.current) {
      window.clearTimeout(feedbackTimerRef.current);
    }
    feedbackTimerRef.current = window.setTimeout(() => setFeedback(''), 4000);
  };

  const activeClasses = useMemo(() => classes.filter((c) => !c.archived), [classes]);

  const summaries = useMemo(
    () =>
      buildMonitoringStudentSummaries({
        students,
        attendance,
        cases,
        monitoringNotes,
        settings,
      }),
    [students, attendance, cases, monitoringNotes, settings]
  );

  const tabCounts = useMemo(() => computeMonitoringTabCounts(summaries), [summaries]);

  const monitoredStudentIds = useMemo(
    () => new Set(summaries.map((item) => item.student.id)),
    [summaries]
  );

  const filteredSummaries = useMemo(
    () =>
      filterMonitoringStudents(summaries, {
        tab: tabFilter,
        classId: selectedClassId,
        search: studentSearch,
      }),
    [summaries, tabFilter, selectedClassId, studentSearch]
  );

  const selectedItem =
    filteredSummaries.find((x) => x.student.id === selectedStudentId) || filteredSummaries[0];

  const selectedNotes = useMemo(() => {
    if (!selectedItem) return [];
    return monitoringNotes
      .filter((n) => n.studentId === selectedItem.student.id)
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [monitoringNotes, selectedItem]);

  const eligibleNormalStudents = useMemo(
    () =>
      getEligibleStudentsForManualMonitoring(students, monitoredStudentIds, {
        classId: manualClassFilter,
        search: manualSearch,
      }),
    [students, monitoredStudentIds, manualClassFilter, manualSearch]
  );

  const hasActiveFilter =
    tabFilter !== 'all' || selectedClassId !== 'all' || studentSearch.trim() !== '';

  const resetFilters = () => {
    setTabFilter('all');
    setSelectedClassId('all');
    setStudentSearch('');
  };

  const handleStatusChange = async (student: Student, nextStatus: MonitoringStatus) => {
    await updateStudentMonitoringStatus(student.id, nextStatus);
    showToast(`Status pemantauan ${student.fullName} diperbarui menjadi "${nextStatus}".`);
  };

  const handleAddNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedItem || !observation.trim() || savingNote) return;
    setSavingNote(true);
    try {
      await addMonitoringNote({
        studentId: selectedItem.student.id,
        date: noteDate,
        counselorName: currentUser?.name || 'Guru BK',
        observation: observation.trim(),
        progressLevel,
      });
      setObservation('');
      showToast(`Catatan perkembangan ${selectedItem.student.fullName} berhasil disimpan.`);
    } finally {
      setSavingNote(false);
    }
  };

  const openAddStudentModal = () => {
    setManualClassFilter('all');
    setManualSearch('');
    setManualTargetStudentId('');
    setManualInitialStatus('Dalam Pemantauan');
    setAddStudentModalOpen(true);
  };

  const handleAddStudentToMonitoring = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetId = manualTargetStudentId || eligibleNormalStudents[0]?.id || '';
    if (!targetId || savingManualStudent) return;
    const stu = students.find((s) => s.id === targetId);
    if (!stu) return;

    setSavingManualStudent(true);
    try {
      await updateStudentMonitoringStatus(stu.id, manualInitialStatus);
      setAddStudentModalOpen(false);
      setTabFilter('all');
      setSelectedClassId('all');
      setStudentSearch('');
      setSelectedStudentId(stu.id);
      showToast(`${stu.fullName} ditambahkan ke pemantauan (${manualInitialStatus}).`);
    } finally {
      setSavingManualStudent(false);
    }
  };

  const openEditNoteModal = (note: MonitoringNote) => {
    setEditingNote(note);
    setEditDate(note.date || getTodayISO());
    setEditProgressLevel(note.progressLevel);
    setEditObservation(note.observation);
  };

  const handleSaveEditNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingNote || !editObservation.trim() || savingEdit) return;
    setSavingEdit(true);
    try {
      await updateMonitoringNote(editingNote.id, {
        date: editDate,
        progressLevel: editProgressLevel,
        observation: editObservation.trim(),
      });
      setEditingNote(null);
      showToast('Catatan perkembangan berhasil diperbarui.');
    } finally {
      setSavingEdit(false);
    }
  };

  const handleConfirmDeleteNote = async () => {
    if (!deleteTargetNote) return;
    await deleteMonitoringNote(deleteTargetNote.id);
    setDeleteTargetNote(null);
    showToast('Catatan perkembangan berhasil dihapus.');
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900">Pemantauan Siswa</h1>
          <p className="text-sm text-slate-600 mt-1 font-mono tabular-nums">
            {tabCounts.highPriority} prioritas tinggi · {tabCounts.underMonitoring} dalam
            pemantauan · {tabCounts.unmonitored} belum ada observasi
          </p>
        </div>
        <button
          type="button"
          onClick={openAddStudentModal}
          className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 text-sm font-semibold text-white bg-[#1E3A5F] hover:bg-[#162C49] rounded-lg whitespace-nowrap shrink-0"
        >
          <Users className="w-4 h-4" />
          + Pantau Siswa Lain
        </button>
      </div>

      {/* Inline Feedback Banner */}
      {feedback && (
        <div
          role="status"
          className="p-3.5 rounded-lg bg-emerald-50 border border-emerald-200 text-sm text-emerald-800 flex items-center justify-between gap-2"
        >
          <span>{feedback}</span>
          <button
            type="button"
            aria-label="Tutup notifikasi"
            onClick={() => setFeedback('')}
            className="text-emerald-700 hover:text-emerald-900"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Filter Tabs + Class & Search Controls */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
        <div
          className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto"
          role="tablist"
          aria-label="Filter prioritas pemantauan siswa"
        >
          {(
            [
              { id: 'all', label: 'Semua', count: tabCounts.all },
              {
                id: 'high-priority',
                label: 'Prioritas Tinggi',
                count: tabCounts.highPriority,
              },
              {
                id: 'under-monitoring',
                label: 'Dalam Pemantauan',
                count: tabCounts.underMonitoring,
              },
              {
                id: 'needs-attention',
                label: 'Perlu Perhatian',
                count: tabCounts.needsAttention,
              },
              {
                id: 'unmonitored',
                label: 'Belum Dipantau',
                count: tabCounts.unmonitored,
              },
            ] as const
          ).map((tab) => {
            const active = tabFilter === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setTabFilter(tab.id)}
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

        <div className="flex flex-col sm:flex-row gap-2.5">
          <div className="relative flex-1 min-w-0">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              value={studentSearch}
              onChange={(e) => setStudentSearch(e.target.value)}
              placeholder="Cari nama siswa, NIS, kelas, atau alasan..."
              aria-label="Cari siswa dalam pemantauan"
              className="w-full pl-9 pr-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:bg-white focus:border-sky-600"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              id="monitoring-class-select"
              aria-label="Filter kelas pemantauan"
              value={selectedClassId}
              onChange={(e) => {
                setSelectedClassId(e.target.value);
                setSelectedStudentId('');
              }}
              className="px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:border-sky-600"
            >
              <option value="all">Semua Kelas ({summaries.length})</option>
              {activeClasses.map((cls) => {
                const countInClass = summaries.filter(
                  (x) => x.student.classId === cls.id
                ).length;
                return (
                  <option key={cls.id} value={cls.id}>
                    Kelas {cls.name} ({countInClass})
                  </option>
                );
              })}
            </select>
            {hasActiveFilter && (
              <button
                type="button"
                onClick={resetFilters}
                className="inline-flex items-center gap-1 px-3 py-2 text-sm font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg whitespace-nowrap"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Reset
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Main Split Grid: Attention List + Selected Student Detail */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Panel: Filtered Students List */}
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden self-start">
          <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between gap-2">
            <h2 className="text-sm font-bold text-slate-900">
              Daftar Siswa Dipantau ({filteredSummaries.length})
            </h2>
            <span className="text-xs font-mono tabular-nums text-slate-500">
              {tabCounts.all} total
            </span>
          </div>

          <div className="max-h-[34rem] overflow-y-auto divide-y divide-slate-100">
            {filteredSummaries.length === 0 ? (
              <div className="p-8 text-center space-y-2.5">
                <p className="text-sm text-slate-500">
                  Tidak ada siswa yang sesuai filter saat ini.
                </p>
                {hasActiveFilter ? (
                  <button
                    type="button"
                    onClick={resetFilters}
                    className="inline-flex items-center gap-1 px-3.5 py-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md"
                  >
                    <RotateCcw className="w-4 h-4" /> Reset Filter
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={openAddStudentModal}
                    className="inline-flex items-center gap-1 px-3.5 py-2 text-sm font-semibold text-white bg-[#1E3A5F] hover:bg-[#162C49] rounded-md"
                  >
                    <Users className="w-4 h-4" /> + Pantau Siswa Lain
                  </button>
                )}
              </div>
            ) : (
              filteredSummaries.map((item) => {
                const active = selectedItem?.student.id === item.student.id;
                return (
                  <button
                    key={item.student.id}
                    type="button"
                    onClick={() => setSelectedStudentId(item.student.id)}
                    className={`w-full p-3.5 text-left transition-colors space-y-1.5 ${
                      active ? 'bg-sky-50/80' : 'hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-sm font-bold text-slate-900 truncate">
                          {item.student.fullName}
                        </div>
                        <div className="text-xs font-mono text-slate-500">
                          {item.student.className} · NIS {item.student.nis}
                        </div>
                      </div>
                      <span
                        className={`inline-flex px-2 py-0.5 rounded border text-xs font-semibold shrink-0 ${getMonitoringStatusBadgeClass(
                          item.student.monitoringStatus
                        )}`}
                      >
                        {item.student.monitoringStatus}
                      </span>
                    </div>

                    <div className="text-xs text-slate-600 line-clamp-1">
                      {item.reasons.length > 0
                        ? item.reasons.join(' · ')
                        : 'Masuk daftar pemantauan BK'}
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono tabular-nums text-slate-500">
                      <span>
                        {item.caseCount} kasus · {item.absenceCount} absen
                      </span>
                      <span
                        className={
                          item.isUnmonitored
                            ? 'text-amber-700 font-semibold font-sans'
                            : 'text-slate-600 font-sans'
                        }
                      >
                        {item.isUnmonitored
                          ? 'Belum dipantau'
                          : `${item.notesCount} catatan`}
                      </span>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Right Panel: Student Context Header, Quick Form & Notes Timeline */}
        <div className="lg:col-span-2 bg-white border border-slate-200 rounded-xl p-5 space-y-5 min-w-0">
          {!selectedItem ? (
            <div className="py-14 text-center space-y-3">
              <p className="text-sm text-slate-500">
                Pilih siswa di panel kiri atau tambah siswa baru ke daftar pemantauan.
              </p>
              <button
                type="button"
                onClick={openAddStudentModal}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-[#1E3A5F] hover:bg-[#162C49] rounded-lg"
              >
                <Users className="w-4 h-4" /> + Pantau Siswa Lain
              </button>
            </div>
          ) : (
            <>
              {/* Student Context Header + Cross-Menu Quick Actions */}
              <div className="pb-4 border-b border-slate-200 space-y-3.5">
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => onSelectStudent(selectedItem.student)}
                        className="text-lg font-bold text-slate-900 hover:text-sky-700 text-left"
                      >
                        {selectedItem.student.fullName}
                      </button>
                      <span
                        className={`inline-flex px-2.5 py-0.5 rounded border text-xs font-semibold ${getMonitoringStatusBadgeClass(
                          selectedItem.student.monitoringStatus
                        )}`}
                      >
                        {selectedItem.student.monitoringStatus}
                      </span>
                      {selectedItem.latestProgressLevel && (
                        <span
                          className={`inline-flex px-2.5 py-0.5 rounded border text-xs font-semibold ${getMonitoringTrendBadgeClass(
                            selectedItem.latestProgressLevel
                          )}`}
                        >
                          Tren: {selectedItem.latestProgressLevel}
                        </span>
                      )}
                    </div>

                    <div className="text-sm text-slate-600 font-mono tabular-nums flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span>NIS {selectedItem.student.nis}</span>
                      <span className="text-slate-300">·</span>
                      <span>Kelas {selectedItem.student.className}</span>
                      <span className="text-slate-300">·</span>
                      <span>
                        Observasi terakhir:{' '}
                        {selectedItem.latestNoteDate
                          ? formatDateShort(selectedItem.latestNoteDate)
                          : 'Belum pernah'}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 text-sm shrink-0">
                    <label htmlFor="mon-status" className="text-slate-500 whitespace-nowrap">
                      Status:
                    </label>
                    <select
                      id="mon-status"
                      value={selectedItem.student.monitoringStatus}
                      onChange={(e) =>
                        handleStatusChange(
                          selectedItem.student,
                          e.target.value as MonitoringStatus
                        )
                      }
                      className="px-3 py-1.5 border border-slate-200 rounded-lg bg-white font-medium text-sm"
                    >
                      {MONITORING_STATUS_OPTIONS.map((st) => (
                        <option key={st} value={st}>
                          {st}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Attendance Breakdown + Reasons */}
                <div className="bg-slate-50/70 border border-slate-200 rounded-lg p-3.5 space-y-2 text-sm">
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-slate-700 font-mono tabular-nums">
                    <span>
                      Kasus:{' '}
                      <strong className="font-semibold text-slate-900">
                        {selectedItem.caseCount}
                      </strong>{' '}
                      ({selectedItem.activeCases} aktif)
                    </span>
                    <span className="text-slate-300">·</span>
                    <span>
                      Sakit:{' '}
                      <strong className="font-semibold text-slate-900">
                        {selectedItem.sickCount}
                      </strong>
                    </span>
                    <span>
                      Izin:{' '}
                      <strong className="font-semibold text-slate-900">
                        {selectedItem.permissionCount}
                      </strong>
                    </span>
                    <span>
                      Alpa:{' '}
                      <strong className="font-semibold text-red-700">
                        {selectedItem.alphaCount}
                      </strong>
                    </span>
                  </div>
                  <div className="text-xs text-slate-600">
                    <span className="font-semibold text-slate-700">Alasan perhatian:</span>{' '}
                    {selectedItem.reasons.length > 0
                      ? selectedItem.reasons.join(' · ')
                      : 'Masuk pemantauan manual oleh Guru BK'}
                  </div>
                </div>

                {/* Cross-Menu Quick Actions */}
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onSelectStudent(selectedItem.student)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#1E3A5F] bg-sky-50 hover:bg-sky-100 border border-sky-200 rounded-md whitespace-nowrap"
                  >
                    <User className="w-3.5 h-3.5" />
                    Profil Siswa
                  </button>
                  {onAddCaseForStudent && (
                    <button
                      type="button"
                      onClick={() => onAddCaseForStudent(selectedItem.student)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md whitespace-nowrap"
                    >
                      <ClipboardPlus className="w-3.5 h-3.5" />
                      Catat Kasus
                    </button>
                  )}
                  {onCreateParentCallForStudent && (
                    <button
                      type="button"
                      onClick={() =>
                        onCreateParentCallForStudent(
                          selectedItem.student,
                          selectedItem.reasons
                        )
                      }
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-md whitespace-nowrap"
                    >
                      <PhoneCall className="w-3.5 h-3.5" />
                      Pemanggilan Ortu
                    </button>
                  )}
                  {onScheduleForStudent && (
                    <button
                      type="button"
                      onClick={() => onScheduleForStudent(selectedItem.student)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-md whitespace-nowrap"
                    >
                      <CalendarPlus className="w-3.5 h-3.5" />
                      Jadwalkan di BK
                    </button>
                  )}
                </div>
              </div>

              {/* Add Periodic Development Note Form */}
              <form
                onSubmit={handleAddNote}
                className="space-y-4 text-sm bg-slate-50/60 p-4 rounded-xl border border-slate-200"
              >
                <div className="font-bold text-slate-900 text-base">
                  Tambah Catatan Perkembangan Berkala
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-start">
                  <div>
                    <label
                      htmlFor="mon-note-date"
                      className="block font-medium text-slate-700 mb-1"
                    >
                      Tanggal Observasi
                    </label>
                    <input
                      id="mon-note-date"
                      type="date"
                      required
                      value={noteDate}
                      onChange={(e) => setNoteDate(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg bg-white"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <div className="block font-medium text-slate-700 mb-1">
                      Tren Perkembangan
                    </div>
                    <div
                      className="grid grid-cols-2 sm:grid-cols-4 gap-1.5"
                      role="group"
                      aria-label="Pilih tren perkembangan"
                    >
                      {MONITORING_TREND_OPTIONS.map((level) => {
                        const active = progressLevel === level;
                        return (
                          <button
                            key={level}
                            type="button"
                            aria-pressed={active}
                            onClick={() => setProgressLevel(level)}
                            className={`px-2.5 py-2 text-xs font-semibold border rounded-lg transition-colors text-center ${getMonitoringTrendButtonClass(
                              level,
                              active
                            )}`}
                          >
                            {level}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="mon-observation"
                    className="block font-medium text-slate-700 mb-1"
                  >
                    Catatan Observasi Perilaku *
                  </label>
                  <textarea
                    id="mon-observation"
                    required
                    maxLength={1200}
                    rows={3}
                    placeholder="Catat perubahan perilaku, kehadiran, atau respons siswa terhadap pembinaan..."
                    value={observation}
                    onChange={(e) => setObservation(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg bg-white focus:outline-none focus:border-sky-600 leading-relaxed"
                  />
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {MONITORING_OBSERVATION_TEMPLATES.map((tpl) => (
                      <button
                        key={tpl}
                        type="button"
                        onClick={() =>
                          setObservation((prev) =>
                            appendMonitoringObservationTemplate(prev, tpl)
                          )
                        }
                        className="px-2.5 py-1 text-xs font-medium text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 rounded-md transition-colors text-left"
                      >
                        + {tpl}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={savingNote}
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-[#1E3A5F] hover:bg-[#162C49] disabled:opacity-60 rounded-lg"
                  >
                    <Plus className="w-4 h-4" />
                    {savingNote ? 'Menyimpan...' : 'Simpan Catatan'}
                  </button>
                </div>
              </form>

              {/* Development Notes Timeline */}
              <div className="space-y-3">
                <h3 className="text-base font-bold text-slate-900">
                  Riwayat Perkembangan ({selectedNotes.length})
                </h3>
                {selectedNotes.length === 0 ? (
                  <p className="text-sm text-slate-400">
                    Belum ada catatan perkembangan berkala untuk siswa ini.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {selectedNotes.map((n) => (
                      <div
                        key={n.id}
                        className="border border-slate-200 rounded-xl p-4 text-sm space-y-2"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className={`inline-flex px-2.5 py-0.5 rounded border text-xs font-semibold ${getMonitoringTrendBadgeClass(
                                n.progressLevel
                              )}`}
                            >
                              {n.progressLevel}
                            </span>
                            <span className="font-mono text-xs text-slate-500">
                              {formatDateShort(n.date)} · {n.counselorName}
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              aria-label={`Edit catatan ${formatDateShort(n.date)}`}
                              onClick={() => openEditNoteModal(n)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                              Edit
                            </button>
                            <button
                              type="button"
                              aria-label={`Hapus catatan ${formatDateShort(n.date)}`}
                              onClick={() => setDeleteTargetNote(n)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-red-700 bg-red-50 hover:bg-red-100 rounded-md"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              Hapus
                            </button>
                          </div>
                        </div>
                        <p className="text-slate-700 whitespace-pre-line leading-relaxed">
                          {n.observation}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Modal: + Pantau Siswa Lain */}
      {addStudentModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/50 overscroll-none flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="add-monitoring-student-title"
          {...addStudentBackdropProps}
        >
          <div className="bg-white rounded-2xl border border-slate-200 w-full max-w-lg max-h-[90vh] overflow-y-auto overscroll-contain shadow-xl">
            <div className="px-5 py-4 border-b border-slate-200 flex items-start justify-between gap-3">
              <h2
                id="add-monitoring-student-title"
                className="text-lg font-bold text-slate-900"
              >
                Pantau Siswa Lain
              </h2>
              <button
                type="button"
                aria-label="Tutup modal pantau siswa lain"
                title="Keluar"
                onClick={() => setAddStudentModalOpen(false)}
                className="p-1.5 text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleAddStudentToMonitoring} className="p-5 space-y-4 text-sm">
              <p className="text-slate-600">
                Tambahkan siswa aktif berstatus <strong>Normal</strong> ke daftar pemantauan
                secara manual dengan memilih kelas, siswa, dan status awal.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="manual-class-filter"
                    className="block font-medium text-slate-700 mb-1"
                  >
                    Filter Kelas
                  </label>
                  <select
                    id="manual-class-filter"
                    value={manualClassFilter}
                    onChange={(e) => {
                      setManualClassFilter(e.target.value);
                      setManualTargetStudentId('');
                    }}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg bg-white"
                  >
                    <option value="all">Semua Kelas</option>
                    {activeClasses.map((c) => (
                      <option key={c.id} value={c.id}>
                        Kelas {c.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label
                    htmlFor="manual-student-search"
                    className="block font-medium text-slate-700 mb-1"
                  >
                    Cari Nama / NIS
                  </label>
                  <input
                    id="manual-student-search"
                    type="search"
                    value={manualSearch}
                    onChange={(e) => {
                      setManualSearch(e.target.value);
                      setManualTargetStudentId('');
                    }}
                    placeholder="Ketik nama atau NIS..."
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="manual-student-select"
                  className="block font-medium text-slate-700 mb-1"
                >
                  Pilih Siswa ({eligibleNormalStudents.length} tersedia) *
                </label>
                <select
                  id="manual-student-select"
                  required
                  value={manualTargetStudentId || eligibleNormalStudents[0]?.id || ''}
                  onChange={(e) => setManualTargetStudentId(e.target.value)}
                  disabled={eligibleNormalStudents.length === 0}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg bg-white disabled:bg-slate-50 disabled:text-slate-400"
                >
                  {eligibleNormalStudents.length === 0 ? (
                    <option value="">
                      Tidak ada siswa berstatus Normal yang sesuai filter
                    </option>
                  ) : (
                    eligibleNormalStudents.map((stu) => (
                      <option key={stu.id} value={stu.id}>
                        {stu.fullName} — Kelas {stu.className} (NIS {stu.nis})
                      </option>
                    ))
                  )}
                </select>
              </div>

              <div>
                <label
                  htmlFor="manual-initial-status"
                  className="block font-medium text-slate-700 mb-1"
                >
                  Status Pemantauan Awal
                </label>
                <select
                  id="manual-initial-status"
                  value={manualInitialStatus}
                  onChange={(e) =>
                    setManualInitialStatus(e.target.value as MonitoringStatus)
                  }
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg bg-white"
                >
                  {MANUAL_MONITORING_STATUSES.map((st) => (
                    <option key={st} value={st}>
                      {st}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setAddStudentModalOpen(false)}
                  className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={eligibleNormalStudents.length === 0 || savingManualStudent}
                  className="px-4 py-2 text-sm font-semibold text-white bg-[#1E3A5F] hover:bg-[#162C49] disabled:opacity-50 rounded-lg"
                >
                  {savingManualStudent ? 'Menambahkan...' : 'Masukkan ke Pemantauan'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Edit Development Note */}
      {editingNote && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/50 overscroll-none flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-monitoring-note-title"
          {...editNoteBackdropProps}
        >
          <div className="bg-white rounded-2xl border border-slate-200 w-full max-w-lg max-h-[90vh] overflow-y-auto overscroll-contain shadow-xl">
            <div className="px-5 py-4 border-b border-slate-200 flex items-start justify-between gap-3">
              <h2
                id="edit-monitoring-note-title"
                className="text-lg font-bold text-slate-900"
              >
                Edit Catatan Perkembangan
              </h2>
              <button
                type="button"
                aria-label="Tutup modal edit catatan"
                title="Keluar"
                onClick={() => setEditingNote(null)}
                className="p-1.5 text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSaveEditNote} className="p-5 space-y-4 text-sm">
              <div>
                <label
                  htmlFor="edit-note-date"
                  className="block font-medium text-slate-700 mb-1"
                >
                  Tanggal Observasi *
                </label>
                <input
                  id="edit-note-date"
                  type="date"
                  required
                  value={editDate}
                  onChange={(e) => setEditDate(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg bg-white"
                />
              </div>

              <div>
                <div className="block font-medium text-slate-700 mb-1">
                  Tren Perkembangan
                </div>
                <div
                  className="grid grid-cols-2 sm:grid-cols-4 gap-1.5"
                  role="group"
                  aria-label="Pilih tren perkembangan edit"
                >
                  {MONITORING_TREND_OPTIONS.map((level) => {
                    const active = editProgressLevel === level;
                    return (
                      <button
                        key={level}
                        type="button"
                        aria-pressed={active}
                        onClick={() => setEditProgressLevel(level)}
                        className={`px-2.5 py-2 text-xs font-semibold border rounded-lg transition-colors text-center ${getMonitoringTrendButtonClass(
                          level,
                          active
                        )}`}
                      >
                        {level}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label
                  htmlFor="edit-note-observation"
                  className="block font-medium text-slate-700 mb-1"
                >
                  Catatan Observasi Perilaku *
                </label>
                <textarea
                  id="edit-note-observation"
                  required
                  maxLength={1200}
                  rows={3}
                  value={editObservation}
                  onChange={(e) => setEditObservation(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg bg-white focus:outline-none focus:border-sky-600 leading-relaxed"
                />
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {MONITORING_OBSERVATION_TEMPLATES.map((tpl) => (
                    <button
                      key={tpl}
                      type="button"
                      onClick={() =>
                        setEditObservation((prev) =>
                          appendMonitoringObservationTemplate(prev, tpl)
                        )
                      }
                      className="px-2.5 py-1 text-xs font-medium text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-md transition-colors text-left"
                    >
                      + {tpl}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingNote(null)}
                  className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={savingEdit}
                  className="px-4 py-2 text-sm font-semibold text-white bg-[#1E3A5F] hover:bg-[#162C49] disabled:opacity-60 rounded-lg"
                >
                  {savingEdit ? 'Menyimpan...' : 'Simpan Perubahan'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Delete Confirmation */}
      <ConfirmDeleteModal
        open={Boolean(deleteTargetNote)}
        title="Hapus Catatan Perkembangan?"
        itemName={
          deleteTargetNote
            ? `${formatDateShort(deleteTargetNote.date)} (${deleteTargetNote.progressLevel})`
            : undefined
        }
        description="Catatan observasi perkembangan siswa ini akan dihapus permanen. Apakah Anda yakin?"
        onCancel={() => setDeleteTargetNote(null)}
        onConfirm={handleConfirmDeleteNote}
      />
    </div>
  );
};
