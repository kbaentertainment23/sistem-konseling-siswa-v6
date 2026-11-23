import { GoogleAuthProvider, signInWithPopup } from 'firebase/auth';
import { deleteDoc, doc, onSnapshot, setDoc } from 'firebase/firestore';
import { auth, db } from './firebase';
import type { StudentCase } from '../types/sibk';
import {
  extractDriveFileIdFromCase,
  type BackedUpDriveFile,
  type BackupDriveFailure,
  type RestoredDriveLinkInfo,
} from '../utils/backupLogic';

export const DRIVE_SCOPES = ['https://www.googleapis.com/auth/drive'];

const driveProvider = new GoogleAuthProvider();
DRIVE_SCOPES.forEach((scope) => driveProvider.addScope(scope));
driveProvider.setCustomParameters({ prompt: 'select_account' });

const DRIVE_STORAGE_KEY = 'sibk_gdrive_session';
const TOKEN_TTL_MS = 55 * 60 * 1000; // 55 minutes (Google OAuth access token lasts 60 min)

interface StoredDriveSession {
  accessToken: string;
  email: string | null;
  expiresAt: number;
}

function loadStoredDriveSession(): StoredDriveSession | null {
  try {
    const raw = localStorage.getItem(DRIVE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredDriveSession;
    if (!parsed.accessToken || Date.now() >= parsed.expiresAt) {
      localStorage.removeItem(DRIVE_STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function saveStoredDriveSession(accessToken: string, email: string | null): void {
  try {
    const payload: StoredDriveSession = {
      accessToken,
      email,
      expiresAt: Date.now() + TOKEN_TTL_MS,
    };
    localStorage.setItem(DRIVE_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Ignore storage quota errors
  }
}

const initialSession = loadStoredDriveSession();
let cachedDriveAccessToken: string | null = initialSession?.accessToken ?? null;
let cachedDriveEmail: string | null = initialSession?.email ?? null;

/**
 * Extracts a Google Drive Folder ID from a full Drive folder URL or raw ID.
 */
export function extractDriveFolderId(input?: string | null): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Match /folders/<ID>
  const folderMatch = trimmed.match(/\/folders\/([a-zA-Z0-9_-]{10,})/);
  if (folderMatch?.[1]) return folderMatch[1];

  // Match ?id=<ID> or &id=<ID>
  const idParamMatch = trimmed.match(/[?&]id=([a-zA-Z0-9_-]{10,})/);
  if (idParamMatch?.[1]) return idParamMatch[1];

  // Match raw folder ID (no slashes or spaces)
  if (/^[a-zA-Z0-9_-]{10,}$/.test(trimmed)) {
    return trimmed;
  }

  return null;
}

export function getDriveAccessToken(): string | null {
  const stored = loadStoredDriveSession();
  if (!stored) {
    cachedDriveAccessToken = null;
    return null;
  }
  cachedDriveAccessToken = stored.accessToken;
  cachedDriveEmail = stored.email;
  return cachedDriveAccessToken;
}

export function getConnectedDriveEmail(): string | null {
  const stored = loadStoredDriveSession();
  if (!stored) {
    cachedDriveEmail = null;
    return null;
  }
  cachedDriveEmail = stored.email;
  return cachedDriveEmail;
}

export function subscribeSharedDriveSession(
  onChange?: (session: { email: string | null; connected: boolean }) => void
): () => void {
  const ref = doc(db, 'settings', 'drive_session');
  return onSnapshot(
    ref,
    (snap) => {
      if (!snap.exists()) {
        onChange?.({ email: getConnectedDriveEmail(), connected: Boolean(getDriveAccessToken()) });
        return;
      }
      const data = snap.data() as Partial<StoredDriveSession>;
      if (data.accessToken && data.expiresAt && Date.now() < data.expiresAt) {
        cachedDriveAccessToken = data.accessToken;
        cachedDriveEmail = data.email ?? null;
        try {
          localStorage.setItem(
            DRIVE_STORAGE_KEY,
            JSON.stringify({
              accessToken: data.accessToken,
              email: data.email ?? null,
              expiresAt: data.expiresAt,
            })
          );
        } catch {
          // Ignore storage errors
        }
        onChange?.({ email: cachedDriveEmail, connected: true });
      } else {
        // Expired remotely; only clear if local is also expired
        const local = loadStoredDriveSession();
        onChange?.({ email: local?.email ?? null, connected: Boolean(local?.accessToken) });
      }
    },
    () => {
      // Ignore permission/offline errors and keep local state
    }
  );
}

export function disconnectGoogleDrive(): void {
  cachedDriveAccessToken = null;
  cachedDriveEmail = null;
  try {
    localStorage.removeItem(DRIVE_STORAGE_KEY);
  } catch {
    // Ignore storage errors
  }
  void deleteDoc(doc(db, 'settings', 'drive_session')).catch(() => {
    // Ignore if already deleted or offline
  });
}

export async function connectGoogleDrive(): Promise<{
  accessToken: string;
  email: string | null;
}> {
  try {
    const result = await signInWithPopup(auth, driveProvider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Gagal mendapatkan akses Google Drive. Silakan coba lagi.');
    }
    cachedDriveAccessToken = credential.accessToken;
    cachedDriveEmail = result.user?.email || null;
    const expiresAt = Date.now() + TOKEN_TTL_MS;
    saveStoredDriveSession(cachedDriveAccessToken, cachedDriveEmail);

    // Sync active Drive session to Firestore so all other devices are automatically connected
    try {
      await setDoc(doc(db, 'settings', 'drive_session'), {
        accessToken: cachedDriveAccessToken,
        email: cachedDriveEmail,
        expiresAt,
        updatedAt: new Date().toISOString(),
      });
    } catch {
      // Non-fatal: local device still works even if Firestore write fails
    }

    return {
      accessToken: cachedDriveAccessToken,
      email: cachedDriveEmail,
    };
  } catch (err: unknown) {
    const code =
      typeof err === 'object' && err !== null && 'code' in err
        ? String((err as { code?: string }).code)
        : '';
    if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
      throw new Error(
        'Jendela login Google ditutup sebelum selesai. Klik "Hubungkan Google Drive" lagi, pilih akun Google Anda, lalu klik "Izinkan" sampai jendela menutup otomatis.'
      );
    }
    if (code === 'auth/popup-blocked') {
      throw new Error(
        'Browser memblokir jendela login Google. Izinkan pop-up pada kolom alamat browser Anda, lalu coba lagi.'
      );
    }
    if (code === 'auth/unauthorized-domain') {
      throw new Error(
        'Domain ini belum terdaftar di Firebase Authorized Domains. Tambahkan domain aplikasi di Firebase Console → Authentication → Settings → Authorized domains.'
      );
    }
    throw err instanceof Error
      ? err
      : new Error('Gagal menghubungkan Google Drive. Silakan coba lagi.');
  }
}

function base64ToBlob(base64: string, mimeType: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType || 'application/octet-stream' });
}

function dataUrlToBlob(dataUrl: string): { blob: Blob; mimeType: string } {
  const [header, base64] = dataUrl.split(',');
  const mimeMatch = header.match(/:(.*?);/);
  const mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';
  return {
    blob: base64ToBlob(base64 || '', mimeType),
    mimeType,
  };
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    parts.push(String.fromCharCode(...chunk));
  }
  return btoa(parts.join(''));
}

export interface DriveUploadResult {
  fileId: string;
  webViewLink: string;
  thumbnailUrl: string;
}

async function uploadBlobToGoogleDrive(params: {
  blob: Blob;
  mimeType: string;
  fileName: string;
  folderUrlOrId?: string;
  accessToken?: string;
}): Promise<DriveUploadResult> {
  const token = params.accessToken || getDriveAccessToken() || cachedDriveAccessToken;
  if (!token) {
    throw new Error('Akun Google Drive belum terhubung. Klik "Hubungkan Google Drive" terlebih dahulu.');
  }

  const folderId = extractDriveFolderId(params.folderUrlOrId);
  const metadata: Record<string, unknown> = {
    name: params.fileName,
    mimeType: params.mimeType || 'image/jpeg',
  };
  if (folderId) {
    metadata.parents = [folderId];
  }

  const formData = new FormData();
  formData.append(
    'metadata',
    new Blob([JSON.stringify(metadata)], { type: 'application/json' })
  );
  formData.append('file', params.blob, params.fileName);

  const uploadRes = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,webViewLink,thumbnailLink',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: formData,
    }
  );

  if (!uploadRes.ok) {
    if (uploadRes.status === 401) {
      disconnectGoogleDrive();
      throw new Error('Sesi Google Drive berakhir. Silakan klik "Hubungkan Google Drive" kembali.');
    }
    if (uploadRes.status === 403) {
      throw new Error(
        'Akun Google ini tidak memiliki izin menulis ke folder tujuan. Pastikan Admin sudah membagikan (Share) folder Google Drive ke akun ini sebagai Editor (atau "Siapa saja yang memiliki link → Editor").'
      );
    }
    if (uploadRes.status === 404 && folderId) {
      throw new Error(
        'Folder Google Drive tidak ditemukan atau belum dibagikan (Share) ke akun Google ini sebagai Editor.'
      );
    }
    const errText = await uploadRes.text();
    throw new Error(`Gagal mengunggah file ke Google Drive (${uploadRes.status}): ${errText}`);
  }

  const fileData = (await uploadRes.json()) as {
    id: string;
    webViewLink?: string;
    thumbnailLink?: string;
  };

  // Best-effort: make file viewable via link so all BK teachers & Admin can preview it
  try {
    await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileData.id}/permissions?supportsAllDrives=true`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          role: 'reader',
          type: 'anyone',
        }),
      }
    );
  } catch {
    // Ignore if domain policy restricts public link sharing
  }

  return {
    fileId: fileData.id,
    webViewLink: fileData.webViewLink || `https://drive.google.com/file/d/${fileData.id}/view`,
    thumbnailUrl: `https://drive.google.com/thumbnail?id=${fileData.id}&sz=w1200`,
  };
}

