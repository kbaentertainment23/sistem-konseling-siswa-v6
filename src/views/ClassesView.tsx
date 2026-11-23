import React, { useMemo, useState } from 'react';
import {
  Plus,
  Pencil,
  Trash2,
  ArrowRightLeft,
  GraduationCap,
  CheckSquare,
  Square,
  AlertTriangle,
  CheckCircle2,
  X,
  Users,
  Search,
} from 'lucide-react';
import { useSibk } from '../context/SibkContext';
import type { SchoolClass, Student } from '../types/sibk';
import { ConfirmDeleteModal } from '../components/ConfirmDeleteModal';
import { useModalDismiss } from '../utils/useModalDismiss';

function normalizeLevel(level: string): string {
  const v = level.trim().toUpperCase();
  if (v === '7') return 'VII';
  if (v === '8') return 'VIII';
  if (v === '9') return 'IX';
  if (v === '10') return 'X';
  if (v === '11') return 'XI';
  if (v === '12') return 'XII';
  return v;
}

function getNextLevel(level: string): string | null {
  const v = normalizeLevel(level);
  if (v === 'VII') return 'VIII';
  if (v === 'VIII') return 'IX';
  if (v === 'IX') return null;
  if (v === 'X') return 'XI';
  if (v === 'XI') return 'XII';
  if (v === 'XII') return null;
  return null;
}

function isFinalLevel(level: string): boolean {
  const v = normalizeLevel(level);
  return v === 'IX' || v === 'XII';
}

interface ClassesViewProps {
  onSelectStudent: (student: Student) => void;
}

