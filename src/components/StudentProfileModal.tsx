import React from 'react';
import { X, AlertTriangle, Lock, Printer } from 'lucide-react';
import { useSibk } from '../context/SibkContext';
import type { Student } from '../types/sibk';
import {
  evaluateCaseThreshold,
  formatDateShort,
  getCasesSinceLastParentCall,
} from '../utils/sibkLogic';
import { exportStudentProfilePDF } from '../utils/exportUtils';
import { useModalDismiss } from '../utils/useModalDismiss';

interface Props {
  student: Student | null;
  onClose: () => void;
  onAddCaseForStudent?: (student: Student) => void;
}

export const StudentProfileModal: React.FC<Props> = ({
  student,
  onClose,
  onAddCaseForStudent,
}) => {
  const {
    attendance,
    cases,
    counselingLogs,
    parentCalls,
    monitoringNotes,
    settings,
    currentUser,
    canViewCounseling,
  } = useSibk();

  const backdropProps = useModalDismiss({
    open: Boolean(student),
    onClose,
  });

  if (!student) return null;

  const stuAttendance = attendance.filter((a) => a.studentId === student.id);
  const stuCases = cases
    .filter((c) => c.studentId === student.id)
    .sort((a, b) => a.caseNumber - b.caseNumber);
  const stuLogs = counselingLogs.filter((l) => l.studentId === student.id);
  const stuCalls = parentCalls.filter((p) => p.studentId === student.id);
  const stuNotes = monitoringNotes.filter((m) => m.studentId === student.id);

  const sakitCount = stuAttendance.filter((a) => a.status === 'Sakit').length;
  const izinCount = stuAttendance.filter((a) => a.status === 'Izin').length;
  const alpaCount = stuAttendance.filter((a) => a.status === 'Alpa').length;
  const casesSinceLastCall = getCasesSinceLastParentCall(
    stuCases.length,
    student.caseCountAtLastParentCall
  );
  const thresholdEval = evaluateCaseThreshold(casesSinceLastCall, settings);

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="student-profile-title"
      {...backdropProps}
    >
      <div className="bg-white border border-slate-200 rounded-xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="relative px-6 py-4 pr-16 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 id="student-profile-title" className="text-lg sm:text-xl font-bold text-slate-900">
              {student.fullName}
            </h2>
            <div className="text-sm text-slate-600 mt-1 font-mono tabular-nums">
              NIS {student.nis} · NISN {student.nisn || '-'} · Kelas {student.className} · Status{' '}
              {student.status}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() =>
                exportStudentProfilePDF({
                  student,
                  attendance: stuAttendance,
                  cases: stuCases,
                  counselingLogs: canViewCounseling ? stuLogs : [],
                  parentCalls: stuCalls,
                  monitoringNotes: stuNotes,
                  settings,
                  counselorName: currentUser?.name,
                })
              }
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs sm:text-sm font-semibold text-[#1E3A5F] bg-sky-50 hover:bg-sky-100 border border-sky-200 rounded-lg transition-colors whitespace-nowrap"
            >
              <Printer className="w-4 h-4" />
              Cetak Rekap Siswa (PDF)
            </button>
            {onAddCaseForStudent && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onAddCaseForStudent(student);
                }}
                className="px-3.5 py-2 text-xs sm:text-sm font-semibold text-white bg-[#1E3A5F] hover:bg-[#162C49] rounded-lg transition-colors whitespace-nowrap"
              >
                + Catat Kasus Baru
              </button>
            )}
          </div>
          <button
            type="button"
            aria-label="Tutup profil siswa"
            title="Keluar"
            onClick={onClose}
            className="absolute top-4 right-4 p-2 text-white bg-red-600 hover:bg-red-700 rounded-lg shadow-xs transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto space-y-6">
          {/* Threshold Warning Banner */}
          {thresholdEval.level !== 'none' && (
            <div
              className={`p-4 rounded-xl border ${
                thresholdEval.level === 'max'
                  ? 'bg-red-50 border-red-200 text-red-900'
                  : 'bg-amber-50 border-amber-200 text-amber-900'
              }`}
            >
              <div className="flex items-center gap-2 font-semibold text-base mb-1.5">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>
                  PERINGATAN: {thresholdEval.label} ({stuCases.length} kali tercatat)
                </span>
              </div>
              <ul className="list-disc pl-5 text-sm space-y-1">
                {thresholdEval.recommendations.map((rec, i) => (
                  <li key={i}>{rec}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Identity & Attendance Summary */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="md:col-span-2 border border-slate-200 rounded-xl p-5">
              <h3 className="text-base font-bold text-slate-900 mb-3">Identitas & Orang Tua</h3>
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3 text-sm">
                <div>
                  <dt className="text-xs text-slate-500">Jenis Kelamin</dt>
                  <dd className="font-medium text-slate-900">{student.gender}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Tempat, Tanggal Lahir</dt>
                  <dd className="font-medium text-slate-900">
                    {student.birthPlace || '-'}, {formatDateShort(student.birthDate)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Nomor HP Siswa</dt>
                  <dd className="font-medium text-slate-900 font-mono">{student.studentPhone || '-'}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Status Pemantauan</dt>
                  <dd className="font-medium text-slate-900">{student.monitoringStatus}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Ayah / Ibu</dt>
                  <dd className="font-medium text-slate-900">
                    {student.fatherName || '-'} / {student.motherName || '-'}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Nomor HP Orang Tua/Wali</dt>
                  <dd className="font-medium text-slate-900 font-mono">{student.parentPhone || '-'}</dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-xs text-slate-500">Alamat</dt>
                  <dd className="font-medium text-slate-900">{student.address || '-'}</dd>
                </div>
              </dl>
            </div>

            <div className="border border-slate-200 rounded-xl p-5 flex flex-col justify-between">
              <h3 className="text-base font-bold text-slate-900 mb-3">Rekap Kehadiran & BK</h3>
              <div className="space-y-2.5 text-sm">
                <div className="flex justify-between py-1 border-b border-slate-100">
                  <span className="text-slate-600">Sakit</span>
                  <span className="font-mono font-semibold text-slate-900 tabular-nums">{sakitCount} hari</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-100">
                  <span className="text-slate-600">Izin</span>
                  <span className="font-mono font-semibold text-slate-900 tabular-nums">{izinCount} hari</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-100">
                  <span className="text-slate-600">Alpa (Tanpa Keterangan)</span>
                  <span className="font-mono font-semibold text-red-700 tabular-nums">{alpaCount} hari</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-100">
                  <span className="text-slate-600">Total Kasus BK</span>
                  <span className="font-mono font-semibold text-slate-900 tabular-nums">{stuCases.length} kasus</span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-slate-600">Pemanggilan Orang Tua</span>
                  <span className="font-mono font-semibold text-slate-900 tabular-nums">{stuCalls.length} kali</span>
                </div>
              </div>
            </div>
          </div>

          {/* Case History */}
          <div>
            <h3 className="text-base font-bold text-slate-900 mb-3">
              Riwayat Kasus BK ({stuCases.length})
            </h3>
            {stuCases.length === 0 ? (
              <p className="text-sm text-slate-500 py-4 border border-slate-200 rounded-xl text-center">
                Belum ada catatan kasus BK untuk siswa ini.
              </p>
            ) : (
              <div className="border border-slate-200 rounded-xl overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 text-slate-600 text-xs uppercase tracking-wide border-b border-slate-200">
                    <tr>
                      <th className="px-4 py-3 font-semibold">Urutan</th>
                      <th className="px-4 py-3 font-semibold">Tanggal</th>
                      <th className="px-4 py-3 font-semibold">Kategori</th>
                      <th className="px-4 py-3 font-semibold">Permasalahan</th>
                      <th className="px-4 py-3 font-semibold">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {stuCases.map((c) => (
                      <tr key={c.id}>
                        <td className="px-4 py-3 font-mono font-semibold text-slate-900 whitespace-nowrap">
                          Kasus ke-{c.caseNumber}
                        </td>
                        <td className="px-4 py-3 font-mono text-slate-600 whitespace-nowrap">
                          {formatDateShort(c.date)}
                        </td>
                        <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{c.category}</td>
                        <td className="px-4 py-3 text-slate-700">{c.description}</td>
                        <td className="px-4 py-3 font-medium text-slate-900 whitespace-nowrap">
                          {c.status}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Confidential Counseling Logs */}
          <div>
            <h3 className="text-base font-bold text-slate-900 mb-3">
              Riwayat Konseling (Rahasia)
            </h3>
            {!canViewCounseling ? (
              <div className="p-4 border border-slate-200 rounded-xl bg-slate-50 flex items-center gap-3 text-sm text-slate-600">
                <Lock className="w-4 h-4 text-slate-500 shrink-0" />
                <span>
                  Catatan konseling bersifat rahasia dan hanya dapat diakses oleh Guru BK dan
                  Administrator.
                </span>
              </div>
            ) : stuLogs.length === 0 ? (
              <p className="text-sm text-slate-500 py-4 border border-slate-200 rounded-xl text-center">
                Belum ada catatan sesi konseling.
              </p>
            ) : (
              <div className="space-y-3">
                {stuLogs.map((log) => (
                  <div key={log.id} className="border border-slate-200 rounded-xl p-4 text-sm space-y-2">
                    <div className="flex items-center justify-between text-slate-600">
                      <span className="font-mono">{formatDateShort(log.date)} · {log.counselorName}</span>
                      <span className="font-semibold text-slate-900">{log.progressStatus}</span>
                    </div>
                    <div className="font-bold text-slate-900">{log.topic}</div>
                    <p className="text-slate-700 leading-relaxed">Hasil: {log.result}</p>
                    <p className="text-slate-600 leading-relaxed">Solusi: {log.solution || '-'}</p>
                    <p className="text-slate-600 leading-relaxed">Komitmen Siswa: {log.studentCommitment || '-'}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Monitoring Notes */}
          {canViewCounseling && stuNotes.length > 0 && (
            <div>
              <h3 className="text-base font-bold text-slate-900 mb-3">
                Catatan Perkembangan Pemantauan
              </h3>
              <div className="space-y-2.5">
                {stuNotes.map((n) => (
                  <div key={n.id} className="border border-slate-200 rounded-xl p-4 text-sm">
                    <div className="text-xs text-slate-500 font-mono mb-1.5">
                      {formatDateShort(n.date)} · {n.counselorName} · {n.progressLevel}
                    </div>
                    <p className="text-slate-800 leading-relaxed">{n.observation}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