/**
 * Uploads a compressed image directly into the shared Google Drive folder configured by Admin,
 * using the currently connected teacher/admin Google account (supports different Google accounts
 * as long as the folder is shared with Editor access).
 */
export async function uploadPhotoToGoogleDrive(params: {
  dataUrl: string;
  fileName: string;
  folderUrlOrId?: string;
  accessToken?: string;
}): Promise<DriveUploadResult> {
  const { blob, mimeType } = dataUrlToBlob(params.dataUrl);
  return uploadBlobToGoogleDrive({
    blob,
    mimeType: mimeType || 'image/jpeg',
    fileName: params.fileName,
    folderUrlOrId: params.folderUrlOrId,
    accessToken: params.accessToken,
  });
}

export async function uploadBackupFileToGoogleDrive(params: {
  base64Data: string;
  mimeType: string;
  fileName: string;
  folderUrlOrId?: string;
  accessToken?: string;
}): Promise<DriveUploadResult> {
  const blob = base64ToBlob(params.base64Data, params.mimeType || 'image/jpeg');
  return uploadBlobToGoogleDrive({
    blob,
    mimeType: params.mimeType || 'image/jpeg',
    fileName: params.fileName,
    folderUrlOrId: params.folderUrlOrId,
    accessToken: params.accessToken,
  });
}

