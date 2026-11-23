import React, { useEffect, useState } from 'react';
import {
  Save,
  Plus,
  X,
  Download,
  HardDrive,
  CheckCircle2,
  ExternalLink,
  Building2,
  ShieldAlert,
  Users,
  Database,
  Copy,
  Check,
  Upload,
  AlertCircle,
  Loader2,
} from 'lucide-react';
import { useSibk } from '../context/SibkContext';
import type { SystemSettings } from '../types/sibk';
import {
  collectAndDownloadDriveBackupFiles,
  connectGoogleDrive,
  extractDriveFolderId,
  getConnectedDriveEmail,
  getDriveAccessToken,
  subscribeSharedDriveSession,
  uploadPhotoToGoogleDrive,
} from '../lib/googleDrive';
import {
  buildBackupPayload,
  formatRestoreErrorMessage,
  validateAndSummarizeBackupPayload,
  type BackedUpDriveFile,
  type BackupDriveFailure,
  type BackupSummary,
} from '../utils/backupLogic';
import { ConfirmDeleteModal } from '../components/ConfirmDeleteModal';
import { ErrorToast } from '../components/ErrorToast';

type SettingsTab = 'school' | 'rules' | 'counselors' | 'storage';

export const SettingsView: React.FC = () => {
  const {
    currentUser,
    settings,
    saveSettings,
    createFullBackupSnapshot,
    restoreFromBackupJSON,
  } = useSibk();

  const [activeTab, setActiveTab] = useState<SettingsTab>('school');
  const [form, setForm] = useState<SystemSettings>({
    ...settings,
    schoolLogoUrl: settings.schoolLogoUrl || '',
    counselors: settings.counselors || [],
    driveFolderUrl: settings.driveFolderUrl || '',
  });

  useEffect(() => {
    setForm({
      ...settings,
      schoolLogoUrl: settings.schoolLogoUrl || '',
      counselors: settings.counselors || [],
      driveFolderUrl: settings.driveFolderUrl || '',
    });
  }, [settings]);

  const [logoError, setLogoError] = useState('');
  const [errorToast, setErrorToast] = useState('');

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLogoError('');
    setErrorToast('');

    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    if (file.size === 0) {
      const msg = `File logo "${file.name}" kosong (0 KB) dan tidak dapat dimuat.`;
      setLogoError(msg);
      setErrorToast(msg);
      e.target.value = '';
      return;
    }
    if (ext === 'heic' || ext === 'heif' || file.type === 'image/heic' || file.type === 'image/heif') {
      const msg = 'Format HEIC/HEIF tidak didukung. Gunakan logo berformat PNG, JPG, atau WEBP.';
      setLogoError(msg);
      setErrorToast(msg);
      e.target.value = '';
      return;
    }
    if (file.type && !file.type.startsWith('image/')) {
      const msg = `File "${file.name}" bukan file gambar yang valid. Pilih file PNG, JPG, atau WEBP.`;
      setLogoError(msg);
      setErrorToast(msg);
      e.target.value = '';
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      const msg = `Ukuran file logo terlalu besar (${(file.size / (1024 * 1024)).toFixed(1)} MB). Maksimal 10 MB.`;
      setLogoError(msg);
      setErrorToast(msg);
      e.target.value = '';
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      const msg = `Logo "${file.name}" gagal dimuat. Pastikan file gambar tidak rusak dan berformat PNG/JPG/WEBP.`;
      setLogoError(msg);
      setErrorToast(msg);
    };
    img.onload = () => {
      try {
        const maxDim = 220;
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          const mime = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
          setForm((prev) => ({
            ...prev,
            schoolLogoUrl: canvas.toDataURL(mime, 0.85),
          }));
        }
      } catch {
        const msg = 'Gagal memproses logo sekolah. Coba pilih gambar dengan ukuran lebih kecil.';
        setLogoError(msg);
        setErrorToast(msg);
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    };
    img.src = objectUrl;
    e.target.value = '';
  };

  const [newCategory, setNewCategory] = useState('');
  const [newCounselor, setNewCounselor] = useState('');
  const [pendingDelete, setPendingDelete] = useState<{
    type: 'category' | 'counselor';
    value: string;
  } | null>(null);
  const [restorePayload, setRestorePayload] = useState<Record<string, unknown> | null>(null);
  const [restoreSummary, setRestoreSummary] = useState<BackupSummary | null>(null);
  const [restoreFileName, setRestoreFileName] = useState('');
  const [restoreError, setRestoreError] = useState('');
  const [restoring, setRestoring] = useState(false);
  const [restoreProgress, setRestoreProgress] = useState('');
  const [restoreDriveFilesOption, setRestoreDriveFilesOption] = useState(true);
  const [includeDriveInBackup, setIncludeDriveInBackup] = useState(true);
  const [backingUp, setBackingUp] = useState(false);
  const [backupProgress, setBackupProgress] = useState('');
  const [backupReport, setBackupReport] = useState<{
    ok: boolean;
    message: string;
    failedFiles?: BackupDriveFailure[];
  } | null>(null);
  const [savedMsg, setSavedMsg] = useState('');
  const [saving, setSaving] = useState(false);
  const [driveEmail, setDriveEmail] = useState<string | null>(
    getDriveAccessToken() ? getConnectedDriveEmail() : null
  );

  useEffect(() => {
    return subscribeSharedDriveSession(({ email, connected }) => {
      setDriveEmail(connected ? email : null);
    });
  }, []);
  const [driveConnecting, setDriveConnecting] = useState(false);
  const [driveError, setDriveError] = useState('');
  const [testingUpload, setTestingUpload] = useState(false);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    message: string;
    link?: string;
  } | null>(null);

  const parsedFolderId = extractDriveFolderId(form.driveFolderUrl);

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

  const handleTestDriveUpload = async () => {
    setTestingUpload(true);
    setTestResult(null);
    setDriveError('');
    try {
      let token = getDriveAccessToken();
      if (!token) {
        token = await handleConnectDrive();
      }
      if (!token) {
        setTestingUpload(false);
        return;
      }
      const tinyJpeg =
        'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';
      const res = await uploadPhotoToGoogleDrive({
        dataUrl: tinyJpeg,
        fileName: `Tes_Koneksi_SIBK_${Date.now()}.jpg`,
        folderUrlOrId: form.driveFolderUrl,
        accessToken: token,
      });
      setTestResult({
        ok: true,
        message: 'Tes upload berhasil! File tes sudah masuk ke folder Google Drive tujuan.',
        link: res.webViewLink,
      });
    } catch (err) {
      setTestResult({
        ok: false,
        message: err instanceof Error ? err.message : 'Tes upload gagal.',
      });
    } finally {
      setTestingUpload(false);
    }
  };

  const handleSave = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setSaving(true);
    try {
      await saveSettings(form);
      setSavedMsg('Pengaturan sistem berhasil disimpan.');
      setTimeout(() => setSavedMsg(''), 3500);
    } finally {
      setSaving(false);
    }
  };

  const handleAddCategory = () => {
    const val = newCategory.trim();
    if (!val || form.categories.includes(val)) return;
    setForm({ ...form, categories: [...form.categories, val] });
    setNewCategory('');
  };

  const handleRemoveCategory = (cat: string) => {
    setForm({ ...form, categories: form.categories.filter((c) => c !== cat) });
  };

  const handleAddCounselor = () => {
    const val = newCounselor.trim();
    const list = form.counselors || [];
    if (!val || list.includes(val)) return;
    setForm({ ...form, counselors: [...list, val] });
    setNewCounselor('');
  };

  const handleRemoveCounselor = (name: string) => {
    setForm({
      ...form,
      counselors: (form.counselors || []).filter((c) => c !== name),
    });
  };

  const formatBytesLabel = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  const handleBackupJSON = async (withDriveFiles: boolean) => {
    setBackingUp(true);
    setBackupReport(null);
    setBackupProgress('Mengambil seluruh data terbaru dari database Firestore...');

    try {
      const snapshot = await createFullBackupSnapshot();
      let driveFiles: BackedUpDriveFile[] = [];
      let failedFiles: BackupDriveFailure[] = [];
      let folderId: string | null = extractDriveFolderId(
        form.driveFolderUrl || snapshot.settings.driveFolderUrl
      );
      let driveIncluded = false;
      let usedDriveEmail: string | null = null;

      if (withDriveFiles) {
        let token = getDriveAccessToken();
        if (!token) {
          setBackupProgress('Menunggu koneksi akun Google Drive untuk mengunduh foto/dokumen...');
          token = await handleConnectDrive();
        }
        if (!token) {
          setBackingUp(false);
          setBackupProgress('');
          setBackupReport({
            ok: false,
            message:
              'Backup dibatalkan karena akun Google Drive belum terhubung. Hubungkan Google Drive terlebih dahulu atau gunakan tombol "Backup Database Saja".',
          });
          return;
        }

        usedDriveEmail = getConnectedDriveEmail();
        setBackupProgress('Memindai folder & daftar foto kasus di Google Drive...');
        const driveRes = await collectAndDownloadDriveBackupFiles({
          folderUrlOrId: form.driveFolderUrl || snapshot.settings.driveFolderUrl,
          cases: snapshot.cases,
          accessToken: token,
          onProgress: ({ current, total, fileName }) => {
            setBackupProgress(`Mengunduh file Google Drive (${current}/${total}): ${fileName}`);
          },
        });
        driveFiles = driveRes.driveFiles;
        failedFiles = driveRes.failedFiles;
        folderId = driveRes.folderId;
        driveIncluded = true;
      }

      setBackupProgress('Menyusun file backup JSON...');
      const payload = buildBackupPayload({
        exportedAt: new Date().toISOString(),
        exportedBy: currentUser?.email || currentUser?.username || 'Administrator',
        settings: snapshot.settings,
        classes: snapshot.classes,
        students: snapshot.students,
        attendance: snapshot.attendance,
        cases: snapshot.cases,
        counselingLogs: snapshot.counselingLogs,
        parentCalls: snapshot.parentCalls,
        monitoringNotes: snapshot.monitoringNotes,
        schedules: snapshot.schedules,
        users: snapshot.users,
        auditLogs: snapshot.auditLogs,
        driveFiles,
        driveIncluded,
        driveFolderId: folderId,
        driveAccountEmail: usedDriveEmail,
        driveFailedFiles: failedFiles,
      });

      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const dateStr = new Date().toISOString().slice(0, 10);
      a.download = driveIncluded
        ? `Backup_SIBK_Lengkap_Drive_${dateStr}.json`
        : `Backup_SIBK_Database_${dateStr}.json`;
      a.click();
      URL.revokeObjectURL(url);

      const driveSummaryText = driveIncluded
        ? ` serta ${driveFiles.length} file foto/dokumen Google Drive (${formatBytesLabel(
            driveFiles.reduce((acc, f) => acc + (f.sizeBytes || 0), 0)
          )})`
        : ' (database saja, tanpa mengunduh file fisik Google Drive)';

      setBackupReport({
        ok: failedFiles.length === 0,
        message: `Backup berhasil diunduh: ${payload.backupMeta.totalFirestoreDocs} dokumen database${driveSummaryText}.`,
        failedFiles: failedFiles.length > 0 ? failedFiles : undefined,
      });
    } catch (err) {
      setBackupReport({
        ok: false,
        message:
          err instanceof Error
            ? err.message
            : 'Terjadi kesalahan saat menyusun file backup.',
      });
    } finally {
      setBackingUp(false);
      setBackupProgress('');
    }
  };

  const handleSelectRestoreFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setRestoreError('');
    setBackupReport(null);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as Record<string, unknown>;
      const summary = validateAndSummarizeBackupPayload(parsed);
      if (!summary.valid) {
        setRestorePayload(null);
        setRestoreSummary(null);
        setRestoreFileName('');
        setRestoreError(summary.warnings[0] || 'Format file JSON tidak dikenali sebagai file backup SIBK.');
        return;
      }
      setRestorePayload(parsed);
      setRestoreSummary(summary);
      setRestoreFileName(file.name);
      setRestoreDriveFilesOption(summary.counts.driveFiles > 0);
    } catch {
      setRestorePayload(null);
      setRestoreSummary(null);
      setRestoreFileName('');
      setRestoreError('Gagal membaca file JSON. Pastikan file backup valid dan tidak rusak.');
    } finally {
      e.target.value = '';
    }
  };

  const handleExecuteRestore = async () => {
    if (!restorePayload) return;
    setRestoring(true);
    setRestoreError('');
    setRestoreProgress('Mempersiapkan pemulihan data...');

    try {
      let driveAccessToken = getDriveAccessToken();
      const hasDriveBinaries = (restoreSummary?.counts.driveFiles || 0) > 0;

      if (restoreDriveFilesOption && hasDriveBinaries && !driveAccessToken) {
        setRestoreProgress('Menunggu koneksi akun Google Drive untuk memulihkan foto/dokumen...');
        driveAccessToken = await handleConnectDrive();
        if (!driveAccessToken) {
          setRestoring(false);
          setRestoreProgress('');
          setRestoreError(
            'Koneksi Google Drive dibatalkan. Hubungkan Google Drive atau hilangkan centang opsi pemulihan file Drive jika hanya ingin memulihkan database.'
          );
          return;
        }
      }

      const result = await restoreFromBackupJSON(restorePayload, {
        restoreDriveFiles: restoreDriveFilesOption && hasDriveBinaries,
        targetFolderUrl: form.driveFolderUrl || settings.driveFolderUrl,
        driveAccessToken,
        onProgress: (msg) => setRestoreProgress(msg),
      });

      setRestorePayload(null);
      setRestoreSummary(null);
      setRestoreFileName('');

      const parts = [`${result.restoredDocs} dokumen database berhasil dipulihkan`];
      if (result.skippedAuditLogs > 0) {
        parts.push(`${result.skippedAuditLogs} log audit lama dipertahankan`);
      }
      if (result.restoredDriveFiles > 0) {
        parts.push(`${result.restoredDriveFiles} file foto/dokumen diunggah ulang ke Google Drive`);
      }
      if (result.reusedExistingDriveFiles > 0) {
        parts.push(`${result.reusedExistingDriveFiles} file Google Drive masih aktif & tertaut otomatis`);
      }

      setSavedMsg(`Pemulihan selesai! ${parts.join(', ')}.`);
      if (result.driveWarnings.length > 0) {
        setRestoreError(result.driveWarnings.join(' '));
      }
      setTimeout(() => setSavedMsg(''), 8000);
    } catch (err) {
      setRestoreError(formatRestoreErrorMessage(err));
    } finally {
      setRestoring(false);
      setRestoreProgress('');
    }
  };

  const tabs: { id: SettingsTab; label: string; icon: React.ReactNode; badge?: string }[] = [
    {
      id: 'school',
      label: 'Identitas Sekolah',
      icon: <Building2 className="w-4 h-4" />,
    },
    {
      id: 'rules',
      label: 'Batas & Kategori BK',
      icon: <ShieldAlert className="w-4 h-4" />,
      badge: String(form.categories.length),
    },
    {
      id: 'counselors',
      label: 'Guru BK Pendamping',
      icon: <Users className="w-4 h-4" />,
      badge: String((form.counselors || []).length),
    },
    {
      id: 'storage',
      label: 'Google Drive & Backup',
      icon: <Database className="w-4 h-4" />,
    },
  ];

  return (
    <div className="space-y-5 w-full">
      {/* Header with primary Save action */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900">Pengaturan Sistem SIBK</h1>
          <p className="text-sm text-slate-600 mt-1">
            Kelola identitas sekolah, aturan kasus BK, daftar guru BK, dan penyimpanan Google Drive
            dalam tab terstruktur.
          </p>
        </div>
        <button
          type="button"
          disabled={saving}
          onClick={() => handleSave()}
          className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-[#1E3A5F] hover:bg-[#162C49] rounded-lg self-start sm:self-auto shadow-xs disabled:opacity-60"
        >
          <Save className="w-4 h-4" />
          {saving ? 'Menyimpan...' : 'Simpan Semua Pengaturan'}
        </button>
      </div>

      {savedMsg && (
        <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-sm text-emerald-800 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{savedMsg}</span>
        </div>
      )}

      {/* Clean Tab Navigation */}
      <div className="bg-white border border-slate-200 rounded-xl p-1.5 flex flex-wrap gap-1">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 min-w-[140px] inline-flex items-center justify-center gap-2 px-3.5 py-2.5 rounded-lg text-sm font-semibold transition-colors ${
                isActive
                  ? 'bg-[#1E3A5F] text-white shadow-xs'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              {tab.icon}
              <span>{tab.label}</span>
              {tab.badge !== undefined && (
                <span
                  className={`px-1.5 py-0.5 rounded text-xs font-mono ${
                    isActive ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  {tab.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      <form onSubmit={handleSave} className="text-sm">
        {/* TAB 1: Identitas Sekolah & Tahun Ajaran */}
        {activeTab === 'school' && (
          <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
            <div className="border-b border-slate-100 pb-3">
              <h2 className="text-base font-bold text-slate-900">
                Identitas Sekolah & Tahun Ajaran Aktif
              </h2>
              <p className="text-sm text-slate-500 mt-0.5">
                Informasi dan logo ini digunakan otomatis sebagai Kop Surat resmi pada laporan PDF,
                Excel, dan surat pemanggilan orang tua.
              </p>
            </div>

            {/* School Logo Uploader */}
            <div className="flex flex-col sm:flex-row sm:items-center gap-4 p-4 rounded-xl bg-slate-50 border border-slate-200">
              <div className="w-16 h-16 rounded-xl border border-slate-200 bg-white flex items-center justify-center overflow-hidden shrink-0">
                {form.schoolLogoUrl ? (
                  <img
                    src={form.schoolLogoUrl}
                    alt="Logo Sekolah"
                    className="w-full h-full object-contain p-1"
                  />
                ) : (
                  <Building2 className="w-7 h-7 text-slate-300" />
                )}
              </div>
              <div className="flex-1 min-w-0 space-y-1">
                <div className="font-semibold text-slate-900">Logo Sekolah (Kop Laporan PDF)</div>
                <p className="text-xs text-slate-500">
                  Unggah logo sekolah format PNG atau JPG. Logo otomatis tampil di sisi kiri Kop
                  Surat saat mencetak laporan PDF &amp; surat pemanggilan.
                </p>
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-slate-300 hover:bg-slate-100 text-slate-700 font-medium cursor-pointer text-sm">
                    <Upload className="w-4 h-4" />
                    <span>{form.schoolLogoUrl ? 'Ganti Logo' : 'Unggah Logo Sekolah'}</span>
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      onChange={handleLogoUpload}
                      className="hidden"
                    />
                  </label>
                  {form.schoolLogoUrl && (
                    <button
                      type="button"
                      onClick={() => setForm({ ...form, schoolLogoUrl: '' })}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-red-700 hover:bg-red-50 font-medium text-sm"
                    >
                      <X className="w-4 h-4" /> Hapus Logo
                    </button>
                  )}
                </div>
                {logoError && (
                  <div
                    role="alert"
                    className="mt-2 p-2.5 rounded-lg bg-red-50 border border-red-200 flex items-start gap-2 text-xs text-red-800"
                  >
                    <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                    <span className="flex-1 font-medium">{logoError}</span>
                    <button
                      type="button"
                      onClick={() => setLogoError('')}
                      aria-label="Tutup pesan error logo"
                      className="text-red-500 hover:text-red-800"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block font-medium text-slate-700 mb-1">
                  Baris 1 Kop Surat (Pemerintah Daerah)
                </label>
                <input
                  placeholder="PEMERINTAH KABUPATEN BULELENG"
                  value={form.letterheadLine1 || ''}
                  onChange={(e) => setForm({ ...form, letterheadLine1: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:border-sky-600"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">
                  Baris 2 Kop Surat (Dinas Pendidikan)
                </label>
                <input
                  placeholder="DINAS PENDIDIKAN PEMUDA DAN OLAHRAGA"
                  value={form.letterheadLine2 || ''}
                  onChange={(e) => setForm({ ...form, letterheadLine2: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:border-sky-600"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">
                  Baris 3 Kop Surat (Nama Sekolah)
                </label>
                <input
                  placeholder="SMP NEGERI 6 SINGARAJA"
                  value={form.schoolName}
                  onChange={(e) => setForm({ ...form, schoolName: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:border-sky-600"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Telepon Sekolah</label>
                <input
                  placeholder="(0362) 21xxx"
                  value={form.schoolPhone}
                  onChange={(e) => setForm({ ...form, schoolPhone: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:border-sky-600"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block font-medium text-slate-700 mb-1">
                  Baris 4 Kop Surat (Jalan, Kode Pos, Provinsi)
                </label>
                <input
                  placeholder="Jl. ..., Kode Pos 81119, Bali"
                  value={form.schoolAddress}
                  onChange={(e) => setForm({ ...form, schoolAddress: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:border-sky-600"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block font-medium text-slate-700 mb-1">
                  Baris 5 Kop Surat (Alamat Email &amp; Sosial Media)
                </label>
                <input
                  placeholder="Email: smpn6singaraja@gmail.com · Website/IG: @smpn6singaraja"
                  value={form.schoolEmailSocial || ''}
                  onChange={(e) => setForm({ ...form, schoolEmailSocial: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:border-sky-600"
                />
              </div>
              <div className="sm:col-span-2 p-4 rounded-xl bg-slate-50 border border-slate-200">
                <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2.5">
                  Pratinjau Kop Surat PDF
                </div>
                <div className="bg-white border border-slate-200 rounded-lg p-4">
                  <div className="flex items-center gap-4">
                    {form.schoolLogoUrl && (
                      <img
                        src={form.schoolLogoUrl}
                        alt="Logo Kop"
                        className="w-14 h-14 object-contain shrink-0"
                      />
                    )}
                    <div className="flex-1 text-center leading-tight space-y-0.5">
                      <div className="text-xs font-bold text-slate-900 uppercase">
                        {form.letterheadLine1 || 'PEMERINTAH KABUPATEN BULELENG'}
                      </div>
                      <div className="text-xs font-bold text-slate-900 uppercase">
                        {form.letterheadLine2 || 'DINAS PENDIDIKAN PEMUDA DAN OLAHRAGA'}
                      </div>
                      <div className="text-base font-extrabold text-slate-950 uppercase">
                        {form.schoolName || 'SMP NEGERI 6 SINGARAJA'}
                      </div>
                      <div className="text-xs text-slate-600">
                        {form.schoolAddress || 'Alamat sekolah...'}
                        {form.schoolPhone &&
                        !(form.schoolAddress || '')
                          .toLowerCase()
                          .includes(form.schoolPhone.toLowerCase())
                          ? `, Telp. ${form.schoolPhone}`
                          : ''}
                      </div>
                      {form.schoolEmailSocial && (
                        <div className="text-xs text-slate-500">{form.schoolEmailSocial}</div>
                      )}
                    </div>
                  </div>
                  <div className="mt-3 border-t-2 border-slate-900 pt-0.5">
                    <div className="border-t border-slate-900" />
                  </div>
                </div>
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Nama Kepala Sekolah</label>
                <input
                  value={form.principalName}
                  onChange={(e) => setForm({ ...form, principalName: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:border-sky-600"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">NIP Kepala Sekolah</label>
                <input
                  value={form.principalNip}
                  onChange={(e) => setForm({ ...form, principalNip: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg font-mono focus:outline-none focus:border-sky-600"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Tahun Ajaran Aktif</label>
                <input
                  value={form.activeAcademicYear}
                  onChange={(e) => setForm({ ...form, activeAcademicYear: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg font-mono focus:outline-none focus:border-sky-600"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Semester Aktif</label>
                <select
                  value={form.activeSemester}
                  onChange={(e) =>
                    setForm({ ...form, activeSemester: e.target.value as 'Ganjil' | 'Genap' })
                  }
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg bg-white focus:outline-none focus:border-sky-600"
                >
                  <option value="Ganjil">Ganjil</option>
                  <option value="Genap">Genap</option>
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className="block font-medium text-slate-700 mb-1">
                  Format Nomor Surat / Laporan
                </label>
                <input
                  value={form.reportNumberFormat}
                  onChange={(e) => setForm({ ...form, reportNumberFormat: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg font-mono focus:outline-none focus:border-sky-600"
                />
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: Batas Peringatan & Kategori Permasalahan */}
        {activeTab === 'rules' && (
          <div className="space-y-5">
            <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
              <div className="border-b border-slate-100 pb-3">
                <h2 className="text-base font-bold text-slate-900">
                  Batas Peringatan Kasus & Pemanggilan Orang Tua
                </h2>
                <p className="text-sm text-slate-500 mt-0.5">
                  Notifikasi otomatis muncul di Dashboard saat jumlah kasus baru siswa mencapai
                  batas berikut.
                </p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200/80">
                  <label className="block font-medium text-slate-700 mb-1.5">
                    Peringatan Pertama (Kasus ke-)
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={form.warningThreshold1}
                    onChange={(e) =>
                      setForm({ ...form, warningThreshold1: Number(e.target.value) || 1 })
                    }
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg bg-white font-mono"
                  />
                </div>
                <div className="p-3.5 rounded-lg bg-amber-50/50 border border-amber-200/70">
                  <label className="block font-medium text-amber-900 mb-1.5">
                    Peringatan Kedua (Kasus ke-)
                  </label>
                  <input
                    type="number"
                    min={2}
                    value={form.warningThreshold2}
                    onChange={(e) =>
                      setForm({ ...form, warningThreshold2: Number(e.target.value) || 2 })
                    }
                    className="w-full px-3 py-2 border border-amber-200 rounded-lg bg-white font-mono"
                  />
                </div>
                <div className="p-3.5 rounded-lg bg-red-50/50 border border-red-200/70">
                  <label className="block font-medium text-red-900 mb-1.5">
                    Batas Maksimal / Panggil Ortu
                  </label>
                  <input
                    type="number"
                    min={2}
                    value={form.maxCaseThreshold}
                    onChange={(e) =>
                      setForm({ ...form, maxCaseThreshold: Number(e.target.value) || 4 })
                    }
                    className="w-full px-3 py-2 border border-red-200 rounded-lg bg-white font-mono"
                  />
                </div>
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
              <div className="border-b border-slate-100 pb-3">
                <h2 className="text-base font-bold text-slate-900">
                  Batas Ketidakhadiran Siswa (Pemanggilan ke BK)
                </h2>
                <p className="text-sm text-slate-500 mt-0.5">
                  Jika jumlah Sakit, Izin, atau Alfa siswa mencapai/melewati batas berikut, sistem
                  otomatis menampilkan notifikasi peringatan pemanggilan siswa ke BK di Dashboard
                  beserta angka notifikasi di samping menu Dashboard.
                </p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="p-3.5 rounded-lg bg-sky-50/50 border border-sky-200/70">
                  <label className="block font-medium text-sky-900 mb-1.5">
                    Batas Maksimal Sakit (hari)
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={form.maxSickThreshold ?? 5}
                    onChange={(e) =>
                      setForm({ ...form, maxSickThreshold: Number(e.target.value) || 1 })
                    }
                    className="w-full px-3 py-2 border border-sky-200 rounded-lg bg-white font-mono"
                  />
                </div>
                <div className="p-3.5 rounded-lg bg-amber-50/50 border border-amber-200/70">
                  <label className="block font-medium text-amber-900 mb-1.5">
                    Batas Maksimal Izin (hari)
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={form.maxPermissionThreshold ?? 5}
                    onChange={(e) =>
                      setForm({ ...form, maxPermissionThreshold: Number(e.target.value) || 1 })
                    }
                    className="w-full px-3 py-2 border border-amber-200 rounded-lg bg-white font-mono"
                  />
                </div>
                <div className="p-3.5 rounded-lg bg-red-50/50 border border-red-200/70">
                  <label className="block font-medium text-red-900 mb-1.5">
                    Batas Maksimal Alfa (hari)
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={form.maxAlphaThreshold ?? 3}
                    onChange={(e) =>
                      setForm({ ...form, maxAlphaThreshold: Number(e.target.value) || 1 })
                    }
                    className="w-full px-3 py-2 border border-red-200 rounded-lg bg-white font-mono"
                  />
                </div>
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
              <div className="border-b border-slate-100 pb-3">
                <h2 className="text-base font-bold text-slate-900">
                  Kategori Permasalahan Siswa
                </h2>
                <p className="text-sm text-slate-500 mt-0.5">
                  Daftar kategori yang tersedia saat mencatat kasus baru.
                </p>
              </div>
              <div className="flex gap-2">
                <input
                  placeholder="Tambah kategori baru (contoh: Perundungan, Kedisiplinan)..."
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddCategory();
                    }
                  }}
                  className="flex-1 px-3 py-2 border border-slate-200 rounded-lg"
                />
                <button
                  type="button"
                  onClick={handleAddCategory}
                  className="inline-flex items-center gap-1 px-3.5 py-2 text-sm font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg"
                >
                  <Plus className="w-4 h-4" /> Tambah
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                {form.categories.map((cat) => (
                  <div
                    key={cat}
                    className="px-3 py-2 flex items-center justify-between border border-slate-200 rounded-lg bg-slate-50/60"
                  >
                    <span className="text-slate-800 font-medium truncate">{cat}</span>
                    <button
                      type="button"
                      aria-label={`Hapus kategori ${cat}`}
                      onClick={() => setPendingDelete({ type: 'category', value: cat })}
                      className="p-1 text-slate-400 hover:text-red-700 shrink-0"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: Daftar Guru BK Pendamping */}
        {activeTab === 'counselors' && (
          <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
            <div className="border-b border-slate-100 pb-3">
              <h2 className="text-base font-bold text-slate-900">
                Daftar Nama Guru BK Pendamping
              </h2>
              <p className="text-sm text-slate-500 mt-0.5">
                Nama-nama di bawah ini akan muncul sebagai pilihan Guru BK Pendamping saat mencatat
                kasus dan sesi konseling.
              </p>
            </div>
            <div className="flex gap-2">
              <input
                placeholder="Tambah nama guru BK (contoh: Drs. Agus Salim, M.Pd.)..."
                value={newCounselor}
                onChange={(e) => setNewCounselor(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddCounselor();
                  }
                }}
                className="flex-1 px-3 py-2 border border-slate-200 rounded-lg"
              />
              <button
                type="button"
                onClick={handleAddCounselor}
                className="inline-flex items-center gap-1 px-3.5 py-2 text-sm font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg"
              >
                <Plus className="w-4 h-4" /> Tambah Guru BK
              </button>
            </div>
            {(form.counselors || []).length === 0 ? (
              <div className="px-4 py-8 text-center text-slate-400 border border-dashed border-slate-200 rounded-xl">
                Belum ada nama guru BK terdaftar. Tambahkan nama guru BK di atas.
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {(form.counselors || []).map((name) => (
                  <div
                    key={name}
                    className="px-3.5 py-2.5 flex items-center justify-between border border-slate-200 rounded-lg bg-slate-50/60"
                  >
                    <span className="text-slate-800 font-medium">{name}</span>
                    <button
                      type="button"
                      aria-label={`Hapus guru BK ${name}`}
                      onClick={() => setPendingDelete({ type: 'counselor', value: name })}
                      className="p-1 text-slate-400 hover:text-red-700"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* TAB 4: Google Drive & Backup Data */}
        {activeTab === 'storage' && (
          <div className="space-y-5">
            {/* Google Drive Photo Storage Settings */}
            <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
                <div>
                  <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                    <HardDrive className="w-4 h-4 text-sky-700" />
                    Penyimpanan Foto Dokumentasi (Google Drive Bersama)
                  </h2>
                  <p className="text-sm text-slate-500 mt-0.5">
                    Bagikan (Share) folder Google Drive di bawah ini sebagai <strong>Editor</strong>{' '}
                    ke email guru BK (atau <em>Siapa saja yang memiliki link → Editor</em>) agar
                    guru dengan akun Google berbeda tetap bisa mengunggah foto ke folder ini.
                  </p>
                </div>
                {driveEmail ? (
                  <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 font-medium shrink-0 text-sm">
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Terhubung: {driveEmail}</span>
                  </div>
                ) : (
                  <button
                    type="button"
                    disabled={driveConnecting}
                    onClick={() => handleConnectDrive()}
                    className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 font-medium shadow-xs shrink-0 disabled:opacity-60 text-sm"
                  >
                    <svg className="w-4 h-4" viewBox="0 0 48 48" aria-hidden="true">
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

              {driveError && (
                <div className="p-2.5 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
                  {driveError}
                </div>
              )}

              <div>
                <label className="block font-medium text-slate-700 mb-1">
                  Link atau ID Folder Google Drive Tujuan
                </label>
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="text"
                    placeholder="Tempel ID Folder (misal: 1AbCdEf...) atau link https://drive.google.com/drive/folders/..."
                    value={form.driveFolderUrl || ''}
                    onChange={(e) => setForm({ ...form, driveFolderUrl: e.target.value })}
                    className="flex-1 px-3 py-2 border border-slate-200 rounded-lg font-mono text-sm"
                  />
                  <button
                    type="button"
                    disabled={testingUpload}
                    onClick={handleTestDriveUpload}
                    className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-sky-700 hover:bg-sky-800 disabled:opacity-50 shrink-0"
                  >
                    {testingUpload ? 'Menguji...' : 'Tes Upload'}
                  </button>
                </div>
                <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-xs">
                  {form.driveFolderUrl?.trim() ? (
                    parsedFolderId ? (
                      <span className="text-emerald-700 font-medium">
                        ID Folder terdeteksi: <code className="font-mono">{parsedFolderId}</code>
                      </span>
                    ) : (
                      <span className="text-amber-700 font-medium">
                        Format link/ID folder belum dikenali.
                      </span>
                    )
                  ) : (
                    <span className="text-slate-500">
                      Jika dikosongkan, foto disimpan di My Drive masing-masing akun Google yang
                      terhubung.
                    </span>
                  )}
                  {parsedFolderId && (
                    <a
                      href={`https://drive.google.com/drive/folders/${parsedFolderId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-sky-700 hover:underline font-medium"
                    >
                      Buka Folder <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  )}
                </div>
              </div>

              {testResult && (
                <div
                  className={`p-3 rounded-lg border text-sm flex flex-wrap items-center justify-between gap-2 ${
                    testResult.ok
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                      : 'bg-red-50 border-red-200 text-red-700'
                  }`}
                >
                  <span>{testResult.message}</span>
                  {testResult.link && (
                    <a
                      href={testResult.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 font-semibold underline"
                    >
                      Lihat File Tes <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  )}
                </div>
              )}
            </div>

            {/* Backup & Restore Database JSON + Google Drive Files */}
            <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
              <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
                <div className="space-y-2 max-w-2xl">
                  <h2 className="text-base font-bold text-slate-900">
                    Cadangan Data Sistem &amp; Dokumen Foto Google Drive (Backup Lengkap)
                  </h2>
                  <p className="text-sm text-slate-500">
                    Mencadangkan seluruh 11 koleksi database Firestore (pengaturan, logo sekolah,
                    kelas, siswa, absensi, kasus BK, konseling, pemanggilan orang tua, pemantauan,
                    jadwal BK, pengguna, dan audit log) beserta seluruh file foto/dokumen di folder
                    Google Drive &amp; lampiran kasus ke dalam satu file <code className="font-mono">.json</code>.
                  </p>

                  <label className="inline-flex items-start gap-2.5 pt-1 text-xs sm:text-sm text-slate-700 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={includeDriveInBackup}
                      onChange={(e) => setIncludeDriveInBackup(e.target.checked)}
                      disabled={backingUp}
                      className="mt-0.5 w-4 h-4 rounded border-slate-300 text-[#1E3A5F] focus:ring-[#1E3A5F]"
                    />
                    <span>
                      <strong>Sertakan seluruh file foto &amp; dokumen dari Google Drive</strong>{' '}
                      <span className="text-slate-500">
                        ({driveEmail
                          ? `Siap mengunduh dari akun ${driveEmail}`
                          : 'Perlu menghubungkan akun Google Drive saat backup dimulai'}
                        )
                      </span>
                    </span>
                  </label>
                </div>

                <div className="flex flex-col sm:flex-row gap-2 shrink-0 self-start">
                  <button
                    type="button"
                    disabled={backingUp}
                    onClick={() => handleBackupJSON(includeDriveInBackup)}
                    className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-[#1E3A5F] hover:bg-[#162C49] disabled:opacity-60 rounded-lg shadow-xs"
                  >
                    {backingUp ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Download className="w-4 h-4" />
                    )}
                    {backingUp
                      ? 'Menyiapkan Backup...'
                      : includeDriveInBackup
                      ? 'Unduh Backup Lengkap (+ Drive)'
                      : 'Unduh Backup Database Saja'}
                  </button>
                </div>
              </div>

              {backupProgress && (
                <div className="p-3 rounded-lg bg-sky-50 border border-sky-200 text-xs sm:text-sm text-sky-900 flex items-center gap-2.5">
                  <Loader2 className="w-4 h-4 animate-spin text-sky-700 shrink-0" />
                  <span>{backupProgress}</span>
                </div>
              )}

              {backupReport && (
                <div
                  className={`p-3.5 rounded-lg border text-xs sm:text-sm space-y-2 ${
                    backupReport.ok
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                      : 'bg-amber-50 border-amber-200 text-amber-900'
                  }`}
                >
                  <div className="flex items-start gap-2">
                    {backupReport.ok ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
                    ) : (
                      <AlertCircle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                    )}
                    <span>{backupReport.message}</span>
                  </div>
                  {backupReport.failedFiles && backupReport.failedFiles.length > 0 && (
                    <div className="pl-6 space-y-1 text-xs text-amber-800">
                      <div className="font-semibold">
                        Catatan file Google Drive ({backupReport.failedFiles.length} dilewati):
                      </div>
                      <ul className="list-disc pl-4 space-y-0.5">
                        {backupReport.failedFiles.slice(0, 5).map((f, idx) => (
                          <li key={`${f.fileId}-${idx}`}>
                            <span className="font-mono">{f.name || f.fileId}</span>: {f.reason}
                          </li>
                        ))}
                        {backupReport.failedFiles.length > 5 && (
                          <li>...dan {backupReport.failedFiles.length - 5} file lainnya.</li>
                        )}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              <div className="border-t border-slate-100 pt-5 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <h3 className="text-base font-bold text-slate-900">
                      Pulihkan Data &amp; Foto Google Drive (Restore JSON)
                    </h3>
                    <p className="text-sm text-slate-500 mt-0.5">
                      Unggah file <code className="font-mono">.json</code> hasil backup. Seluruh
                      koleksi database dipulihkan secara batch ke Firebase Firestore, dan file
                      foto/dokumen Drive yang hilang atau pindah akun otomatis diunggah ulang serta
                      ditautkan kembali ke data kasus.
                    </p>
                  </div>
                  <label className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-[#1E3A5F] bg-sky-50 hover:bg-sky-100 border border-sky-200 rounded-lg cursor-pointer shrink-0 self-start sm:self-auto">
                    <Upload className="w-4 h-4" />
                    <span>Pilih File Backup (.json)</span>
                    <input
                      type="file"
                      accept=".json,application/json"
                      onChange={handleSelectRestoreFile}
                      className="hidden"
                    />
                  </label>
                </div>

                {restoreError && (
                  <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700 flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{restoreError}</span>
                  </div>
                )}

                {restoreProgress && (
                  <div className="p-3 rounded-lg bg-sky-50 border border-sky-200 text-xs sm:text-sm text-sky-900 flex items-center gap-2.5">
                    <Loader2 className="w-4 h-4 animate-spin text-sky-700 shrink-0" />
                    <span>{restoreProgress}</span>
                  </div>
                )}

                {restorePayload && restoreSummary && (
                  <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 space-y-3.5 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="font-semibold text-amber-950">
                        Siap Memulihkan File: <span className="font-mono">{restoreFileName}</span>
                        {restoreSummary.exportedAt && (
                          <span className="ml-2 text-xs font-normal text-amber-800">
                            (Diekspor: {new Date(restoreSummary.exportedAt).toLocaleString('id-ID')})
                          </span>
                        )}
                      </div>
                      <button
                        type="button"
                        disabled={restoring}
                        onClick={() => {
                          setRestorePayload(null);
                          setRestoreSummary(null);
                          setRestoreFileName('');
                        }}
                        className="text-amber-800 hover:underline text-xs disabled:opacity-50"
                      >
                        Batalkan
                      </button>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 text-xs text-amber-900">
                      <div>
                        Kelas: <strong>{restoreSummary.counts.classes}</strong>
                      </div>
                      <div>
                        Siswa: <strong>{restoreSummary.counts.students}</strong>
                      </div>
                      <div>
                        Absensi: <strong>{restoreSummary.counts.attendance}</strong>
                      </div>
                      <div>
                        Kasus BK: <strong>{restoreSummary.counts.cases}</strong>
                      </div>
                      <div>
                        Konseling: <strong>{restoreSummary.counts.counselingLogs}</strong>
                      </div>
                      <div>
                        Panggil Ortu: <strong>{restoreSummary.counts.parentCalls}</strong>
                      </div>
                      <div>
                        Pemantauan: <strong>{restoreSummary.counts.monitoringNotes}</strong>
                      </div>
                      <div>
                        Jadwal BK: <strong>{restoreSummary.counts.schedules}</strong>
                      </div>
                      <div>
                        Pengguna: <strong>{restoreSummary.counts.users}</strong>
                      </div>
                      <div>
                        Audit Log: <strong>{restoreSummary.counts.auditLogs}</strong>
                      </div>
                      <div>
                        Pengaturan: <strong>{restoreSummary.hasSettings ? 'Ada' : 'Tidak ada'}</strong>
                      </div>
                      <div>
                        File Google Drive:{' '}
                        <strong>
                          {restoreSummary.counts.driveFiles > 0
                            ? `${restoreSummary.counts.driveFiles} file (${formatBytesLabel(
                                restoreSummary.totalDriveBytes
                              )})`
                            : '0 file'}
                        </strong>
                      </div>
                    </div>

                    {restoreSummary.warnings.length > 0 && (
                      <div className="p-2.5 rounded-lg bg-amber-100/80 border border-amber-300 text-xs text-amber-950">
                        {restoreSummary.warnings.join(' ')}
                      </div>
                    )}

                    {restoreSummary.counts.driveFiles > 0 && (
                      <label className="flex items-start gap-2.5 text-xs text-amber-950 bg-white/70 border border-amber-200 rounded-lg p-2.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={restoreDriveFilesOption}
                          onChange={(e) => setRestoreDriveFilesOption(e.target.checked)}
                          disabled={restoring}
                          className="mt-0.5 w-4 h-4 rounded border-amber-400 text-amber-700 focus:ring-amber-600"
                        />
                        <span>
                          <strong>
                            Pulihkan &amp; unggah ulang {restoreSummary.counts.driveFiles} file foto/dokumen
                            ke Google Drive
                          </strong>{' '}
                          (jika file asli di Drive masih ada di folder yang sama maka ditautkan otomatis;
                          jika terhapus atau beda akun Google, otomatis diunggah ulang &amp; tautan
                          kasus diperbarui).
                        </span>
                      </label>
                    )}

                    <div className="flex justify-end">
                      <button
                        type="button"
                        disabled={restoring}
                        onClick={handleExecuteRestore}
                        className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-amber-700 hover:bg-amber-800 disabled:opacity-50 rounded-lg"
                      >
                        {restoring ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Upload className="w-4 h-4" />
                        )}
                        {restoring ? 'Memulihkan Data...' : 'Pulihkan ke Database Sekarang'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </form>

      <ConfirmDeleteModal
        open={Boolean(pendingDelete)}
        title={
          pendingDelete?.type === 'category'
            ? 'Hapus Kategori Permasalahan?'
            : 'Hapus Nama Guru BK Pendamping?'
        }
        itemName={pendingDelete?.value}
        description="Item ini akan dihapus dari daftar pengaturan. Jangan lupa klik Simpan Semua Pengaturan setelah selesai."
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          if (!pendingDelete) return;
          if (pendingDelete.type === 'category') {
            handleRemoveCategory(pendingDelete.value);
          } else {
            handleRemoveCounselor(pendingDelete.value);
          }
          setPendingDelete(null);
        }}
      />

      <ErrorToast message={errorToast} onClose={() => setErrorToast('')} />
    </div>
  );
};
