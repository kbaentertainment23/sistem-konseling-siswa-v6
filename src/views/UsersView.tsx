import React, { useMemo, useState } from 'react';
import {
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Pencil,
  Plus,
  Shield,
  Trash2,
  UserCheck,
  UserX,
  X,
} from 'lucide-react';
import { useSibk } from '../context/SibkContext';
import type { UserAccount, UserRole } from '../types/sibk';
import { ConfirmDeleteModal } from '../components/ConfirmDeleteModal';

const DEFAULT_BOOTSTRAP_ACCOUNTS: UserAccount[] = [
  {
    id: 'sys_admin',
    uid: 'sys_admin',
    name: 'Administrator SIBK',
    username: 'admin123',
    password: 'admin123',
    email: 'admin@sibk.local',
    role: 'Administrator',
    active: true,
    createdAt: '2025-07-01T00:00:00.000Z',
  },
  {
    id: 'sys_guru',
    uid: 'sys_guru',
    name: 'Guru BK',
    username: 'guru123',
    password: 'guru123',
    email: 'guru@sibk.local',
    role: 'Guru BK',
    active: true,
    createdAt: '2025-07-01T00:00:00.000Z',
  },
];

export const UsersView: React.FC = () => {
  const { users, classes, auditLogs, currentUser, saveUserAccount, deleteUserAccount } = useSibk();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<UserRole>('Guru BK');
  const [assignedClassId, setAssignedClassId] = useState('');
  const [active, setActive] = useState(true);

  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<UserAccount | null>(null);

  // Merge Firestore users with default bootstrap accounts (if not yet customized in Firestore)
  const displayedUsers = useMemo(() => {
    const map = new Map<string, UserAccount>();
    for (const def of DEFAULT_BOOTSTRAP_ACCOUNTS) {
      map.set(def.id, def);
    }
    for (const u of users) {
      map.set(u.id, u);
    }
    const roleOrder: Record<UserRole, number> = {
      Administrator: 0,
      'Guru BK': 1,
      'Wali Kelas': 2,
    };
    return Array.from(map.values()).sort((a, b) => {
      const rDiff = (roleOrder[a.role] ?? 9) - (roleOrder[b.role] ?? 9);
      if (rDiff !== 0) return rDiff;
      return a.name.localeCompare(b.name, 'id');
    });
  }, [users]);

  const resetForm = () => {
    setEditingId(null);
    setName('');
    setUsername('');
    setPassword('');
    setShowPassword(false);
    setEmail('');
    setRole('Guru BK');
    setAssignedClassId('');
    setActive(true);
  };

  const startEdit = (acc: UserAccount) => {
    setEditingId(acc.id);
    setName(acc.name);
    setUsername(acc.username || '');
    setPassword('');
    setShowPassword(false);
    setEmail(acc.email || '');
    setRole(acc.role);
    setAssignedClassId(acc.assignedClassId || '');
    setActive(acc.active !== false);
    setFeedback(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);

    const cleanName = name.trim();
    const cleanUsername = username.trim().toLowerCase().replace(/\s+/g, '');
    if (!cleanName || !cleanUsername) {
      setFeedback({ type: 'error', text: 'Nama lengkap dan username wajib diisi.' });
      return;
    }

    const duplicate = displayedUsers.find(
      (u) => u.id !== editingId && (u.username || '').trim().toLowerCase() === cleanUsername
    );
    if (duplicate) {
      setFeedback({
        type: 'error',
        text: `Username "${cleanUsername}" sudah digunakan oleh ${duplicate.name}.`,
      });
      return;
    }

    const existing = editingId ? displayedUsers.find((u) => u.id === editingId) : undefined;
    const finalPassword = password.trim() || existing?.password || '';
    if (!finalPassword) {
      setFeedback({ type: 'error', text: 'Password wajib diisi untuk akun baru.' });
      return;
    }
    if (finalPassword.length < 4) {
      setFeedback({ type: 'error', text: 'Password minimal 4 karakter.' });
      return;
    }

    setSaving(true);
    try {
      const targetId = editingId || `usr_${Date.now()}`;
      await saveUserAccount({
        id: targetId,
        uid: existing?.uid || targetId,
        name: cleanName,
        username: cleanUsername,
        password: finalPassword,
        email: email.trim().toLowerCase() || `${cleanUsername}@sibk.local`,
        role,
        assignedClassId: role === 'Wali Kelas' ? assignedClassId : '',
        active,
        createdAt: existing?.createdAt || new Date().toISOString(),
      });
      setFeedback({
        type: 'success',
        text: editingId
          ? `Akun "${cleanName}" (@${cleanUsername}) berhasil diperbarui.`
          : `Akun baru "${cleanName}" (@${cleanUsername}) berhasil ditambahkan.`,
      });
      resetForm();
    } catch {
      setFeedback({ type: 'error', text: 'Gagal menyimpan akun. Silakan coba lagi.' });
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (acc: UserAccount) => {
    if (acc.id === currentUser?.id) return;
    await saveUserAccount({
      ...acc,
      active: acc.active === false,
    });
  };

  const getRoleBadgeClass = (r: UserRole) => {
    if (r === 'Administrator') return 'bg-indigo-50 text-indigo-700 border-indigo-200';
    if (r === 'Guru BK') return 'bg-sky-50 text-sky-700 border-sky-200';
    return 'bg-amber-50 text-amber-700 border-amber-200';
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-slate-900">
          Manajemen Pengguna &amp; Akun Login
        </h1>
        <p className="text-sm text-slate-600 mt-1">
          Kelola akun login Administrator, Guru BK, dan Wali Kelas · Ubah username/password atau
          tambahkan akun baru secara realtime
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Form Tambah / Edit Akun */}
        <form
          onSubmit={handleSubmit}
          className="lg:col-span-4 bg-white border border-slate-200 rounded-xl p-5 space-y-3.5 text-sm"
        >
          <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-slate-100">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-slate-100 text-slate-700 flex items-center justify-center">
                {editingId ? <Pencil className="w-4 h-4" /> : <KeyRound className="w-4 h-4" />}
              </div>
              <div>
                <h2 className="text-base font-bold text-slate-900">
                  {editingId ? 'Edit Akun Login' : 'Tambah Akun Login'}
                </h2>
                <p className="text-xs text-slate-500">
                  {editingId ? 'Ubah data, username, atau password' : 'Buat akun untuk Admin / Guru'}
                </p>
              </div>
            </div>
            {editingId && (
              <button
                type="button"
                onClick={resetForm}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-md"
              >
                <X className="w-3.5 h-3.5" /> Batal
              </button>
            )}
          </div>

          {feedback && (
            <div
              className={`p-3 rounded-lg border flex items-start gap-2 text-xs ${
                feedback.type === 'success'
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                  : 'bg-red-50 border-red-200 text-red-700'
              }`}
            >
              {feedback.type === 'success' && (
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-600" />
              )}
              <span>{feedback.text}</span>
            </div>
          )}

          <div>
            <label className="block font-medium text-slate-700 mb-1">Nama Lengkap *</label>
            <input
              required
              placeholder="Contoh: Dra. Ni Luh Sari, M.Pd."
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:border-sky-600"
            />
          </div>

          <div>
            <label className="block font-medium text-slate-700 mb-1">Username Login *</label>
            <input
              required
              autoComplete="off"
              placeholder="Contoh: guru_sari (tanpa spasi)"
              value={username}
              onChange={(e) => setUsername(e.target.value.replace(/\s+/g, ''))}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg font-mono focus:outline-none focus:border-sky-600"
            />
          </div>

          <div>
            <label className="block font-medium text-slate-700 mb-1">
              Password {editingId ? '(Kosongkan jika tetap)' : '*'}
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                required={!editingId}
                autoComplete="new-password"
                placeholder={editingId ? 'Isi hanya jika ingin ganti password' : 'Minimal 4 karakter'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full pl-3 pr-9 py-2 border border-slate-200 rounded-lg focus:outline-none focus:border-sky-600"
              />
              <button
                type="button"
                aria-label={showPassword ? 'Sembunyikan password' : 'Tampilkan password'}
                onClick={() => setShowPassword((prev) => !prev)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block font-medium text-slate-700 mb-1">Peran / Hak Akses</label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as UserRole)}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg bg-white focus:outline-none focus:border-sky-600"
              >
                <option value="Administrator">Administrator</option>
                <option value="Guru BK">Guru BK</option>
                <option value="Wali Kelas">Wali Kelas</option>
              </select>
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Status Akun</label>
              <select
                value={active ? 'active' : 'inactive'}
                onChange={(e) => setActive(e.target.value === 'active')}
                disabled={editingId === currentUser?.id}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg bg-white disabled:bg-slate-50 disabled:text-slate-400"
              >
                <option value="active">Aktif</option>
                <option value="inactive">Nonaktif</option>
              </select>
            </div>
          </div>

          {role === 'Wali Kelas' && (
            <div>
              <label className="block font-medium text-slate-700 mb-1">Kelas Binaan</label>
              <select
                value={assignedClassId}
                onChange={(e) => setAssignedClassId(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg bg-white"
              >
                <option value="">-- Pilih Kelas --</option>
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    Kelas {c.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="block font-medium text-slate-700 mb-1">Email (Opsional)</label>
            <input
              type="email"
              placeholder="nama@sekolah.sch.id"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:border-sky-600"
            />
          </div>

          <button
            type="submit"
            disabled={saving}
            className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-2.5 text-sm font-semibold text-white bg-[#1E3A5F] hover:bg-[#162C49] disabled:opacity-60 rounded-lg transition-colors"
          >
            {editingId ? (
              <>
                <CheckCircle2 className="w-4 h-4" />
                {saving ? 'Menyimpan...' : 'Simpan Perubahan'}
              </>
            ) : (
              <>
                <Plus className="w-4 h-4" />
                {saving ? 'Menambahkan...' : 'Tambah Akun Pengguna'}
              </>
            )}
          </button>
        </form>

        {/* Daftar Akun Terdaftar */}
        <div className="lg:col-span-8 bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Shield className="w-4 h-4 text-[#1E3A5F]" />
              <h2 className="text-base font-bold text-slate-900">
                Daftar Akun Login ({displayedUsers.length})
              </h2>
            </div>
            <span className="text-xs text-slate-500">
              Klik ikon pensil untuk ubah username / password
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 border-b border-slate-200 text-xs text-slate-600">
                <tr>
                  <th className="px-4 py-3 font-semibold">Nama &amp; Peran</th>
                  <th className="px-4 py-3 font-semibold">Username</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {displayedUsers.map((u) => {
                  const isSelf = u.id === currentUser?.id;
                  const isEditingThis = editingId === u.id;
                  const assignedClass = u.assignedClassId
                    ? classes.find((c) => c.id === u.assignedClassId)
                    : undefined;
                  const isActive = u.active !== false;

                  return (
                    <tr
                      key={u.id}
                      className={isEditingThis ? 'bg-sky-50/60' : 'hover:bg-slate-50/70'}
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-slate-900">{u.name}</span>
                          {isSelf && (
                            <span className="text-xs font-semibold px-2 py-0.5 rounded bg-slate-900 text-white">
                              Anda
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 text-xs font-semibold rounded border ${getRoleBadgeClass(
                              u.role
                            )}`}
                          >
                            {u.role}
                          </span>
                          {assignedClass && (
                            <span className="text-xs text-slate-500">
                              · Kelas {assignedClass.name}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-mono font-semibold text-slate-800">
                          {u.username ? `@${u.username}` : '—'}
                        </div>
                        {u.email && !u.email.endsWith('@sibk.local') && (
                          <div className="text-xs text-slate-500 truncate max-w-[200px]">
                            {u.email}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          disabled={isSelf}
                          onClick={() => handleToggleActive(u)}
                          title={
                            isSelf
                              ? 'Akun Anda sendiri tidak bisa dinonaktifkan'
                              : isActive
                                ? 'Klik untuk nonaktifkan akun'
                                : 'Klik untuk aktifkan akun'
                          }
                          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium border transition-colors ${
                            isActive
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                              : 'bg-slate-100 text-slate-500 border-slate-200 hover:bg-slate-200'
                          } disabled:cursor-default`}
                        >
                          {isActive ? (
                            <>
                              <UserCheck className="w-3.5 h-3.5" /> Aktif
                            </>
                          ) : (
                            <>
                              <UserX className="w-3.5 h-3.5" /> Nonaktif
                            </>
                          )}
                        </button>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => startEdit(u)}
                            aria-label={`Edit akun ${u.name}`}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:text-sky-800 bg-slate-100 hover:bg-sky-50 rounded-md transition-colors"
                          >
                            <Pencil className="w-3.5 h-3.5" /> Edit
                          </button>
                          {!isSelf && (
                            <button
                              type="button"
                              aria-label={`Hapus pengguna ${u.name}`}
                              onClick={() => setDeleteTarget(u)}
                              className="p-1.5 text-slate-400 hover:text-red-700 hover:bg-red-50 rounded-md transition-colors"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Audit Log */}
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <h2 className="text-base font-bold text-slate-900 mb-3">
          Log Aktivitas Pengguna (Audit Keamanan)
        </h2>
        <div className="divide-y divide-slate-100 text-sm max-h-64 overflow-y-auto">
          {auditLogs.length === 0 ? (
            <p className="text-slate-400 py-4">Belum ada log aktivitas tercatat.</p>
          ) : (
            auditLogs.slice(0, 20).map((log) => (
              <div
                key={log.id}
                className="py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-1"
              >
                <div>
                  <span className="font-mono font-semibold text-slate-900">{log.action}</span>
                  <span className="text-slate-600 ml-2">{log.target}</span>
                </div>
                <div className="text-xs font-mono text-slate-500">
                  {log.userName} · {log.timestamp.slice(0, 19).replace('T', ' ')}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <ConfirmDeleteModal
        open={Boolean(deleteTarget)}
        title="Hapus Akun Pengguna?"
        itemName={
          deleteTarget
            ? `${deleteTarget.name} (@${deleteTarget.username || deleteTarget.email})`
            : undefined
        }
        description="Akun pengguna ini akan dihapus dan tidak dapat lagi digunakan untuk login ke SIBK. Lanjutkan?"
        onCancel={() => setDeleteTarget(null)}
        onConfirm={async () => {
          if (!deleteTarget) return;
          await deleteUserAccount(deleteTarget.id);
          if (editingId === deleteTarget.id) resetForm();
          setDeleteTarget(null);
        }}
      />
    </div>
  );
};