export interface DriveFileMeta {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  webViewLink?: string;
  trashed?: boolean;
  parents?: string[];
}

export async function getDriveFileMetadata(
  fileId: string,
  accessToken: string
): Promise<DriveFileMeta | null> {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?supportsAllDrives=true&fields=id,name,mimeType,size,webViewLink,trashed,parents`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );
  if (res.status === 401) {
    disconnectGoogleDrive();
    throw new Error('Sesi Google Drive berakhir. Silakan klik "Hubungkan Google Drive" kembali.');
  }
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} saat memeriksa file ${fileId}`);
  }
  return (await res.json()) as DriveFileMeta;
}

export async function listDriveFolderFiles(
  folderId: string,
  accessToken: string
): Promise<DriveFileMeta[]> {
  const allFiles: DriveFileMeta[] = [];
  let pageToken: string | undefined;

  do {
    const q = `'${folderId.replace(/'/g, "\\'")}' in parents and trashed = false and mimeType != 'application/vnd.google-apps.folder'`;
    const params = new URLSearchParams({
      q,
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
      pageSize: '100',
      fields: 'nextPageToken,files(id,name,mimeType,size,webViewLink,trashed,parents)',
    });
    if (pageToken) params.set('pageToken', pageToken);

    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files?${params.toString()}`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    if (res.status === 401) {
      disconnectGoogleDrive();
      throw new Error('Sesi Google Drive berakhir. Silakan klik "Hubungkan Google Drive" kembali.');
    }
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Gagal membaca isi folder Google Drive (${res.status}): ${errText}`);
    }

    const data = (await res.json()) as {
      nextPageToken?: string;
      files?: DriveFileMeta[];
    };
    if (Array.isArray(data.files)) {
      allFiles.push(...data.files);
    }
    pageToken = data.nextPageToken;
  } while (pageToken);

  return allFiles;
}

const MAX_SINGLE_BACKUP_FILE_BYTES = 15 * 1024 * 1024;
const MAX_TOTAL_BACKUP_DRIVE_BYTES = 120 * 1024 * 1024;