export const ClassesView: React.FC<ClassesViewProps> = ({ onSelectStudent }) => {
  const {
    classes,
    students,
    settings,
    isAdmin,
    canManageClasses,
    saveClass,
    deleteClass,
    moveStudentClass,
    bulkPromoteOrGraduateStudents,
  } = useSibk();

  const [activeTab, setActiveTab] = useState<'classes' | 'alumni'>('classes');
  const [selectedClassId, setSelectedClassId] = useState<string>(classes[0]?.id || '');
  const [levelFilter, setLevelFilter] = useState<'ALL' | 'VII' | 'VIII' | 'IX'>('ALL');
  const [classSearch, setClassSearch] = useState('');
  const [selectedAlumniGroupKey, setSelectedAlumniGroupKey] = useState<string>('');
  const [alumniSearch, setAlumniSearch] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SchoolClass | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkSourceClassId, setBulkSourceClassId] = useState('');
  const [bulkSelectedStudentIds, setBulkSelectedStudentIds] = useState<string[]>([]);
  const [bulkMode, setBulkMode] = useState<'promote' | 'graduate'>('promote');
  const [bulkTargetClassId, setBulkTargetClassId] = useState('');
  const [bulkArchiveSource, setBulkArchiveSource] = useState(false);
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);
  const [bulkSubmitting, setBulkSubmitting] = useState(false);

  const classFormBackdropProps = useModalDismiss({
    open: formOpen,
    onClose: () => setFormOpen(false),
  });
  const bulkBackdropProps = useModalDismiss({
    open: bulkOpen && isAdmin,
    onClose: () => setBulkOpen(false),
    disabled: bulkConfirmOpen || bulkSubmitting,
  });
  const bulkConfirmBackdropProps = useModalDismiss({
    open: bulkConfirmOpen && isAdmin,
    onClose: () => setBulkConfirmOpen(false),
    disabled: bulkSubmitting,
  });
  const [bulkNotice, setBulkNotice] = useState<{ text: string; isGraduation: boolean } | null>(null);
  const [form, setForm] = useState<Omit<SchoolClass, 'id'>>({
    name: '',
    level: 'VII',
    homeroomTeacher: '',
    academicYear: settings.activeAcademicYear,
    archived: false,
  });

  const activeClasses = classes.filter((c) => !c.archived);
  const visibleClasses = useMemo(
    () => classes.filter((c) => (showArchived ? true : !c.archived)),
    [classes, showArchived]
  );

  const levelCounts = useMemo(() => {
    const counts = { ALL: visibleClasses.length, VII: 0, VIII: 0, IX: 0 };
    for (const c of visibleClasses) {
      const lv = normalizeLevel(c.level);
      if (lv === 'VII') counts.VII++;
      else if (lv === 'VIII') counts.VIII++;
      else if (lv === 'IX') counts.IX++;
    }
    return counts;
  }, [visibleClasses]);

  const filteredClasses = useMemo(() => {
    const levelOrder: Record<string, number> = { VII: 1, VIII: 2, IX: 3, X: 4, XI: 5, XII: 6 };
    const q = classSearch.trim().toLowerCase();
    return visibleClasses
      .filter((c) => {
        if (levelFilter !== 'ALL' && normalizeLevel(c.level) !== levelFilter) return false;
        if (!q) return true;
        return (
          c.name.toLowerCase().includes(q) ||
          c.homeroomTeacher.toLowerCase().includes(q) ||
          c.academicYear.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => {
        const la = levelOrder[normalizeLevel(a.level)] ?? 99;
        const lb = levelOrder[normalizeLevel(b.level)] ?? 99;
        if (la !== lb) return la - lb;
        return a.name.localeCompare(b.name, 'id', { numeric: true, sensitivity: 'base' });
      });
  }, [visibleClasses, levelFilter, classSearch]);

  const selectedClass =
    filteredClasses.find((c) => c.id === selectedClassId) || filteredClasses[0];
  const classStudents = selectedClass
    ? students.filter((s) => s.classId === selectedClass.id && s.status !== 'Lulus')
    : [];

  // Alumni grouped by Academic Year & Last Class Name
  const alumniStudents = useMemo(
    () => students.filter((s) => s.status === 'Lulus'),
    [students]
  );

  const alumniGroups = useMemo(() => {
    const map = new Map<
      string,
      { key: string; className: string; academicYear: string; students: Student[] }
    >();
    for (const s of alumniStudents) {
      const clsName = s.className || 'Tanpa Kelas';
      const year = s.academicYear || 'Tidak Diketahui';
      const key = `${year}__${clsName}`;
      const existing = map.get(key);
      if (existing) {
        existing.students.push(s);
      } else {
        map.set(key, { key, className: clsName, academicYear: year, students: [s] });
      }
    }
    return Array.from(map.values()).sort((a, b) => {
      const yearCmp = b.academicYear.localeCompare(a.academicYear);
      if (yearCmp !== 0) return yearCmp;
      return a.className.localeCompare(b.className);
    });
  }, [alumniStudents]);

  const selectedAlumniGroup =
    alumniGroups.find((g) => g.key === selectedAlumniGroupKey) || alumniGroups[0];

  const filteredAlumniInGroup = useMemo(() => {
    if (!selectedAlumniGroup) return [];
    const q = alumniSearch.trim().toLowerCase();
    if (!q) return selectedAlumniGroup.students;
    return selectedAlumniGroup.students.filter(
      (s) => s.fullName.toLowerCase().includes(q) || s.nis.toLowerCase().includes(q)
    );
  }, [selectedAlumniGroup, alumniSearch]);

  const bulkSourceClass = activeClasses.find((c) => c.id === bulkSourceClassId);
  const bulkSourceNextLevel = bulkSourceClass ? getNextLevel(bulkSourceClass.level) : null;
  const bulkSourceIsFinal = bulkSourceClass ? isFinalLevel(bulkSourceClass.level) : false;

  const bulkTargetClasses = activeClasses.filter((c) => {
    if (c.id === bulkSourceClassId) return false;
    if (!bulkSourceNextLevel) return false;
    return normalizeLevel(c.level) === bulkSourceNextLevel;
  });

  const bulkTargetClass = bulkTargetClasses.find((c) => c.id === bulkTargetClassId);
  const bulkEligibleStudents = bulkSourceClassId
    ? students.filter((s) => s.classId === bulkSourceClassId && s.status === 'Aktif')
    : [];

  const handleSelectBulkSource = (classId: string) => {
    setBulkSourceClassId(classId);
    const eligible = students
      .filter((s) => s.classId === classId && s.status === 'Aktif')
      .map((s) => s.id);
    setBulkSelectedStudentIds(eligible);
    const cls = activeClasses.find((c) => c.id === classId);
    if (cls && isFinalLevel(cls.level)) {
      setBulkMode('graduate');
      setBulkTargetClassId('');
    } else {
      setBulkMode('promote');
      setBulkTargetClassId('');
    }
  };

  const openBulkModal = () => {
    const defaultSourceId =
      selectedClass && !selectedClass.archived ? selectedClass.id : activeClasses[0]?.id || '';
    const defaultCls = activeClasses.find((c) => c.id === defaultSourceId);
    setBulkSourceClassId(defaultSourceId);
    const eligible = defaultSourceId
      ? students
          .filter((s) => s.classId === defaultSourceId && s.status === 'Aktif')
          .map((s) => s.id)
      : [];
    setBulkSelectedStudentIds(eligible);
    setBulkMode(defaultCls && isFinalLevel(defaultCls.level) ? 'graduate' : 'promote');
    setBulkTargetClassId('');
    setBulkArchiveSource(false);
    setBulkConfirmOpen(false);
    setBulkOpen(true);
  };

  const toggleBulkStudent = (studentId: string) => {
    setBulkSelectedStudentIds((prev) =>
      prev.includes(studentId) ? prev.filter((id) => id !== studentId) : [...prev, studentId]
    );
  };

  const handleConfirmBulkAction = async () => {
    if (!bulkSourceClassId || bulkSelectedStudentIds.length === 0) return;
    if (bulkMode === 'promote' && !bulkTargetClassId) return;
    setBulkSubmitting(true);
    try {
      const count = await bulkPromoteOrGraduateStudents({
        mode: bulkMode,
        sourceClassId: bulkSourceClassId,
        targetClassId: bulkMode === 'promote' ? bulkTargetClassId : undefined,
        studentIds: bulkSelectedStudentIds,
        archiveSourceClass: bulkArchiveSource,
      });
      const summary =
        bulkMode === 'promote'
          ? `${count} siswa berhasil dinaikkan dari Kelas ${bulkSourceClass?.name || ''} ke Kelas ${bulkTargetClass?.name || ''}${bulkArchiveSource ? ' dan kelas asal telah diarsipkan' : ''}.`
          : `${count} siswa dari Kelas ${bulkSourceClass?.name || ''} berhasil diluluskan dan ditampung di Alumni Kelas ${bulkSourceClass?.name || ''} (${bulkSourceClass?.academicYear || ''})${bulkArchiveSource ? ' serta kelas asal telah diarsipkan' : ''}.`;
      setBulkNotice({ text: summary, isGraduation: bulkMode === 'graduate' });
      if (bulkMode === 'graduate' && bulkSourceClass) {
        setSelectedAlumniGroupKey(`${bulkSourceClass.academicYear}__${bulkSourceClass.name}`);
      }
      setBulkConfirmOpen(false);
      setBulkOpen(false);
    } finally {
      setBulkSubmitting(false);
    }
  };

  const openAdd = () => {
    setEditingId(null);
    setForm({
      name: '',
      level: 'VII',
      homeroomTeacher: '',
      academicYear: settings.activeAcademicYear,
      archived: false,
    });
    setFormOpen(true);
  };

  const openEdit = (cls: SchoolClass) => {
    setEditingId(cls.id);
    setForm({
      name: cls.name,
      level: cls.level,
      homeroomTeacher: cls.homeroomTeacher,
      academicYear: cls.academicYear,
      archived: Boolean(cls.archived),
    });
    setFormOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    await saveClass({ ...form, id: editingId || undefined });
    setFormOpen(false);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900">Manajemen Kelas & Tahun Ajaran</h1>
          <p className="text-sm text-slate-600 mt-1">
            Tahun Ajaran Aktif: {settings.activeAcademicYear} · Riwayat kelas lama tetap tersimpan saat
            diarsipkan
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
            />
            Tampilkan Arsip
          </label>
          {isAdmin && (
            <button
              type="button"
              onClick={openBulkModal}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-semibold text-[#1E3A5F] bg-sky-50 hover:bg-sky-100 border border-sky-200 rounded-lg whitespace-nowrap"
            >
              <GraduationCap className="w-4 h-4" /> Kenaikan Kelas / Kelulusan Massal
            </button>
          )}
          {canManageClasses && (
            <button
              type="button"
              onClick={openAdd}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-[#1E3A5F] hover:bg-[#162C49] rounded-lg whitespace-nowrap"
            >
              <Plus className="w-4 h-4" /> Tambah Kelas
            </button>
          )}
        </div>
      </div>

      {bulkNotice && (
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl text-sm">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
            <span>{bulkNotice.text}</span>
          </div>
          <div className="flex items-center gap-2">
            {bulkNotice.isGraduation && (
              <button
                type="button"
                onClick={() => {
                  setActiveTab('alumni');
                  setBulkNotice(null);
                }}
                className="px-2.5 py-1 text-xs font-semibold text-emerald-900 bg-emerald-100 hover:bg-emerald-200 rounded-md"
              >
                Lihat di Tab Alumni
              </button>
            )}
            <button
              type="button"
              onClick={() => setBulkNotice(null)}
              className="p-1 text-emerald-700 hover:bg-emerald-100 rounded"
              aria-label="Tutup notifikasi"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Navigation Tabs: Daftar Kelas vs Alumni / Siswa Lulus */}
      <div className="flex items-center gap-1 border-b border-slate-200">
        <button
          type="button"
          onClick={() => setActiveTab('classes')}
          className={`inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors ${
            activeTab === 'classes'
              ? 'border-[#1E3A5F] text-[#1E3A5F]'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          <Users className="w-4 h-4" />
          Daftar Kelas ({visibleClasses.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('alumni')}
          className={`inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors ${
            activeTab === 'alumni'
              ? 'border-[#1E3A5F] text-[#1E3A5F]'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          <GraduationCap className="w-4 h-4" />
          Alumni / Siswa Lulus ({alumniStudents.length})
        </button>
      </div>

      {activeTab === 'classes' ? (
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Class List */}
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col self-start">
          {/* Level Filter & Quick Search Header */}
          <div className="p-3 border-b border-slate-200 bg-slate-50/70 space-y-2.5">
            <div className="grid grid-cols-4 gap-1 bg-slate-200/70 p-1 rounded-lg">
              {(
                [
                  { id: 'ALL', label: 'Semua', count: levelCounts.ALL },
                  { id: 'VII', label: 'VII', count: levelCounts.VII },
                  { id: 'VIII', label: 'VIII', count: levelCounts.VIII },
                  { id: 'IX', label: 'IX', count: levelCounts.IX },
                ] as const
              ).map((item) => {
                const active = levelFilter === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setLevelFilter(item.id);
                      const nextList = visibleClasses.filter((c) =>
                        item.id === 'ALL' ? true : normalizeLevel(c.level) === item.id
                      );
                      if (nextList.length > 0 && !nextList.some((c) => c.id === selectedClassId)) {
                        nextList.sort((a, b) =>
                          a.name.localeCompare(b.name, 'id', { numeric: true, sensitivity: 'base' })
                        );
                        setSelectedClassId(nextList[0].id);
                      }
                    }}
                    className={`px-2 py-1.5 rounded-md text-xs font-semibold transition-colors text-center ${
                      active
                        ? 'bg-white text-[#1E3A5F] shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {item.label}{' '}
                    <span className={active ? 'text-[#1E3A5F]/70' : 'text-slate-400'}>
                      ({item.count})
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={classSearch}
                onChange={(e) => setClassSearch(e.target.value)}
                placeholder="Cari kelas (mis. 8.5) atau wali..."
                className="w-full pl-9 pr-8 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-[#1E3A5F]"
              />
              {classSearch && (
                <button
                  type="button"
                  onClick={() => setClassSearch('')}
                  aria-label="Hapus pencarian kelas"
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>

          {/* Compact Scrollable Class Items */}
          <div className="max-h-[540px] overflow-y-auto divide-y divide-slate-100">
            {filteredClasses.length === 0 ? (
              <div className="p-6 text-sm text-slate-400 text-center">
                {visibleClasses.length === 0
                  ? 'Belum ada kelas.'
                  : 'Tidak ada kelas yang cocok dengan filter.'}
              </div>
            ) : (
              filteredClasses.map((cls) => {
                const count = students.filter(
                  (s) => s.classId === cls.id && s.status === 'Aktif'
                ).length;
                const isSelected = selectedClass?.id === cls.id;
                return (
                  <div
                    key={cls.id}
                    className={`px-3.5 py-2.5 flex items-center justify-between gap-2 transition-colors ${
                      isSelected
                        ? 'bg-sky-50/80 border-l-2 border-l-[#1E3A5F]'
                        : 'hover:bg-slate-50 border-l-2 border-l-transparent'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => setSelectedClassId(cls.id)}
                      className="flex-1 text-left min-w-0"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-slate-900 truncate">
                          Kelas {cls.name} {cls.archived ? '(Arsip)' : ''}
                        </span>
                        <span className="text-xs font-semibold font-mono tabular-nums px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 shrink-0">
                          {count} siswa
                        </span>
                      </div>
                      <div className="text-xs text-slate-500 truncate mt-0.5">
                        {cls.homeroomTeacher || 'Belum ada wali'} · {cls.academicYear}
                      </div>
                    </button>
                    {canManageClasses && (
                      <div className="flex items-center gap-0.5 shrink-0">
                        <button
                          type="button"
                          aria-label={`Edit kelas ${cls.name}`}
                          onClick={() => openEdit(cls)}
                          className="p-1.5 text-slate-400 hover:text-slate-900 rounded-md hover:bg-white"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        {isAdmin && (
                          <button
                            type="button"
                            aria-label={`Hapus kelas ${cls.name}`}
                            onClick={() => setDeleteTarget(cls)}
                            className="p-1.5 text-slate-400 hover:text-red-700 rounded-md hover:bg-white"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Students in Selected Class */}
        <div className="lg:col-span-2 bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-slate-900">
                Daftar Siswa {selectedClass ? `Kelas ${selectedClass.name}` : ''}
              </h2>
              {selectedClass && (
                <div className="text-sm text-slate-500">
                  Wali Kelas: {selectedClass.homeroomTeacher} · Tahun Ajaran {selectedClass.academicYear}
                </div>
              )}
            </div>
            <span className="text-sm font-mono text-slate-600 tabular-nums">
              {classStudents.length} siswa
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 text-xs">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">NIS</th>
                  <th className="px-4 py-2.5 font-semibold">Nama Siswa</th>
                  <th className="px-4 py-2.5 font-semibold">Status</th>
                  {canManageClasses && <th className="px-4 py-2.5 font-semibold">Pindah Kelas</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {classStudents.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-slate-400">
                      Belum ada siswa di kelas ini.
                    </td>
                  </tr>
                ) : (
                  classStudents.map((stu) => (
                    <tr key={stu.id} className="hover:bg-slate-50/70">
                      <td className="px-4 py-2.5 font-mono text-slate-600">{stu.nis}</td>
                      <td className="px-4 py-2.5">
                        <button
                          type="button"
                          onClick={() => onSelectStudent(stu)}
                          className="font-semibold text-slate-900 hover:text-sky-700"
                        >
                          {stu.fullName}
                        </button>
                      </td>
                      <td className="px-4 py-2.5 text-slate-600">{stu.status}</td>
                      {canManageClasses && (
                        <td className="px-4 py-2.5">
                          <div className="inline-flex items-center gap-1.5">
                            <ArrowRightLeft className="w-3.5 h-3.5 text-slate-400" />
                            <select
                              aria-label={`Pindahkan ${stu.fullName} ke kelas lain`}
                              value={stu.classId}
                              onChange={(e) => {
                                const target = classes.find((c) => c.id === e.target.value);
                                if (target) moveStudentClass(stu.id, target.id, target.name);
                              }}
                              className="px-2.5 py-1 text-sm border border-slate-200 rounded-md bg-white"
                            >
                              {classes
                                .filter((c) => !c.archived)
                                .map((c) => (
                                  <option key={c.id} value={c.id}>
                                    {c.name}
                                  </option>
                                ))}
                            </select>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      ) : (
        /* Alumni / Siswa Lulus View grouped by Class & Academic Year */
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
            <div className="px-4 py-3 bg-slate-50/70 border-b border-slate-200">
              <div className="text-sm font-bold text-slate-800">Kelompok Alumni per Kelas</div>
              <div className="text-xs text-slate-500 mt-0.5">
                Siswa lulus dikelompokkan otomatis sesuai kelas terakhir & tahun ajaran
              </div>
            </div>
            {alumniGroups.length === 0 ? (
              <div className="p-6 text-sm text-slate-400 text-center">
                Belum ada data siswa yang lulus / alumni.
              </div>
            ) : (
              alumniGroups.map((group) => {
                const isSelected = selectedAlumniGroup?.key === group.key;
                return (
                  <button
                    key={group.key}
                    type="button"
                    onClick={() => setSelectedAlumniGroupKey(group.key)}
                    className={`w-full p-4 text-left flex items-center justify-between gap-3 transition-colors ${
                      isSelected ? 'bg-sky-50/70' : 'hover:bg-slate-50'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-slate-900">
                        Alumni Kelas {group.className}
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        Tahun Ajaran {group.academicYear}
                      </div>
                    </div>
                    <span className="text-xs font-semibold text-[#1E3A5F] bg-sky-100/80 px-2.5 py-1 rounded-md shrink-0">
                      {group.students.length} siswa
                    </span>
                  </button>
                );
              })
            )}
          </div>

          <div className="lg:col-span-2 bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-bold text-slate-900">
                  {selectedAlumniGroup
                    ? `Alumni Kelas ${selectedAlumniGroup.className} · TA ${selectedAlumniGroup.academicYear}`
                    : 'Daftar Alumni / Siswa Lulus'}
                </h2>
                <p className="text-sm text-slate-500 mt-0.5">
                  Klik nama siswa untuk melihat profil dan seluruh riwayat BK selama bersekolah
                </p>
              </div>
              {selectedAlumniGroup && (
                <div className="relative w-full sm:w-56">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={alumniSearch}
                    onChange={(e) => setAlumniSearch(e.target.value)}
                    placeholder="Cari nama / NIS..."
                    className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg"
                  />
                </div>
              )}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="bg-slate-50 text-slate-600 border-b border-slate-200 text-xs">
                  <tr>
                    <th className="px-4 py-2.5 font-semibold">NIS</th>
                    <th className="px-4 py-2.5 font-semibold">Nama Siswa</th>
                    <th className="px-4 py-2.5 font-semibold">Kelas Terakhir</th>
                    <th className="px-4 py-2.5 font-semibold">Status</th>
                    <th className="px-4 py-2.5 font-semibold text-right">Riwayat BK</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredAlumniInGroup.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                        {selectedAlumniGroup
                          ? 'Tidak ada alumni yang cocok dengan pencarian.'
                          : 'Belum ada siswa lulus untuk ditampilkan.'}
                      </td>
                    </tr>
                  ) : (
                    filteredAlumniInGroup.map((stu) => (
                      <tr key={stu.id} className="hover:bg-slate-50/70">
                        <td className="px-4 py-2.5 font-mono text-slate-600">{stu.nis}</td>
                        <td className="px-4 py-2.5">
                          <button
                            type="button"
                            onClick={() => onSelectStudent(stu)}
                            className="font-semibold text-slate-900 hover:text-sky-700 text-left"
                          >
                            {stu.fullName}
                          </button>
                          <div className="text-xs text-slate-500">{stu.gender}</div>
                        </td>
                        <td className="px-4 py-2.5 text-slate-600">
                          Kelas {stu.className} ({stu.academicYear})
                        </td>
                        <td className="px-4 py-2.5">
                          <span className="inline-flex items-center px-2 py-0.5 text-xs font-semibold bg-indigo-50 text-indigo-700 rounded">
                            Lulus
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <button
                            type="button"
                            onClick={() => onSelectStudent(stu)}
                            className="text-sm font-medium text-[#1E3A5F] hover:underline"
                          >
                            Lihat Profil & Riwayat
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Add/Edit Class Modal */}
      {formOpen && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          {...classFormBackdropProps}
        >
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-md p-6">
            <div className="flex items-start justify-between gap-3 mb-4">
              <h2 className="text-lg font-bold text-slate-900">
                {editingId ? 'Edit Data Kelas' : 'Tambah Kelas Baru'}
              </h2>
              <button
                type="button"
                aria-label="Tutup form kelas"
                title="Keluar"
                onClick={() => setFormOpen(false)}
                className="p-1.5 text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-4 text-sm">
              <div>
                <label className="block font-medium text-slate-700 mb-1">Nama Kelas *</label>
                <input
                  required
                  placeholder="Contoh: VII A, VIII B, X IPA 1"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Tingkat</label>
                  <select
                    value={form.level}
                    onChange={(e) => setForm({ ...form, level: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg bg-white"
                  >
                    <option value="VII">VII</option>
                    <option value="VIII">VIII</option>
                    <option value="IX">IX</option>
                    <option value="X">X</option>
                    <option value="XI">XI</option>
                    <option value="XII">XII</option>
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Tahun Ajaran</label>
                  <input
                    required
                    value={form.academicYear}
                    onChange={(e) => setForm({ ...form, academicYear: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg"
                  />
                </div>
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Wali Kelas *</label>
                <input
                  required
                  value={form.homeroomTeacher}
                  onChange={(e) => setForm({ ...form, homeroomTeacher: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg"
                />
              </div>
              <label className="inline-flex items-center gap-2 text-slate-700">
                <input
                  type="checkbox"
                  checked={Boolean(form.archived)}
                  onChange={(e) => setForm({ ...form, archived: e.target.checked })}
                />
                Arsipkan kelas ini (tahun ajaran sebelumnya)
              </label>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setFormOpen(false)}
                  className="px-3.5 py-2 text-sm font-medium text-slate-700 bg-slate-100 rounded-lg"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-sm font-semibold text-white bg-[#1E3A5F] rounded-lg"
                >
                  Simpan Kelas
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmDeleteModal
        open={Boolean(deleteTarget)}
        title="Hapus Data Kelas?"
        itemName={
          deleteTarget
            ? `Kelas ${deleteTarget.name} (Tahun Ajaran ${deleteTarget.academicYear})`
            : undefined
        }
        description="Data kelas ini akan dihapus permanen dari database. Pastikan siswa di kelas ini sudah dipindahkan jika masih aktif."
        onCancel={() => setDeleteTarget(null)}
        onConfirm={async () => {
          if (!deleteTarget) return;
          await deleteClass(deleteTarget.id);
          setDeleteTarget(null);
        }}
      />

      {/* Bulk Promotion & Graduation Modal */}
      {bulkOpen && isAdmin && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          {...bulkBackdropProps}
        >
          <div className="bg-white rounded-xl max-w-2xl w-full max-h-[90vh] flex flex-col border border-slate-200 shadow-xl">
            <div className="px-6 py-4 border-b border-slate-200 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-bold text-slate-900">
                  Kenaikan Kelas & Kelulusan Massal
                </h3>
                <p className="text-sm text-slate-500 mt-0.5">
                  Seluruh riwayat kasus BK, konseling, absensi, pemanggilan orang tua, dan pemantauan
                  siswa tetap utuh dan terhubung ke ID siswa.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setBulkOpen(false)}
                title="Keluar"
                className="p-1.5 text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors shrink-0"
                aria-label="Tutup modal"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-5 overflow-y-auto text-sm">
              {/* Langkah 1: Pilih Kelas Asal */}
              <div className="space-y-2">
                <div className="text-sm font-semibold text-slate-800">
                  Langkah 1 — Pilih Kelas Asal (Aktif)
                </div>
                <select
                  value={bulkSourceClassId}
                  onChange={(e) => handleSelectBulkSource(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg bg-white text-slate-800"
                >
                  <option value="">-- Pilih kelas asal --</option>
                  {activeClasses.map((c) => (
                    <option key={c.id} value={c.id}>
                      Kelas {c.name} · Tingkat {c.level} · TA {c.academicYear} (Wali: {c.homeroomTeacher})
                    </option>
                  ))}
                </select>
              </div>

              {/* Langkah 2: Daftar Siswa dengan Checkbox */}
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm font-semibold text-slate-800">
                    Langkah 2 — Pilih Siswa Aktif ({bulkSelectedStudentIds.length} dari{' '}
                    {bulkEligibleStudents.length} dipilih)
                  </div>
                  {bulkEligibleStudents.length > 0 && (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          setBulkSelectedStudentIds(bulkEligibleStudents.map((s) => s.id))
                        }
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-[#1E3A5F] bg-sky-50 hover:bg-sky-100 rounded-md"
                      >
                        <CheckSquare className="w-3.5 h-3.5" /> Pilih Semua
                      </button>
                      <button
                        type="button"
                        onClick={() => setBulkSelectedStudentIds([])}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-md"
                      >
                        <Square className="w-3.5 h-3.5" /> Batal Pilih Semua
                      </button>
                    </div>
                  )}
                </div>

                <div className="border border-slate-200 rounded-lg max-h-52 overflow-y-auto divide-y divide-slate-100">
                  {!bulkSourceClassId ? (
                    <div className="p-4 text-center text-slate-400">
                      Pilih kelas asal terlebih dahulu untuk menampilkan daftar siswa aktif.
                    </div>
                  ) : bulkEligibleStudents.length === 0 ? (
                    <div className="p-4 text-center text-slate-400">
                      Tidak ada siswa berstatus Aktif di kelas ini.
                    </div>
                  ) : (
                    bulkEligibleStudents.map((student) => {
                      const checked = bulkSelectedStudentIds.includes(student.id);
                      return (
                        <label
                          key={student.id}
                          className={`flex items-center justify-between gap-3 px-3.5 py-2.5 cursor-pointer ${
                            checked ? 'bg-sky-50/50' : 'hover:bg-slate-50'
                          }`}
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleBulkStudent(student.id)}
                            />
                            <div className="min-w-0">
                              <div className="font-medium text-slate-900 truncate">
                                {student.fullName}
                              </div>
                              <div className="text-xs text-slate-500">
                                NIS {student.nis} · {student.gender}
                              </div>
                            </div>
                          </div>
                          <span className="text-xs font-medium text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded">
                            Aktif
                          </span>
                        </label>
                      );
                    })
                  )}
                </div>
                <p className="text-xs text-slate-500">
                  Lepas centang jika ada siswa yang tinggal kelas atau pindah agar tidak ikut diproses.
                </p>
              </div>

              {/* Langkah 3: Pilih Jenis Aksi */}
              <div className="space-y-3">
                <div className="text-sm font-semibold text-slate-800">
                  Langkah 3 — Pilih Jenis Aksi
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <button
                    type="button"
                    disabled={bulkSourceIsFinal}
                    onClick={() => setBulkMode('promote')}
                    className={`p-3 rounded-lg border text-left transition-colors ${
                      bulkSourceIsFinal
                        ? 'border-slate-200 bg-slate-50 text-slate-400 cursor-not-allowed'
                        : bulkMode === 'promote'
                        ? 'border-[#1E3A5F] bg-sky-50/70 text-[#1E3A5F]'
                        : 'border-slate-200 hover:bg-slate-50 text-slate-700'
                    }`}
                  >
                    <div className="font-semibold">
                      Naikkan ke Kelas Tujuan
                      {bulkSourceNextLevel ? ` (Tingkat ${bulkSourceNextLevel})` : ''}
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      {bulkSourceIsFinal
                        ? 'Kelas tingkat akhir (IX / XII) tidak naik kelas, langsung ke Kelulusan / Alumni.'
                        : bulkSourceNextLevel
                        ? `Siswa tingkat ${bulkSourceClass?.level} akan dinaikkan ke kelas tingkat ${bulkSourceNextLevel}.`
                        : 'Perbarui kelas & tahun ajaran siswa sesuai kelas tujuan.'}
                    </div>
                  </button>
                  <button
                    type="button"
                    disabled={Boolean(bulkSourceClass) && !bulkSourceIsFinal}
                    onClick={() => setBulkMode('graduate')}
                    className={`p-3 rounded-lg border text-left transition-colors ${
                      Boolean(bulkSourceClass) && !bulkSourceIsFinal
                        ? 'border-slate-200 bg-slate-50 text-slate-400 cursor-not-allowed'
                        : bulkMode === 'graduate'
                        ? 'border-[#1E3A5F] bg-sky-50/70 text-[#1E3A5F]'
                        : 'border-slate-200 hover:bg-slate-50 text-slate-700'
                    }`}
                  >
                    <div className="font-semibold">Luluskan Siswa Massal (Alumni)</div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      {Boolean(bulkSourceClass) && !bulkSourceIsFinal
                        ? 'Khusus untuk kelas tingkat akhir (IX / XII).'
                        : 'Ubah status menjadi Lulus & tampung otomatis di wadah Alumni sesuai kelas.'}
                    </div>
                  </button>
                </div>

                {bulkMode === 'promote' && (
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">
                      Pilih Kelas Tujuan Aktif
                      {bulkSourceNextLevel ? ` (Khusus Tingkat ${bulkSourceNextLevel})` : ''} *
                    </label>
                    <select
                      value={bulkTargetClassId}
                      onChange={(e) => setBulkTargetClassId(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg bg-white text-slate-800"
                    >
                      <option value="">
                        {bulkTargetClasses.length === 0 && bulkSourceNextLevel
                          ? `-- Belum ada kelas aktif tingkat ${bulkSourceNextLevel} --`
                          : '-- Pilih kelas tujuan --'}
                      </option>
                      {bulkTargetClasses.map((c) => (
                        <option key={c.id} value={c.id}>
                          Kelas {c.name} · Tingkat {c.level} · TA {c.academicYear} (Wali: {c.homeroomTeacher})
                        </option>
                      ))}
                    </select>
                    {bulkSourceNextLevel && bulkTargetClasses.length === 0 && (
                      <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-2">
                        Belum ada kelas aktif untuk tingkat <strong>{bulkSourceNextLevel}</strong>.
                        Silakan buat kelas tingkat {bulkSourceNextLevel} terlebih dahulu melalui
                        tombol <strong>Tambah Kelas</strong>.
                      </p>
                    )}
                  </div>
                )}

                {bulkMode === 'graduate' && bulkSourceClass && (
                  <div className="p-3 rounded-lg bg-indigo-50/70 border border-indigo-200 text-indigo-900 text-xs">
                    <div className="font-semibold mb-0.5">Wadah Penampungan Alumni Otomatis</div>
                    <div>
                      Siswa yang dipilih akan diubah statusnya menjadi <strong>Lulus</strong> dan
                      otomatis ditampung di tab <strong>Alumni / Siswa Lulus</strong> pada kelompok{' '}
                      <strong>
                        Alumni Kelas {bulkSourceClass.name} · TA {bulkSourceClass.academicYear}
                      </strong>
                      .
                    </div>
                  </div>
                )}

                <label className="flex items-center gap-2 pt-1 text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={bulkArchiveSource}
                    onChange={(e) => setBulkArchiveSource(e.target.checked)}
                  />
                  <span>
                    Arsipkan kelas asal ({bulkSourceClass ? `Kelas ${bulkSourceClass.name}` : '—'})
                    setelah proses selesai (data tetap tersimpan di arsip)
                  </span>
                </label>
              </div>
            </div>

            <div className="px-6 py-4 border-t border-slate-200 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setBulkOpen(false)}
                className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={
                  !bulkSourceClassId ||
                  bulkSelectedStudentIds.length === 0 ||
                  (bulkMode === 'promote' && !bulkTargetClassId)
                }
                onClick={() => setBulkConfirmOpen(true)}
                className="px-4 py-2 text-sm font-semibold text-white bg-[#1E3A5F] hover:bg-[#162C49] disabled:opacity-50 disabled:cursor-not-allowed rounded-lg"
              >
                Lanjutkan ke Konfirmasi
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Summary Confirmation Popup before saving to Firestore */}
      {bulkConfirmOpen && isAdmin && (
        <div
          className="fixed inset-0 z-[60] bg-slate-900/60 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          {...bulkConfirmBackdropProps}
        >
          <div className="bg-white rounded-xl max-w-md w-full p-6 space-y-4 border border-slate-200 shadow-2xl">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-lg bg-amber-50 text-amber-600 shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-base font-bold text-slate-900">
                  Konfirmasi {bulkMode === 'promote' ? 'Kenaikan Kelas Massal' : 'Kelulusan Massal'}
                </h4>
                <p className="text-sm text-slate-500 mt-1">
                  Periksa ringkasan berikut sebelum menyimpan perubahan ke database:
                </p>
              </div>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3.5 space-y-2 text-sm">
              <div className="flex justify-between gap-2">
                <span className="text-slate-500">Jumlah Siswa Diproses</span>
                <span className="font-bold text-slate-900">
                  {bulkSelectedStudentIds.length} siswa
                </span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-slate-500">Kelas Asal</span>
                <span className="font-semibold text-slate-800">
                  Kelas {bulkSourceClass?.name} ({bulkSourceClass?.academicYear})
                </span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-slate-500">
                  {bulkMode === 'promote' ? 'Kelas Tujuan' : 'Status Baru'}
                </span>
                <span className="font-semibold text-[#1E3A5F]">
                  {bulkMode === 'promote'
                    ? `Kelas ${bulkTargetClass?.name} (${bulkTargetClass?.academicYear})`
                    : 'Lulus'}
                </span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-slate-500">Arsipkan Kelas Asal</span>
                <span className="font-semibold text-slate-800">
                  {bulkArchiveSource ? 'Ya, arsipkan' : 'Tidak'}
                </span>
              </div>
            </div>

            <p className="text-xs text-slate-500">
              Riwayat kasus BK, konseling, absensi, pemanggilan orang tua, dan pemantauan siswa
              tetap aman dengan label kelas & tahun ajaran sebelumnya, serta aktivitas ini akan
              dicatat di Audit Log.
            </p>

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                disabled={bulkSubmitting}
                onClick={() => setBulkConfirmOpen(false)}
                className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg"
              >
                Kembali
              </button>
              <button
                type="button"
                disabled={bulkSubmitting}
                onClick={handleConfirmBulkAction}
                className="px-4 py-2 text-sm font-semibold text-white bg-[#1E3A5F] hover:bg-[#162C49] disabled:opacity-50 rounded-lg"
              >
                {bulkSubmitting ? 'Menyimpan...' : 'Ya, Proses Sekarang'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
