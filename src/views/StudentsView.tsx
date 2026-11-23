import React, { useMemo, useRef, useState } from 'react';
import { Plus, Upload, Download, Pencil, Trash2, Eye, X, FileSpreadsheet } from 'lucide-react';
import { useSibk } from '../context/SibkContext';
import type { Student, StudentStatus } from '../types/sibk';
import {
  downloadStudentImportTemplate,
  exportToExcel,
  parseStudentsExcel,
} from '../utils/exportUtils';
import { useModalDismiss } from '../utils/useModalDismiss';

interface StudentsViewProps {
  onSelectStudent: (student: Student) => void;
}

const EMPTY_FORM: Omit<Student, 'id'> = {
  nis: '',
  nisn: '',
  fullName: '',
  gender: 'Laki-laki',
  birthPlace: '',
  birthDate: '',
  religion: 'Islam',
  classId: '',
  className: '',
  address: '',
  studentPhone: '',
  fatherName: '',
  motherName: '',
  guardianName: '',
  parentPhone: '',
  parentAddress: '',
  entryYear: '2026',
  status: 'Aktif',
  notes: '',
  monitoringStatus: 'Normal',
  caseCount: 0,
  academicYear: '2026/2027',
};

const PAGE_SIZE = 10;

export const StudentsView: React.FC<StudentsViewProps> = ({ onSelectStudent }) => {
  const {
    students,
    classes,
    settings,
    isAdmin,
    saveStudent,
    deleteStudent,
    bulkImportStudents,
  } = useSibk();

  const [search, setSearch] = useState('');
  const [classFilter, setClassFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<Omit<Student, 'id'>>(EMPTY_FORM);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [savingStudent, setSavingStudent] = useState(false);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importClassId, setImportClassId] = useState('');
  const [importPreviewRows, setImportPreviewRows] = useState<Array<Omit<Student, 'id'>>>([]);
  const [importFileName, setImportFileName] = useState('');
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const deleteBackdropProps = useModalDismiss({
    open: Boolean(confirmDeleteId),
    onClose: () => setConfirmDeleteId(null),
  });
  const studentModalBackdropProps = useModalDismiss({
    open: modalOpen,
    onClose: () => setModalOpen(false),
    disabled: savingStudent,
  });
  const importModalBackdropProps = useModalDismiss({
    open: importModalOpen && isAdmin,
    onClose: () => setImportModalOpen(false),
    disabled: importing,
  });

  const activeClasses = useMemo(() => classes.filter((c) => !c.archived), [classes]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return students.filter((s) => {
      const matchClass = classFilter === 'all' || s.classId === classFilter;
      const matchQuery =
        !q ||
        s.fullName.toLowerCase().includes(q) ||
        s.nis.toLowerCase().includes(q) ||
        s.nisn.toLowerCase().includes(q);
      return matchClass && matchQuery;
    });
  }, [students, search, classFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paginated = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const openAdd = () => {
    const firstClass = activeClasses[0];
    setEditingId(null);
    setForm({
      ...EMPTY_FORM,
      classId: firstClass?.id || '',
      className: firstClass?.name || '',
      academicYear: settings.activeAcademicYear,
    });
    setModalOpen(true);
  };

  const openEdit = (s: Student) => {
    setEditingId(s.id);
    const { id: _id, ...rest } = s;
    setForm(rest);
    setModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.nis.trim() || !form.fullName.trim() || !form.classId || savingStudent) return;
    setErrorMsg('');
    setSavingStudent(true);
    try {
      const cls = classes.find((c) => c.id === form.classId);
      await saveStudent({
        ...form,
        id: editingId || undefined,
        className: cls?.name || form.className,
      });
      setModalOpen(false);
      setFeedback(editingId ? 'Data siswa berhasil diperbarui.' : 'Data siswa baru berhasil ditambahkan.');
      setTimeout(() => setFeedback(''), 3000);
    } catch {
      setErrorMsg('Gagal menyimpan data siswa. Periksa koneksi atau hak akses Anda.');
    } finally {
      setSavingStudent(false);
    }
  };

  const handleExport = () => {
    const rows = filtered.map((s) => ({
      NIS: s.nis,
      NISN: s.nisn,
      'Nama Lengkap': s.fullName,
      'Jenis Kelamin': s.gender,
      'Tempat Lahir': s.birthPlace,
      'Tanggal Lahir': s.birthDate,
      Agama: s.religion || '',
      Kelas: s.className,
      Alamat: s.address,
      'HP Siswa': s.studentPhone,
      'Nama Ayah': s.fatherName,
      'Nama Ibu': s.motherName,
      'Nama Wali': s.guardianName || '',
      'HP Orang Tua': s.parentPhone,
      'Tahun Masuk': s.entryYear,
      Status: s.status,
      'Jumlah Kasus': s.caseCount,
    }));
    exportToExcel(rows, `Data_Siswa_${settings.activeAcademicYear.replace('/', '-')}`, 'Siswa', {
      title: 'Data Induk Peserta Didik',
      subtitle: `${filtered.length} siswa ditampilkan`,
      settings,
    });
  };

  const openImportModal = () => {
    const preselected =
      classFilter !== 'all' ? classFilter : activeClasses[0]?.id || '';
    setImportClassId(preselected);
    setImportPreviewRows([]);
    setImportFileName('');
    if (fileInputRef.current) fileInputRef.current.value = '';
    setImportModalOpen(true);
  };

  const handleDownloadTemplateForClass = (targetClassId?: string) => {
    const clsId = targetClassId || (classFilter !== 'all' ? classFilter : activeClasses[0]?.id);
    const cls = activeClasses.find((c) => c.id === clsId);
    if (!cls) {
      openImportModal();
      return;
    }
    downloadStudentImportTemplate(cls.name, cls.academicYear || settings.activeAcademicYear);
    setFeedback(`Template Excel untuk Kelas ${cls.name} berhasil diunduh.`);
    setTimeout(() => setFeedback(''), 3500);
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const targetCls = activeClasses.find((c) => c.id === importClassId) || activeClasses[0];
    if (!targetCls) return;
    setErrorMsg('');
    try {
      const parsed = await parseStudentsExcel(
        file,
        targetCls.id,
        targetCls.name,
        targetCls.academicYear || settings.activeAcademicYear
      );
      setImportFileName(file.name);
      setImportPreviewRows(parsed);
      if (parsed.length === 0) {
        setErrorMsg('File Excel tidak memiliki baris siswa yang valid (minimal isi kolom NIS & Nama Lengkap).');
      }
    } catch {
      setErrorMsg('Gagal membaca file Excel. Pastikan file berformat .xlsx/.xls/.csv yang valid.');
    }
  };

  const existingNisSet = useMemo(
    () => new Set(students.map((s) => s.nis.trim().toLowerCase())),
    [students]
  );

  const importDuplicateCount = useMemo(
    () => importPreviewRows.filter((r) => existingNisSet.has(r.nis.trim().toLowerCase())).length,
    [importPreviewRows, existingNisSet]
  );

  const rowsToImport = useMemo(() => {
    if (!skipDuplicates) return importPreviewRows;
    return importPreviewRows.filter((r) => !existingNisSet.has(r.nis.trim().toLowerCase()));
  }, [importPreviewRows, skipDuplicates, existingNisSet]);

  const handleConfirmImport = async () => {
    if (rowsToImport.length === 0 || !importClassId) return;
    const targetCls = activeClasses.find((c) => c.id === importClassId);
    if (!targetCls) return;
    setImporting(true);
    try {
      const normalized = rowsToImport.map((row) => ({
        ...row,
        classId: targetCls.id,
        className: targetCls.name,
        academicYear: targetCls.academicYear || settings.activeAcademicYear,
      }));
      const importedCount = await bulkImportStudents(normalized);
      const skipped = skipDuplicates ? importDuplicateCount : 0;
      setImportModalOpen(false);
      setImportPreviewRows([]);
      setImportFileName('');
      if (fileInputRef.current) fileInputRef.current.value = '';
      setFeedback(
        `Berhasil mengimpor ${importedCount} data siswa ke Kelas ${targetCls.name}${
          skipped > 0 ? ` (${skipped} NIS duplikat dilewati)` : ''
        }.`
      );
      setTimeout(() => setFeedback(''), 5000);
    } catch {
      setErrorMsg('Sebagian atau seluruh data siswa gagal diimpor. Periksa koneksi Anda.');
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900">Manajemen Data Siswa</h1>
          <p className="text-sm text-slate-600 mt-1">
            Total {filtered.length} siswa ditampilkan · Gunakan NIS sebagai identitas utama
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isAdmin && (
            <>
              <button
                type="button"
                onClick={() => {
                  if (classFilter !== 'all') {
                    handleDownloadTemplateForClass(classFilter);
                  } else {
                    openImportModal();
                  }
                }}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium text-[#1E3A5F] bg-sky-50 border border-sky-200 hover:bg-sky-100 rounded-lg whitespace-nowrap"
              >
                <FileSpreadsheet className="w-4 h-4" /> Unduh Template
              </button>
              <button
                type="button"
                onClick={openImportModal}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg whitespace-nowrap"
              >
                <Upload className="w-4 h-4" /> Import Excel
              </button>
            </>
          )}
          <button
            type="button"
            onClick={handleExport}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg whitespace-nowrap"
          >
            <Download className="w-4 h-4" /> Export Excel
          </button>
          {isAdmin && (
            <button
              type="button"
              onClick={openAdd}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-[#1E3A5F] hover:bg-[#162C49] rounded-lg whitespace-nowrap"
            >
              <Plus className="w-4 h-4" /> Tambah Siswa
            </button>
          )}
        </div>
      </div>

      {feedback && (
        <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-sm text-emerald-800">
          {feedback}
        </div>
      )}

      {errorMsg && (
        <div
          role="alert"
          className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800"
        >
          {errorMsg}
        </div>
      )}

      {/* Filters */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col sm:flex-row gap-3">
        <input
          type="search"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          placeholder="Cari nama lengkap, NIS, atau NISN..."
          aria-label="Cari siswa"
          className="flex-1 px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-sky-600"
        />
        <select
          value={classFilter}
          onChange={(e) => {
            setClassFilter(e.target.value);
            setPage(1);
          }}
          aria-label="Filter kelas"
          className="px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:border-sky-600"
        >
          <option value="all">Semua Kelas</option>
          {activeClasses.map((c) => (
            <option key={c.id} value={c.id}>
              Kelas {c.name}
            </option>
          ))}
        </select>
      </div>

      {/* Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 text-xs">
              <tr>
                <th className="px-4 py-3 font-semibold">NIS / NISN</th>
                <th className="px-4 py-3 font-semibold">Nama Lengkap</th>
                <th className="px-4 py-3 font-semibold">Kelas</th>
                <th className="px-4 py-3 font-semibold">Orang Tua / HP</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold text-right">Kasus</th>
                <th className="px-4 py-3 font-semibold text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {paginated.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                    Tidak ada data siswa yang sesuai filter.
                  </td>
                </tr>
              ) : (
                paginated.map((s) => (
                  <tr key={s.id} className="hover:bg-slate-50/70">
                    <td className="px-4 py-3 font-mono tabular-nums text-slate-700 whitespace-nowrap">
                      <div className="font-semibold text-slate-900">{s.nis}</div>
                      <div className="text-xs text-slate-400">{s.nisn || '-'}</div>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => onSelectStudent(s)}
                        className="font-semibold text-slate-900 hover:text-sky-700 text-left"
                      >
                        {s.fullName}
                      </button>
                      <div className="text-xs text-slate-500">{s.gender}</div>
                    </td>
                    <td className="px-4 py-3 font-medium text-slate-800 whitespace-nowrap">
                      {s.className}
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      <div>{s.fatherName || s.motherName || s.guardianName || '-'}</div>
                      <div className="text-xs font-mono text-slate-500">{s.parentPhone || '-'}</div>
                    </td>
                    <td className="px-4 py-3 text-slate-700 whitespace-nowrap">
                      {s.status} · <span className="text-slate-500 text-xs">{s.monitoringStatus}</span>
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-semibold tabular-nums">
                      {s.caseCount}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          aria-label={`Lihat profil ${s.fullName}`}
                          onClick={() => onSelectStudent(s)}
                          className="p-1.5 text-slate-600 hover:text-sky-700 hover:bg-sky-50 rounded-md"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                        {isAdmin && (
                          <>
                            <button
                              type="button"
                              aria-label={`Edit ${s.fullName}`}
                              onClick={() => openEdit(s)}
                              className="p-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-md"
                            >
                              <Pencil className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              aria-label={`Hapus ${s.fullName}`}
                              onClick={() => setConfirmDeleteId(s.id)}
                              className="p-1.5 text-slate-500 hover:text-red-700 hover:bg-red-50 rounded-md"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="px-4 py-3 border-t border-slate-200 flex items-center justify-between text-sm text-slate-600">
          <span className="tabular-nums">
            Halaman {safePage} dari {totalPages}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={safePage <= 1}
              onClick={() => setPage((p) => Math.max(1, Math.min(p, totalPages) - 1))}
              className="px-3 py-1.5 border border-slate-200 rounded-md disabled:opacity-40 hover:bg-slate-50"
            >
              Sebelumnya
            </button>
            <button
              type="button"
              disabled={safePage >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="px-3 py-1.5 border border-slate-200 rounded-md disabled:opacity-40 hover:bg-slate-50"
            >
              Berikutnya
            </button>
          </div>
        </div>
      </div>

      {/* Delete Confirmation */}
      {confirmDeleteId && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          {...deleteBackdropProps}
        >
          <div className="bg-white border border-slate-200 rounded-xl max-w-sm w-full p-6">
            <h3 className="text-lg font-bold text-slate-900 mb-2">Konfirmasi Hapus Siswa</h3>
            <p className="text-sm text-slate-600 mb-5">
              Apakah Anda yakin ingin menghapus data siswa ini? Tindakan ini tidak dapat dibatalkan.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmDeleteId(null)}
                className="px-3.5 py-2 text-sm font-medium text-slate-700 bg-slate-100 rounded-lg"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={async () => {
                  await deleteStudent(confirmDeleteId);
                  setConfirmDeleteId(null);
                }}
                className="px-3.5 py-2 text-sm font-semibold text-white bg-red-600 hover:bg-red-700 rounded-lg"
              >
                Ya, Hapus
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add/Edit Student Modal */}
      {modalOpen && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4 overflow-y-auto"
          role="dialog"
          aria-modal="true"
          {...studentModalBackdropProps}
        >
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex items-start justify-between gap-3">
              <h2 className="text-lg font-bold text-slate-900">
                {editingId ? 'Edit Data Siswa' : 'Tambah Data Siswa Baru'}
              </h2>
              <button
                type="button"
                aria-label="Tutup form siswa"
                title="Keluar"
                onClick={() => setModalOpen(false)}
                className="p-1.5 text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 overflow-y-auto space-y-4 text-sm">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">NIS *</label>
                  <input
                    required
                    value={form.nis}
                    onChange={(e) => setForm({ ...form, nis: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">NISN</label>
                  <input
                    value={form.nisn}
                    onChange={(e) => setForm({ ...form, nisn: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Kelas *</label>
                  <select
                    required
                    value={form.classId}
                    onChange={(e) => setForm({ ...form, classId: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg bg-white"
                  >
                    <option value="">Pilih Kelas</option>
                    {activeClasses.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} ({c.academicYear})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="sm:col-span-2">
                  <label className="block font-medium text-slate-700 mb-1">Nama Lengkap *</label>
                  <input
                    required
                    value={form.fullName}
                    onChange={(e) => setForm({ ...form, fullName: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Jenis Kelamin</label>
                  <select
                    value={form.gender}
                    onChange={(e) =>
                      setForm({ ...form, gender: e.target.value as 'Laki-laki' | 'Perempuan' })
                    }
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg bg-white"
                  >
                    <option value="Laki-laki">Laki-laki</option>
                    <option value="Perempuan">Perempuan</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Tempat Lahir</label>
                  <input
                    value={form.birthPlace}
                    onChange={(e) => setForm({ ...form, birthPlace: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Tanggal Lahir</label>
                  <input
                    type="date"
                    value={form.birthDate}
                    onChange={(e) => setForm({ ...form, birthDate: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Agama</label>
                  <input
                    value={form.religion || ''}
                    onChange={(e) => setForm({ ...form, religion: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Nama Ayah</label>
                  <input
                    value={form.fatherName}
                    onChange={(e) => setForm({ ...form, fatherName: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Nama Ibu</label>
                  <input
                    value={form.motherName}
                    onChange={(e) => setForm({ ...form, motherName: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Nama Wali (Opsional)</label>
                  <input
                    value={form.guardianName || ''}
                    onChange={(e) => setForm({ ...form, guardianName: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">HP Siswa</label>
                  <input
                    value={form.studentPhone}
                    onChange={(e) => setForm({ ...form, studentPhone: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">HP Orang Tua/Wali</label>
                  <input
                    value={form.parentPhone}
                    onChange={(e) => setForm({ ...form, parentPhone: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Status Siswa</label>
                  <select
                    value={form.status}
                    onChange={(e) => setForm({ ...form, status: e.target.value as StudentStatus })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg bg-white"
                  >
                    <option value="Aktif">Aktif</option>
                    <option value="Pindah">Pindah</option>
                    <option value="Lulus">Lulus</option>
                    <option value="Keluar">Keluar</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">Alamat Lengkap</label>
                <textarea
                  rows={2}
                  value={form.address}
                  onChange={(e) => setForm({ ...form, address: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg"
                />
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">Catatan Tambahan</label>
                <textarea
                  rows={2}
                  value={form.notes || ''}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  disabled={savingStudent}
                  onClick={() => setModalOpen(false)}
                  className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 rounded-lg disabled:opacity-60"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={savingStudent}
                  className="px-4 py-2 text-sm font-semibold text-white bg-[#1E3A5F] hover:bg-[#162C49] disabled:opacity-60 rounded-lg"
                >
                  {savingStudent ? 'Menyimpan...' : 'Simpan Data Siswa'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Per-Class Bulk Import & Template Modal */}
      {importModalOpen && isAdmin && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          {...importModalBackdropProps}
        >
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-lg shadow-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-slate-900">
                  Import Data Siswa Massal (Per Kelas)
                </h2>
                <p className="text-sm text-slate-500 mt-0.5">
                  Unduh template resmi sistem agar format kolom 100% sesuai database.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setImportModalOpen(false)}
                title="Keluar"
                className="p-1.5 text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors shrink-0"
                aria-label="Tutup modal import"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-5 text-sm">
              {/* Step 1: Pilih Kelas */}
              <div className="space-y-1.5">
                <label className="block font-semibold text-slate-800">
                  1. Pilih Kelas Tujuan *
                </label>
                <select
                  value={importClassId}
                  onChange={(e) => setImportClassId(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg bg-white text-slate-800"
                >
                  <option value="">-- Pilih kelas --</option>
                  {activeClasses.map((c) => (
                    <option key={c.id} value={c.id}>
                      Kelas {c.name} · Tingkat {c.level} · TA {c.academicYear}
                    </option>
                  ))}
                </select>
              </div>

              {/* Step 2: Unduh Template */}
              <div className="p-3.5 rounded-lg bg-sky-50/70 border border-sky-200 space-y-2">
                <div className="font-semibold text-[#1E3A5F]">
                  2. Unduh Format Template Excel Per Kelas
                </div>
                <p className="text-xs text-slate-600">
                  File template sudah dilengkapi header kolom resmi sistem, 1 baris contoh pengisian,
                  dan sheet <strong>Panduan Pengisian</strong>.
                </p>
                <button
                  type="button"
                  disabled={!importClassId}
                  onClick={() => handleDownloadTemplateForClass(importClassId)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-semibold text-white bg-[#1E3A5F] hover:bg-[#162C49] disabled:opacity-50 rounded-lg"
                >
                  <FileSpreadsheet className="w-4 h-4" />
                  Unduh Template{' '}
                  {importClassId
                    ? `Kelas ${activeClasses.find((c) => c.id === importClassId)?.name || ''}`
                    : 'Excel'}
                </button>
              </div>

              {/* Step 3: Unggah File */}
              <div className="space-y-2">
                <div className="font-semibold text-slate-800">
                  3. Unggah File Excel yang Sudah Diisi
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={handleImportFile}
                  className="hidden"
                />
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={!importClassId}
                    onClick={() => fileInputRef.current?.click()}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 disabled:opacity-50 rounded-lg"
                  >
                    <Upload className="w-4 h-4" /> Pilih File Excel (.xlsx)
                  </button>
                  {importFileName && (
                    <span className="text-xs text-slate-600 truncate">{importFileName}</span>
                  )}
                </div>

                {importPreviewRows.length > 0 && (
                  <div className="space-y-3 pt-1">
                    <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs">
                      Ditemukan <strong>{importPreviewRows.length} baris valid</strong> di file. Siap
                      diimpor: <strong>{rowsToImport.length} siswa</strong> ke{' '}
                      <strong>
                        Kelas {activeClasses.find((c) => c.id === importClassId)?.name}
                      </strong>
                      .
                    </div>

                    {importDuplicateCount > 0 && (
                      <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-xs space-y-2">
                        <div>
                          Terdeteksi <strong>{importDuplicateCount} NIS</strong> yang sudah terdaftar
                          di database.
                        </div>
                        <label className="inline-flex items-center gap-2 font-medium cursor-pointer">
                          <input
                            type="checkbox"
                            checked={skipDuplicates}
                            onChange={(e) => setSkipDuplicates(e.target.checked)}
                          />
                          Lewati data dengan NIS duplikat (disarankan)
                        </label>
                      </div>
                    )}

                    <div className="border border-slate-200 rounded-lg overflow-hidden">
                      <div className="px-3 py-1.5 bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                        Pratinjau 5 Baris Pertama
                      </div>
                      <table className="w-full text-xs text-left">
                        <thead className="bg-slate-50/70 text-slate-500 border-b border-slate-200">
                          <tr>
                            <th className="px-2.5 py-1.5 font-semibold">NIS</th>
                            <th className="px-2.5 py-1.5 font-semibold">Nama Lengkap</th>
                            <th className="px-2.5 py-1.5 font-semibold">JK</th>
                            <th className="px-2.5 py-1.5 font-semibold text-right">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {importPreviewRows.slice(0, 5).map((row, idx) => {
                            const isDup = existingNisSet.has(row.nis.trim().toLowerCase());
                            return (
                              <tr key={`${row.nis}_${idx}`}>
                                <td className="px-2.5 py-1.5 font-mono text-slate-600">{row.nis}</td>
                                <td className="px-2.5 py-1.5 font-medium text-slate-800 truncate max-w-[160px]">
                                  {row.fullName}
                                </td>
                                <td className="px-2.5 py-1.5 text-slate-600">
                                  {row.gender === 'Laki-laki' ? 'L' : 'P'}
                                </td>
                                <td className="px-2.5 py-1.5 text-right">
                                  {isDup ? (
                                    <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 font-semibold">
                                      Duplikat
                                    </span>
                                  ) : (
                                    <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 font-semibold">
                                      Baru
                                    </span>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="px-6 py-4 border-t border-slate-200 flex justify-end gap-2">
              <button
                type="button"
                disabled={importing}
                onClick={() => setImportModalOpen(false)}
                className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={importing || !importClassId || rowsToImport.length === 0}
                onClick={handleConfirmImport}
                className="px-4 py-2 text-sm font-semibold text-white bg-[#1E3A5F] hover:bg-[#162C49] disabled:opacity-50 rounded-lg"
              >
                {importing
                  ? 'Mengimpor...'
                  : `Import ${rowsToImport.length || ''} Siswa ke Kelas Ini`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