export async function downloadDriveFileAsBase64(params: {
  fileId: string;
  mimeType: string;
  accessToken: string;
}): Promise<{ base64Data: string; sizeBytes: number; effectiveMimeType: string }> {
  const isGoogleNative = params.mimeType.startsWith('application/vnd.google-apps.');
  const effectiveMimeType = isGoogleNative ? 'application/pdf' : params.mimeType || 'image/jpeg';
  const url = isGoogleNative
    ? `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(params.fileId)}/export?mimeType=application/pdf`
    : `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(params.fileId)}?alt=media&supportsAllDrives=true`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${params.accessToken}` },
  });

  if (res.status === 401) {
    disconnectGoogleDrive();
    throw new Error('Sesi Google Drive berakhir. Silakan klik "Hubungkan Google Drive" kembali.');
  }
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`HTTP ${res.status}: ${errText || 'Gagal mengunduh file'}`);
  }

  const buffer = await res.arrayBuffer();
  return {
    base64Data: arrayBufferToBase64(buffer),
    sizeBytes: buffer.byteLength,
    effectiveMimeType,
  };
}

export async function collectAndDownloadDriveBackupFiles(params: {
  folderUrlOrId?: string;
  cases: StudentCase[];
  accessToken: string;
  onProgress?: (progress: { current: number; total: number; fileName: string }) => void;
}): Promise<{
  driveFiles: BackedUpDriveFile[];
  failedFiles: BackupDriveFailure[];
  folderId: string | null;
}> {
  const { folderUrlOrId, cases, accessToken, onProgress } = params;
  const folderId = extractDriveFolderId(folderUrlOrId);

  const fileIndex = new Map<
    string,
    {
      fileId: string;
      meta?: DriveFileMeta;
      linkedCaseIds: Set<string>;
      source: 'case_ref' | 'folder_scan' | 'both';
    }
  >();

  // 1. Collect all Drive file IDs referenced in cases
  for (const c of cases) {
    const fid = extractDriveFileIdFromCase(c);
    if (!fid) continue;
    const existing = fileIndex.get(fid);
    if (existing) {
      existing.linkedCaseIds.add(c.id);
    } else {
      fileIndex.set(fid, {
        fileId: fid,
        linkedCaseIds: new Set([c.id]),
        source: 'case_ref',
      });
    }
  }

  const failedFiles: BackupDriveFailure[] = [];

  // 2. Scan configured Drive folder to also catch all stored photos/documents in the folder
  if (folderId) {
    try {
      const folderFiles = await listDriveFolderFiles(folderId, accessToken);
      for (const meta of folderFiles) {
        const existing = fileIndex.get(meta.id);
        if (existing) {
          existing.meta = meta;
          existing.source = 'both';
        } else {
          fileIndex.set(meta.id, {
            fileId: meta.id,
            meta,
            linkedCaseIds: new Set(),
            source: 'folder_scan',
          });
        }
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes('Sesi Google Drive berakhir')) {
        throw err;
      }
      failedFiles.push({
        fileId: folderId,
        name: 'Folder Google Drive',
        reason: err instanceof Error ? err.message : 'Gagal membaca daftar isi folder Drive',
      });
    }
  }

  const entries = Array.from(fileIndex.values());
  const driveFiles: BackedUpDriveFile[] = [];
  let totalDownloadedBytes = 0;

  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    let meta = entry.meta;
    if (!meta) {
      try {
        const fetched = await getDriveFileMetadata(entry.fileId, accessToken);
        if (!fetched || fetched.trashed) {
          failedFiles.push({
            fileId: entry.fileId,
            reason: !fetched
              ? 'File tidak ditemukan di Google Drive (kemungkinan sudah dihapus permanen).'
              : 'File berada di Trash (Sampah) Google Drive.',
          });
          continue;
        }
        meta = fetched;
      } catch (err) {
        if (err instanceof Error && err.message.includes('Sesi Google Drive berakhir')) {
          throw err;
        }
        failedFiles.push({
          fileId: entry.fileId,
          reason: err instanceof Error ? err.message : 'Gagal memeriksa metadata file Drive',
        });
        continue;
      }
    }

    const declaredSize = Number(meta.size || 0);
    if (declaredSize > MAX_SINGLE_BACKUP_FILE_BYTES) {
      failedFiles.push({
        fileId: entry.fileId,
        name: meta.name,
        reason: `Ukuran file terlalu besar (${(declaredSize / (1024 * 1024)).toFixed(1)} MB, batas per file 15 MB).`,
      });
      continue;
    }

    if (totalDownloadedBytes + declaredSize > MAX_TOTAL_BACKUP_DRIVE_BYTES) {
      failedFiles.push({
        fileId: entry.fileId,
        name: meta.name,
        reason: 'Batas total unduhan browser 120 MB tercapai; file selebihnya dapat dicadangkan langsung dari Google Drive.',
      });
      continue;
    }

    onProgress?.({ current: i + 1, total: entries.length, fileName: meta.name });

    try {
      const downloaded = await downloadDriveFileAsBase64({
        fileId: entry.fileId,
        mimeType: meta.mimeType || 'image/jpeg',
        accessToken,
      });

      totalDownloadedBytes += downloaded.sizeBytes;
      driveFiles.push({
        originalFileId: entry.fileId,
        name:
          meta.mimeType?.startsWith('application/vnd.google-apps.') && !meta.name.toLowerCase().endsWith('.pdf')
            ? `${meta.name}.pdf`
            : meta.name,
        mimeType: downloaded.effectiveMimeType,
        sizeBytes: downloaded.sizeBytes,
        base64Data: downloaded.base64Data,
        webViewLink: meta.webViewLink || `https://drive.google.com/file/d/${entry.fileId}/view`,
        linkedCaseIds: Array.from(entry.linkedCaseIds),
        source: entry.source,
      });
    } catch (err) {
      if (err instanceof Error && err.message.includes('Sesi Google Drive berakhir')) {
        throw err;
      }
      failedFiles.push({
        fileId: entry.fileId,
        name: meta.name,
        reason: err instanceof Error ? err.message : 'Gagal mengunduh file Drive',
      });
    }
  }

  return { driveFiles, failedFiles, folderId };
}

