import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Calendar,
  CalendarClock,
  CalendarPlus,
  CheckCircle2,
  Circle,
  Pencil,
  PhoneCall,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  User,
  X,
} from 'lucide-react';
import { useSibk } from '../context/SibkContext';
import type { BKSchedule, NavSection, ScheduleType, Student } from '../types/sibk';
import { formatDateShort, getTodayISO } from '../utils/sibkLogic';
import {
  computeRescheduledDate,
  computeScheduleAttentionSummary,
  filterAndSortSchedules,
  getScheduleSyncSource,
  getScheduleUrgencyBucket,
  SCHEDULE_NOTE_TEMPLATES,
  SCHEDULE_TITLE_TEMPLATES,
  SCHEDULE_TYPES,
  type ScheduleTabFilter,
  type ScheduleUrgencyBucket,
} from '../utils/scheduleLogic';
import { ConfirmDeleteModal } from '../components/ConfirmDeleteModal';
import { useModalScrollLock } from '../utils/useModalScrollLock';
import { useModalDismiss } from '../utils/useModalDismiss';

interface SchedulesViewProps {
  preselectedStudent?: Student | null;
  onClearPreselected?: () => void;
  onSelectStudent?: (student: Student) => void;
  onNavigate?: (section: NavSection) => void;
}

function getUrgencyBadgeMeta(bucket: ScheduleUrgencyBucket): {
  label: string;
  className: string;
} {
  switch (bucket) {
    case 'overdue':
      return {
        label: 'Terlewat',
        className: 'bg-red-50 text-red-700 border-red-200',
      };
    case 'today':
      return {
        label: 'Hari Ini',
        className: 'bg-amber-50 text-amber-800 border-amber-200',
      };
    case 'tomorrow':
      return {
        label: 'Besok',
        className: 'bg-sky-50 text-sky-800 border-sky-200',
      };
    case 'completed':
      return {
        label: 'Selesai',
        className: 'bg-emerald-50 text-emerald-700 border-emerald-200',
      };
    default:
      return {
        label: 'Mendatang',
        className: 'bg-slate-100 text-slate-700 border-slate-200',
      };
  }
}

