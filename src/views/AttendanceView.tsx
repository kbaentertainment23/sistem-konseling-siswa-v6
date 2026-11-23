import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Save, CheckCheck, Trash2 } from 'lucide-react';
import { useSibk } from '../context/SibkContext';
import type { AttendanceStatus } from '../types/sibk';
import { buildAttendanceId, getIndonesianDayName, getTodayISO } from '../utils/sibkLogic';
import { ConfirmDeleteModal } from '../components/ConfirmDeleteModal';

const STATUS_OPTIONS: AttendanceStatus[] = ['Hadir', 'Sakit', 'Izin', 'Alpa', 'Dispensasi'];

export const AttendanceView: React.FC = () => {
  const {
    classes,
    students,
    attendance,
    settings,
    currentUser,
    saveAttendanceBatch,
    deleteAttendanceByDateAndClass,
  } = useSibk();

  const activeClasses = useMemo(() => classes.filter((c) => !c.archived), [classes]);
  const [date, setDate] = useState(getTodayISO());
  const [classId, setClassId] = useState(activeClasses[0]?.id || '');
  const [draft, setDraft] = useState<
    Record<string, { status: AttendanceStatus | ''; note: string }>
  >({});
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  const selectedClass = activeClasses.find((c) => c.id === classId) || activeClasses[0];
  const filledClassIdsForDate = useMemo(() => {
    const set = new Set<string>();
    for (const a of attendance) {
      if (a.date === date) set.add(a.classId);
    }
    return set;
  }, [attendance, date]);

  const filledClassesCount = useMemo(
    () => activeClasses.filter((c) => filledClassIdsForDate.has(c.id)).length,
    [activeClasses, filledClassIdsForDate]
  );
  const unfilledClassesCount = Math.max(0, activeClasses.length - filledClassesCount);

  const existingCountForDateClass = useMemo(() => {
    if (!selectedClass) return 0;
    return attendance.filter((a) => a.date === date && a.classId === selectedClass.id).length;
  }, [attendance, date, selectedClass]);
  const classStudents = useMemo(
    () =>
      students.filter(
        (s) => s.classId === (selectedClass?.id || '') && s.status === 'Aktif'
      ),
    [students, selectedClass]
  );

  const dirtyIdsRef = useRef<Set<string>>(new Set());
  const lastContextKeyRef = useRef<string>('');

  // Sync draft with existing attendance without clobbering unsaved edits from concurrent users
  useEffect(() => {
    const contextKey = `${date}__${selectedClass?.id || ''}`;
    const isContextSwitch = lastContextKeyRef.current !== contextKey;
    if (isContextSwitch) {
      lastContextKeyRef.current = contextKey;
      dirtyIdsRef.current.clear();
    }

    setDraft((prev) => {
      const next: Record<string, { status: AttendanceStatus | ''; note: string }> = {};
      classStudents.forEach((stu) => {
        if (!isContextSwitch && dirtyIdsRef.current.has(stu.id) && prev[stu.id]) {
          next[stu.id] = prev[stu.id];
          return;
        }
        const id = buildAttendanceId(date, stu.id);
        const existing = attendance.find((a) => a.id === id);
        next[stu.id] = {
          status: existing ? existing.status : '',
          note: existing ? existing.note : '',
        };
      });
      return next;
    });
  }, [date, selectedClass?.id, classStudents, attendance]);

  const markAllPresent = () => {
    const next = { ...draft };
    classStudents.forEach((stu) => {
      if (!next[stu.id]?.status) {
        next[stu.id] = { status: 'Hadir', note: '' };
        dirtyIdsRef.current.add(stu.id);
      }
    });
    setDraft(next);
  };

  const unsetCount = classStudents.filter((stu) => !draft[stu.id]?.status).length;

  const handleSave = async () => {
    if (!selectedClass) return;
    setErrorMsg('');
    const records = classStudents
      .filter((stu) => draft[stu.id]?.status)
      .map((stu) => ({
        date,
        studentId: stu.id,
        studentName: stu.fullName,
        nis: stu.nis,
        classId: selectedClass.id,
        className: selectedClass.name,
        status: draft[stu.id].status as AttendanceStatus,
        note: draft[stu.id].note || '',
        academicYear: settings.activeAcademicYear,
        recordedBy: currentUser?.name || 'Guru BK',
      }));

    if (records.length === 0) {
      setErrorMsg('Pilih status kehadiran minimal 1 siswa terlebih dahulu.');
      setTimeout(() => setErrorMsg(''), 4000);
      return;
    }

    setSaving(true);
    try {
      await saveAttendanceBatch(records);
      dirtyIdsRef.current.clear();
      setSavedMsg(
        `Absensi Kelas ${selectedClass.name} tanggal ${date} (${records.length} siswa) berhasil disimpan.`
      );
      setTimeout(() => setSavedMsg(''), 4000);
    } catch {
      setErrorMsg('Gagal menyimpan data absensi. Periksa koneksi atau hak akses Anda.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900">Absensi Siswa Harian</h1>
          <p className="text-sm text-slate-600 mt-1">
            {getIndonesianDayName(date)}, {date} · Sistem mencegah data absensi ganda per siswa per
            tanggal
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={markAllPresent}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg whitespace-nowrap"
          >
            <CheckCheck className="w-4 h-4" /> Hadir Semua (Belum Diisi)
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={handleSave}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-[#1E3A5F] hover:bg-[#162C49] rounded-lg disabled:opacity-60 whitespace-nowrap"
          >
            <Save className="w-4 h-4" /> {saving ? 'Menyimpan...' : 'Simpan Absensi'}
          </button>
        </div>
      </div>

      {savedMsg && (
        <div className="p-3.5 rounded-lg bg-emerald-50 border border-emerald-200 text-sm text-emerald-800">
          {savedMsg}
        </div>
      )}

      {errorMsg && (
        <div
          role="alert"
          className="p-3.5 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800"
        >
          {errorMsg}
        </div>
      )}

      {/* Controls */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <div>
            <label htmlFor="att-date" className="block text-xs font-medium text-slate-600 mb-1">
              Tanggal
            </label>
            <input
              id="att-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="px-3 py-2 text-sm border border-slate-200 rounded-lg"
            />
          </div>
          <div>
            <label htmlFor="att-class" className="block text-xs font-medium text-slate-600 mb-1">
              Pilih Kelas
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <select
                id="att-class"
                value={selectedClass?.id || ''}
                onChange={(e) => setClassId(e.target.value)}
                className="px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white min-w-[230px]"
              >
                {activeClasses.map((c) => {
                  const isFilled = filledClassIdsForDate.has(c.id);
                  return (
                    <option key={c.id} value={c.id}>
                      Kelas {c.name} — {isFilled ? '✓ Sudah diisi' : 'Belum diisi'}
                    </option>
                  );
                })}
              </select>
              <button
                type="button"
                disabled={!selectedClass || existingCountForDateClass === 0}
                onClick={() => setConfirmDeleteOpen(true)}
                title={
                  existingCountForDateClass > 0
                    ? `Hapus ${existingCountForDateClass} data absen Kelas ${selectedClass?.name} pada tanggal ${date}`
                    : 'Belum ada data absen tersimpan pada tanggal dan kelas ini'
                }
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs sm:text-sm font-semibold text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 rounded-lg disabled:opacity-45 disabled:cursor-not-allowed whitespace-nowrap"
              >
                <Trash2 className="w-4 h-4" />
                Hapus Absen ({existingCountForDateClass})
              </button>
            </div>
          </div>
        </div>

        <div className="flex flex-col sm:items-end gap-1 text-xs sm:text-sm text-slate-600 font-mono tabular-nums">
          <div>
            Kelas diabsen:{' '}
            <strong className="text-emerald-700">{filledClassesCount}</strong>/{activeClasses.length}{' '}
            · Belum:{' '}
            <strong className={unfilledClassesCount > 0 ? 'text-amber-700' : 'text-emerald-700'}>
              {unfilledClassesCount}
            </strong>
          </div>
          <div>
            Total siswa: <strong className="text-slate-900">{classStudents.length}</strong> · Belum
            diisi:{' '}
            <strong className={unsetCount > 0 ? 'text-amber-700' : 'text-emerald-700'}>
              {unsetCount}
            </strong>
          </div>
        </div>
      </div>

      {/* Attendance Grid */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 text-xs uppercase tracking-wide">
              <tr>
                <th className="px-4 py-3 font-semibold">NIS</th>
                <th className="px-4 py-3 font-semibold">Nama Siswa</th>
                <th className="px-4 py-3 font-semibold">Status Kehadiran</th>
                <th className="px-4 py-3 font-semibold">Keterangan</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {classStudents.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-slate-400">
                    Tidak ada siswa aktif di kelas ini.
                  </td>
                </tr>
              ) : (
                classStudents.map((stu) => {
                  const row = draft[stu.id] || { status: '', note: '' };
                  return (
                    <tr key={stu.id} className={!row.status ? 'bg-amber-50/30' : ''}>
                      <td className="px-4 py-3 font-mono text-slate-600 whitespace-nowrap">
                        {stu.nis}
                      </td>
                      <td className="px-4 py-3 font-semibold text-slate-900 whitespace-nowrap">
                        {stu.fullName}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1.5">
                          {STATUS_OPTIONS.map((st) => {
                            const active = row.status === st;
                            return (
                              <button
                                key={st}
                                type="button"
                                onClick={() => {
                                  dirtyIdsRef.current.add(stu.id);
                                  setDraft((prev) => ({
                                    ...prev,
                                    [stu.id]: { ...prev[stu.id], status: st },
                                  }));
                                }}
                                className={`px-2.5 py-1.5 rounded-md text-xs font-medium border transition-colors ${
                                  active
                                    ? st === 'Hadir'
                                      ? 'bg-emerald-600 text-white border-emerald-600'
                                      : st === 'Alpa'
                                      ? 'bg-red-600 text-white border-red-600'
                                      : 'bg-[#1E3A5F] text-white border-[#1E3A5F]'
                                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                                }`}
                              >
                                {st}
                              </button>
                            );
                          })}
                        </div>
                      </td>
                      <td className="px-4 py-3 min-w-[200px]">
                        <input
                          type="text"
                          placeholder="Alasan ketidakhadiran / catatan..."
                          value={row.note}
                          onChange={(e) => {
                            dirtyIdsRef.current.add(stu.id);
                            setDraft((prev) => ({
                              ...prev,
                              [stu.id]: { ...prev[stu.id], note: e.target.value },
                            }));
                          }}
                          className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                        />
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
      <ConfirmDeleteModal
        open={confirmDeleteOpen}
        title="Hapus Data Absensi Harian?"
        itemName={
          selectedClass
            ? `Kelas ${selectedClass.name} · ${getIndonesianDayName(date)}, ${date} (${existingCountForDateClass} siswa)`
            : undefined
        }
        description="Seluruh catatan absensi yang tersimpan pada tanggal dan kelas tersebut akan dihapus permanen dari database."
        onCancel={() => setConfirmDeleteOpen(false)}
        onConfirm={async () => {
          if (!selectedClass) return;
          const deleted = await deleteAttendanceByDateAndClass(date, selectedClass.id);
          dirtyIdsRef.current.clear();
          setConfirmDeleteOpen(false);
          if (deleted > 0) {
            setSavedMsg(
              `Absensi Kelas ${selectedClass.name} tanggal ${date} (${deleted} data) berhasil dihapus.`
            );
            setTimeout(() => setSavedMsg(''), 4000);
          }
        }}
      />
    </div>
  );
};