export async function restoreDriveFilesToGoogleDrive(params: {
  driveFiles: BackedUpDriveFile[];
  folderUrlOrId?: string;
  accessToken: string;
  onProgress?: (progress: { current: number; total: number; fileName: string }) => void;
}): Promise<{
  restoredDriveMap: Record<string, RestoredDriveLinkInfo>;
  uploadedCount: number;
  reusedCount: number;
  warnings: string[];
}> {
  const { driveFiles, folderUrlOrId, accessToken, onProgress } = params;
  const targetFolderId = extractDriveFolderId(folderUrlOrId);
  const restoredDriveMap: Record<string, RestoredDriveLinkInfo> = {};
  const warnings: string[] = [];
  let uploadedCount = 0;
  let reusedCount = 0;

  for (let i = 0; i < driveFiles.length; i += 1) {
    const file = driveFiles[i];
    if (!file || !file.originalFileId || !file.base64Data) continue;

    onProgress?.({ current: i + 1, total: driveFiles.length, fileName: file.name || file.originalFileId });

    // Check if original file still exists & is not trashed (and inside targetFolderId if configured)
    let canReuseOriginal = false;
    try {
      const existingMeta = await getDriveFileMetadata(file.originalFileId, accessToken);
      if (existingMeta && !existingMeta.trashed) {
        if (!targetFolderId || (existingMeta.parents && existingMeta.parents.includes(targetFolderId))) {
          canReuseOriginal = true;
          restoredDriveMap[file.originalFileId] = {
            fileId: existingMeta.id,
            webViewLink: existingMeta.webViewLink || `https://drive.google.com/file/d/${existingMeta.id}/view`,
            thumbnailUrl: `https://drive.google.com/thumbnail?id=${existingMeta.id}&sz=w1200`,
          };
          reusedCount += 1;
        }
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes('Sesi Google Drive berakhir')) {
        throw err;
      }
      // Fall back to re-uploading below
    }

    if (canReuseOriginal) continue;

    try {
      const uploaded = await uploadBackupFileToGoogleDrive({
        base64Data: file.base64Data,
        mimeType: file.mimeType || 'image/jpeg',
        fileName: file.name || `Restore_SIBK_${i + 1}.jpg`,
        folderUrlOrId,
        accessToken,
      });
      restoredDriveMap[file.originalFileId] = uploaded;
      uploadedCount += 1;
    } catch (err) {
      if (err instanceof Error && err.message.includes('Sesi Google Drive berakhir')) {
        throw err;
      }
      warnings.push(
        `Gagal memulihkan file Drive "${file.name}": ${err instanceof Error ? err.message : 'Error upload'}`
      );
    }
  }

  return {
    restoredDriveMap,
    uploadedCount,
    reusedCount,
    warnings,
  };
}