export const SchedulesView: React.FC<SchedulesViewProps> = ({
  preselectedStudent,
  onClearPreselected,
  onSelectStudent,
  onNavigate,
}) => {
  const { schedules, students, classes, isCounselor, saveSchedule, deleteSchedule } = useSibk();
  const todayISO = getTodayISO();

  // Add Agenda Form State
  const [title, setTitle] = useState('');
  const [type, setType] = useState<ScheduleType>('Konseling Siswa');
  const [date, setDate] = useState(todayISO);
  const [time, setTime] = useState('09:00');
  const [selectedClassId, setSelectedClassId] = useState('');
  const [studentId, setStudentId] = useState('');
  const [notes, setNotes] = useState('');

  // Filter State
  const [tabFilter, setTabFilter] = useState<ScheduleTabFilter>('all');
  const [typeFilter, setTypeFilter] = useState<'all' | ScheduleType>('all');
  const [search, setSearch] = useState('');

  // Edit & Delete Modal State
  const [editingSchedule, setEditingSchedule] = useState<BKSchedule | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editType, setEditType] = useState<ScheduleType>('Konseling Siswa');
  const [editDate, setEditDate] = useState(todayISO);
  const [editTime, setEditTime] = useState('09:00');
  const [editClassId, setEditClassId] = useState('');
  const [editStudentId, setEditStudentId] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<BKSchedule | null>(null);
  const [feedback, setFeedback] = useState('');

  const isAnyModalOpen = Boolean(editingSchedule) || Boolean(deleteTarget);
  useModalScrollLock(isAnyModalOpen);

  const editScheduleBackdropProps = useModalDismiss({
    open: Boolean(editingSchedule),
    onClose: () => setEditingSchedule(null),
  });

  const showToast = (msg: string) => {
    setFeedback(msg);
    setTimeout(() => setFeedback(''), 4000);
  };

  useEffect(() => {
    if (!preselectedStudent) return;
    setSelectedClassId(preselectedStudent.classId);
    setStudentId(preselectedStudent.id);
    setType('Konseling Siswa');
    setTitle((prev) =>
      prev.trim() ? prev : `Pemantauan / Konseling: ${preselectedStudent.fullName}`
    );
    onClearPreselected?.();
  }, [preselectedStudent, onClearPreselected]);

  const activeClasses = useMemo(() => classes.filter((c) => !c.archived), [classes]);

  const studentsById = useMemo(() => {
    const map = new Map<string, Student>();
    for (const s of students) map.set(s.id, s);
    return map;
  }, [students]);

  const studentsInClass = useMemo(
    () =>
      selectedClassId
        ? students.filter((s) => s.classId === selectedClassId && s.status === 'Aktif')
        : [],
    [students, selectedClassId]
  );

  const studentsInEditClass = useMemo(
    () =>
      editClassId
        ? students.filter((s) => s.classId === editClassId && s.status === 'Aktif')
        : [],
    [students, editClassId]
  );

  const attention = useMemo(
    () => computeScheduleAttentionSummary(schedules, todayISO),
    [schedules, todayISO]
  );

  const filteredSchedules = useMemo(
    () =>
      filterAndSortSchedules(schedules, {
        tabFilter,
        typeFilter,
        search,
        todayISO,
      }),
    [schedules, tabFilter, typeFilter, search, todayISO]
  );

  const appendNoteSnippet = (
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    const stu = students.find((s) => s.id === studentId);
    await saveSchedule({
      title: title.trim(),
      type,
      date,
      time,
      studentId: stu?.id || '',
      studentName: stu?.fullName || '',
      notes: notes.trim(),
      completed: false,
    });
    setTitle('');
    setNotes('');
    setSelectedClassId('');
    setStudentId('');
    showToast('Agenda baru berhasil ditambahkan ke Jadwal BK.');
  };

  const handleToggleCompleted = async (sch: BKSchedule) => {
    const nextDone = !sch.completed;
    await saveSchedule({ ...sch, completed: nextDone });
    showToast(
      nextDone
        ? `Agenda "${sch.title}" ditandai selesai.`
        : `Agenda "${sch.title}" dibuka kembali.`
    );
  };

  const handleRescheduleNextDay = async (sch: BKSchedule) => {
    const nextDate = computeRescheduledDate(sch.date, todayISO, 1);
    await saveSchedule({ ...sch, date: nextDate });
    showToast(`Agenda "${sch.title}" digeser ke ${formatDateShort(nextDate)}.`);
  };

  const openEditModal = (sch: BKSchedule) => {
    const stu = sch.studentId ? studentsById.get(sch.studentId) : undefined;
    setEditingSchedule(sch);
    setEditTitle(sch.title);
    setEditType(sch.type);
    setEditDate(sch.date || todayISO);
    setEditTime(sch.time || '09:00');
    setEditClassId(stu?.classId || '');
    setEditStudentId(stu?.id || '');
    setEditNotes(sch.notes || '');
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingSchedule || !editTitle.trim()) return;
    const stu = editStudentId ? studentsById.get(editStudentId) : undefined;
    await saveSchedule({
      ...editingSchedule,
      title: editTitle.trim(),
      type: editType,
      date: editDate,
      time: editTime,
      studentId: stu?.id || '',
      studentName: stu?.fullName || '',
      notes: editNotes.trim(),
    });
    setEditingSchedule(null);
    showToast('Perubahan agenda BK berhasil disimpan.');
  };

  const hasActiveFilter = tabFilter !== 'all' || typeFilter !== 'all' || search.trim() !== '';

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900">
            Jadwal &amp; Agenda Kegiatan BK
          </h1>
          <p className="text-sm text-slate-600 mt-1 font-mono tabular-nums">
            {attention.totalUrgentCount} mendesak (terlewat / hari ini) · {attention.upcoming.length}{' '}
            mendatang · {attention.completed.length} selesai
          </p>
        </div>
      </div>

      {feedback && (
        <div className="p-3.5 rounded-lg bg-emerald-50 border border-emerald-200 text-sm text-emerald-800 flex items-center justify-between gap-2">
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

      {/* Proactive Urgent Banner (Overdue + Today) */}
      {attention.urgentItems.length > 0 && (
        <section
          aria-label="Banner Agenda Mendesak"
          className="bg-white border border-amber-300 rounded-xl p-4 space-y-3"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
              <h2 className="text-base font-bold text-slate-900">
                Agenda Mendesak ({attention.totalUrgentCount})
              </h2>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs font-semibold font-mono tabular-nums">
              {attention.overdue.length > 0 && (
                <span className="px-2 py-0.5 rounded bg-red-50 text-red-700 border border-red-200">
                  {attention.overdue.length} Terlewat
                </span>
              )}
              {attention.dueToday.length > 0 && (
                <span className="px-2 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200">
                  {attention.dueToday.length} Hari Ini
                </span>
              )}
            </div>
          </div>

          <div className="divide-y divide-slate-100 border-t border-slate-100">
            {attention.urgentItems.slice(0, 6).map((sch) => {
              const bucket = getScheduleUrgencyBucket(sch, todayISO);
              const isOverdue = bucket === 'overdue';
              const stu = sch.studentId ? studentsById.get(sch.studentId) : undefined;
              return (
                <div
                  key={`urgent-${sch.id}`}
                  className="py-3 flex flex-col md:flex-row md:items-center justify-between gap-2.5 text-sm"
                >
                  <div className="flex items-start gap-2.5 min-w-0">
                    <CalendarClock
                      className={`w-4 h-4 shrink-0 mt-0.5 ${
                        isOverdue ? 'text-red-600' : 'text-amber-600'
                      }`}
                    />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span
                          className={`px-2 py-0.5 text-xs font-semibold rounded border ${
                            isOverdue
                              ? 'bg-red-50 text-red-700 border-red-200'
                              : 'bg-amber-50 text-amber-800 border-amber-200'
                          }`}
                        >
                          {isOverdue ? 'Terlewat' : 'Hari Ini'}
                        </span>
                        <span className="font-semibold text-slate-900">{sch.title}</span>
                        <span className="text-slate-400">·</span>
                        <span className="font-mono text-xs text-slate-600">
                          {formatDateShort(sch.date)} {sch.time}
                        </span>
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        {sch.type}
                        {sch.studentName ? ` · Siswa: ${sch.studentName}` : ''}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                    {isCounselor && (
                      <>
                        <button
                          type="button"
                          onClick={() => handleToggleCompleted(sch)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-md whitespace-nowrap"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Selesaikan
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRescheduleNextDay(sch)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md whitespace-nowrap"
                        >
                          <CalendarPlus className="w-3.5 h-3.5" />
                          Geser Besok (+1 Hari)
                        </button>
                      </>
                    )}
                    {stu && onSelectStudent && (
                      <button
                        type="button"
                        onClick={() => onSelectStudent(stu)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-[#1E3A5F] bg-sky-50 hover:bg-sky-100 border border-sky-200 rounded-md whitespace-nowrap"
                      >
                        <User className="w-3.5 h-3.5" />
                        Lihat Siswa
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* 4 Filter Tabs + Search & Type Filter */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
        <div
          className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto"
          role="tablist"
          aria-label="Filter waktu jadwal BK"
        >
          {(
            [
              { id: 'all', label: 'Semua', count: schedules.length },
              {
                id: 'urgent',
                label: 'Hari Ini & Terlewat',
                count: attention.totalUrgentCount,
              },
              { id: 'upcoming', label: 'Mendatang', count: attention.upcoming.length },
              { id: 'done', label: 'Selesai', count: attention.completed.length },
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
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cari judul kegiatan, nama siswa, atau catatan..."
              aria-label="Cari agenda jadwal BK"
              className="w-full pl-9 pr-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:bg-white focus:border-sky-600"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Filter jenis agenda BK"
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as 'all' | ScheduleType)}
              className="px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
            >
              <option value="all">Semua Jenis Agenda</option>
              {SCHEDULE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            {hasActiveFilter && (
              <button
                type="button"
                onClick={() => {
                  setTabFilter('all');
                  setTypeFilter('all');
                  setSearch('');
                }}
                className="inline-flex items-center gap-1 px-3 py-2 text-sm font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg whitespace-nowrap"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Reset
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Main Content Grid: Add Form + Agenda List */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {isCounselor && (
          <form
            onSubmit={handleSubmit}
            className="bg-white border border-slate-200 rounded-xl p-5 space-y-3.5 text-sm self-start"
          >
            <h2 className="text-base font-bold text-slate-900">Tambah Agenda Baru</h2>

            <div>
              <label htmlFor="sch-title" className="block font-medium text-slate-700 mb-1">
                Judul Kegiatan *
              </label>
              <input
                id="sch-title"
                required
                placeholder="Contoh: Konseling lanjutan Andi"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:border-sky-600"
              />
              <div className="flex flex-wrap gap-1.5 mt-2">
                {SCHEDULE_TITLE_TEMPLATES.map((tpl) => (
                  <button
                    key={tpl}
                    type="button"
                    onClick={() => setTitle(tpl)}
                    className="px-2.5 py-1 text-xs font-medium text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-md transition-colors text-left"
                  >
                    + {tpl}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label htmlFor="sch-type" className="block font-medium text-slate-700 mb-1">
                Jenis Agenda
              </label>
              <select
                id="sch-type"
                value={type}
                onChange={(e) => setType(e.target.value as ScheduleType)}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg bg-white"
              >
                {SCHEDULE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="sch-date" className="block font-medium text-slate-700 mb-1">
                  Tanggal *
                </label>
                <input
                  id="sch-date"
                  type="date"
                  required
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg"
                />
              </div>
              <div>
                <label htmlFor="sch-time" className="block font-medium text-slate-700 mb-1">
                  Waktu
                </label>
                <input
                  id="sch-time"
                  type="time"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg"
                />
              </div>
            </div>

            <div>
              <label htmlFor="sch-class" className="block font-medium text-slate-700 mb-1">
                1. Pilih Kelas Siswa (Opsional)
              </label>
              <select
                id="sch-class"
                value={selectedClassId}
                onChange={(e) => {
                  setSelectedClassId(e.target.value);
                  setStudentId('');
                }}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg bg-white"
              >
                <option value="">-- Pilih Kelas --</option>
                {activeClasses.map((c) => (
                  <option key={c.id} value={c.id}>
                    Kelas {c.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="sch-student" className="block font-medium text-slate-700 mb-1">
                2. Pilih Nama Siswa (Opsional)
              </label>
              <select
                id="sch-student"
                value={studentId}
                disabled={!selectedClassId}
                onChange={(e) => setStudentId(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg bg-white disabled:bg-slate-50 disabled:text-slate-400"
              >
                <option value="">
                  {selectedClassId ? '-- Pilih Siswa --' : '-- Pilih kelas terlebih dahulu --'}
                </option>
                {studentsInClass.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.fullName} (NIS {s.nis})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="sch-notes" className="block font-medium text-slate-700 mb-1">
                Catatan
              </label>
              <textarea
                id="sch-notes"
                rows={2}
                placeholder="Persiapan atau keterangan agenda..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:border-sky-600"
              />
              <div className="flex flex-wrap gap-1.5 mt-2">
                {SCHEDULE_NOTE_TEMPLATES.map((tpl) => (
                  <button
                    key={tpl}
                    type="button"
                    onClick={() => appendNoteSnippet(setNotes, notes, tpl)}
                    className="px-2.5 py-1 text-xs font-medium text-slate-600 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-md transition-colors text-left"
                  >
                    + {tpl}
                  </button>
                ))}
              </div>
            </div>

            <button
              type="submit"
              className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-2.5 text-sm font-semibold text-white bg-[#1E3A5F] hover:bg-[#162C49] rounded-lg"
            >
              <Plus className="w-4 h-4" /> Simpan Agenda
            </button>
          </form>
        )}

        <div
          className={`${
            isCounselor ? 'lg:col-span-2' : 'lg:col-span-3'
          } bg-white border border-slate-200 rounded-xl divide-y divide-slate-100 overflow-hidden`}
        >
          {filteredSchedules.length === 0 ? (
            <div className="p-10 text-center text-sm text-slate-400">
              {schedules.length === 0
                ? 'Belum ada jadwal kegiatan BK.'
                : 'Tidak ada agenda jadwal BK yang sesuai filter saat ini.'}
            </div>
          ) : (
            filteredSchedules.map((sch) => {
              const bucket = getScheduleUrgencyBucket(sch, todayISO);
              const badge = getUrgencyBadgeMeta(bucket);
              const syncSource = getScheduleSyncSource(sch.id);
              const stu = sch.studentId ? studentsById.get(sch.studentId) : undefined;
              const isParentCallAgenda = sch.type === 'Pemanggilan Orang Tua';
              const isCaseAgenda =
                sch.type === 'Konseling Siswa' || sch.type === 'Tindak Lanjut';

              return (
                <div
                  key={sch.id}
                  className={`p-4 space-y-3 transition-colors ${
                    sch.completed ? 'bg-slate-50/60 opacity-80' : 'hover:bg-slate-50/50'
                  }`}
                >
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                    <div className="flex items-start gap-3 min-w-0">
                      {isCounselor && (
                        <button
                          type="button"
                          aria-label={
                            sch.completed
                              ? `Buka kembali ${sch.title}`
                              : `Tandai ${sch.title} selesai`
                          }
                          title={sch.completed ? 'Buka kembali agenda' : 'Tandai selesai'}
                          onClick={() => handleToggleCompleted(sch)}
                          className="mt-0.5 text-slate-400 hover:text-emerald-600 shrink-0"
                        >
                          {sch.completed ? (
                            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                          ) : (
                            <Circle className="w-4 h-4" />
                          )}
                        </button>
                      )}
                      <div className="min-w-0 space-y-1.5">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span
                            className={`inline-flex px-2 py-0.5 rounded border text-xs font-semibold ${badge.className}`}
                          >
                            {badge.label}
                          </span>
                          <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 text-xs font-medium">
                            {sch.type}
                          </span>
                          {syncSource === 'parent-call' && (
                            <span className="px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-200 text-xs font-semibold">
                              Sinkron Pemanggilan Ortu
                            </span>
                          )}
                          {syncSource === 'counseling-eval' && (
                            <span className="px-2 py-0.5 rounded bg-sky-50 text-sky-700 border border-sky-200 text-xs font-semibold">
                              Sinkron Evaluasi Konseling
                            </span>
                          )}
                        </div>

                        <div
                          className={`text-base font-bold ${
                            sch.completed ? 'line-through text-slate-500' : 'text-slate-900'
                          }`}
                        >
                          {sch.title}
                        </div>

                        <div className="text-sm text-slate-600 flex flex-wrap items-center gap-x-3 gap-y-1">
                          <span className="font-mono text-xs inline-flex items-center gap-1 text-slate-700">
                            <Calendar className="w-3.5 h-3.5 text-slate-400" />
                            {formatDateShort(sch.date)} {sch.time || ''}
                          </span>
                          {sch.studentName && (
                            <span>
                              Siswa:{' '}
                              <strong className="font-semibold text-slate-800">
                                {sch.studentName}
                              </strong>
                            </span>
                          )}
                        </div>

                        {sch.notes && <p className="text-sm text-slate-600">{sch.notes}</p>}
                      </div>
                    </div>
                  </div>

                  {/* Quick Actions Row */}
                  <div className="flex flex-wrap items-center gap-1.5 pl-0 sm:pl-7">
                    {stu && onSelectStudent && (
                      <button
                        type="button"
                        onClick={() => onSelectStudent(stu)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-[#1E3A5F] bg-sky-50 hover:bg-sky-100 border border-sky-200 rounded-md"
                      >
                        <User className="w-3.5 h-3.5" />
                        Profil Siswa
                      </button>
                    )}

                    {onNavigate && isParentCallAgenda && (
                      <button
                        type="button"
                        onClick={() => onNavigate('parent-calls')}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-md"
                      >
                        <PhoneCall className="w-3.5 h-3.5" />
                        Ke Pemanggilan Ortu
                      </button>
                    )}

                    {onNavigate && isCaseAgenda && (
                      <button
                        type="button"
                        onClick={() => onNavigate('cases')}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-sky-800 bg-sky-50 hover:bg-sky-100 border border-sky-200 rounded-md"
                      >
                        <ArrowRight className="w-3.5 h-3.5" />
                        Ke Kasus &amp; Konseling
                      </button>
                    )}

                    {isCounselor && !sch.completed && (
                      <button
                        type="button"
                        onClick={() => handleRescheduleNextDay(sch)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md"
                      >
                        <CalendarPlus className="w-3.5 h-3.5" />
                        Geser +1 Hari
                      </button>
                    )}

                    {isCounselor && (
                      <>
                        <button
                          type="button"
                          aria-label={`Edit agenda ${sch.title}`}
                          onClick={() => openEditModal(sch)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                          Edit
                        </button>
                        <button
                          type="button"
                          aria-label={`Hapus agenda ${sch.title}`}
                          onClick={() => setDeleteTarget(sch)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-red-700 bg-red-50 hover:bg-red-100 rounded-md"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          Hapus
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Edit Schedule Modal */}
      {editingSchedule && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/50 overscroll-none flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-schedule-title"
          {...editScheduleBackdropProps}
        >
          <div className="bg-white rounded-2xl border border-slate-200 w-full max-w-lg max-h-[90vh] overflow-y-auto overscroll-contain shadow-xl">
            <div className="px-5 py-4 border-b border-slate-200 flex items-start justify-between gap-3">
              <h2 id="edit-schedule-title" className="text-lg font-bold text-slate-900">
                Edit Agenda BK
              </h2>
              <button
                type="button"
                aria-label="Tutup modal edit agenda"
                title="Keluar"
                onClick={() => setEditingSchedule(null)}
                className="p-1.5 text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSaveEdit} className="p-5 space-y-3.5 text-sm">
              <div>
                <label className="block font-medium text-slate-700 mb-1">Judul Kegiatan *</label>
                <input
                  required
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Jenis Agenda</label>
                <select
                  value={editType}
                  onChange={(e) => setEditType(e.target.value as ScheduleType)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg bg-white"
                >
                  {SCHEDULE_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Tanggal *</label>
                  <input
                    type="date"
                    required
                    value={editDate}
                    onChange={(e) => setEditDate(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Waktu</label>
                  <input
                    type="time"
                    value={editTime}
                    onChange={(e) => setEditTime(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Kelas (Opsional)</label>
                  <select
                    value={editClassId}
                    onChange={(e) => {
                      setEditClassId(e.target.value);
                      setEditStudentId('');
                    }}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg bg-white"
                  >
                    <option value="">-- Tanpa Kelas --</option>
                    {activeClasses.map((c) => (
                      <option key={c.id} value={c.id}>
                        Kelas {c.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Siswa (Opsional)</label>
                  <select
                    value={editStudentId}
                    disabled={!editClassId}
                    onChange={(e) => setEditStudentId(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg bg-white disabled:bg-slate-50 disabled:text-slate-400"
                  >
                    <option value="">
                      {editClassId ? '-- Pilih Siswa --' : '-- Pilih kelas dulu --'}
                    </option>
                    {studentsInEditClass.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.fullName}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Catatan</label>
                <textarea
                  rows={3}
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingSchedule(null)}
                  className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-sm font-semibold text-white bg-[#1E3A5F] hover:bg-[#162C49] rounded-lg"
                >
                  Simpan Perubahan
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmDeleteModal
        open={Boolean(deleteTarget)}
        title="Hapus Agenda BK?"
        itemName={
          deleteTarget ? `${deleteTarget.title} (${formatDateShort(deleteTarget.date)})` : undefined
        }
        description="Agenda kegiatan BK ini akan dihapus permanen dari jadwal. Apakah Anda yakin?"
        onCancel={() => setDeleteTarget(null)}
        onConfirm={async () => {
          if (!deleteTarget) return;
          await deleteSchedule(deleteTarget.id);
          setDeleteTarget(null);
          showToast('Agenda BK berhasil dihapus.');
        }}
      />
    </div>
  );
};
