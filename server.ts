import 'dotenv/config';
import crypto from 'crypto';
import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface ServiceAccountCredentials {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

let cachedSaToken: { token: string; expiresAt: number } | null = null;

function parseServiceAccountFromEnv(): ServiceAccountCredentials | null {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ServiceAccountCredentials>;
    if (!parsed.client_email || !parsed.private_key) return null;
    return {
      client_email: parsed.client_email,
      private_key: parsed.private_key.replace(/\\n/g, '\n'),
      token_uri: parsed.token_uri || 'https://oauth2.googleapis.com/token',
    };
  } catch {
    return null;
  }
}

function base64UrlEncode(input: string | Buffer): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

async function getServiceAccountAccessToken(creds: ServiceAccountCredentials): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedSaToken && cachedSaToken.expiresAt > now + 60) {
    return cachedSaToken.token;
  }

  const header = base64UrlEncode(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64UrlEncode(
    JSON.stringify({
      iss: creds.client_email,
      scope: 'https://www.googleapis.com/auth/drive',
      aud: creds.token_uri || 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    })
  );

  const unsignedJwt = `${header}.${payload}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(unsignedJwt);
  const signature = base64UrlEncode(signer.sign(creds.private_key));
  const assertion = `${unsignedJwt}.${signature}`;

  const tokenRes = await fetch(creds.token_uri || 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });

  const tokenJson = (await tokenRes.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    error_description?: string;
    error?: string;
  };

  if (!tokenRes.ok || !tokenJson.access_token) {
    throw new Error(
      tokenJson.error_description ||
        tokenJson.error ||
        `Gagal autentikasi Service Account (${tokenRes.status}).`
    );
  }

  cachedSaToken = {
    token: tokenJson.access_token,
    expiresAt: now + (tokenJson.expires_in || 3600),
  };
  return cachedSaToken.token;
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use(express.json({ limit: '15mb' }));

  // Check if Google Service Account is configured (never exposes private key)
  app.get('/api/drive-status', (_req, res) => {
    const creds = parseServiceAccountFromEnv();
    res.json({
      configured: Boolean(creds),
      serviceAccountEmail: creds?.client_email || null,
    });
  });

  // Upload photo directly to Google Drive using server-side Service Account (no teacher Google login needed)
  app.post('/api/upload-drive', async (req, res) => {
    try {
      const creds = parseServiceAccountFromEnv();
      if (!creds) {
        res.status(400).json({
          ok: false,
          error:
            'Kunci Service Account (GOOGLE_SERVICE_ACCOUNT_JSON) belum diatur di panel Secrets AI Studio. Tambahkan terlebih dahulu lalu restart aplikasi.',
        });
        return;
      }

      const { fileName, mimeType, base64Data, folderId } = req.body as {
        fileName?: string;
        mimeType?: string;
        base64Data?: string;
        folderId?: string;
      };

      if (!base64Data) {
        res.status(400).json({ ok: false, error: 'Data foto tidak boleh kosong.' });
        return;
      }

      const accessToken = await getServiceAccountAccessToken(creds);
      const safeFileName = fileName || `foto_bk_${Date.now()}.jpg`;
      const safeMime = mimeType || 'image/jpeg';
      const metadata: Record<string, unknown> = {
        name: safeFileName,
        mimeType: safeMime,
      };
      if (folderId && folderId.trim()) {
        metadata.parents = [folderId.trim()];
      }

      const boundary = `sibk_boundary_${Date.now()}`;
      const imageBuffer = Buffer.from(base64Data, 'base64');
      const preamble = Buffer.from(
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(
          metadata
        )}\r\n--${boundary}\r\nContent-Type: ${safeMime}\r\n\r\n`,
        'utf-8'
      );
      const closing = Buffer.from(`\r\n--${boundary}--`, 'utf-8');
      const multipartBody = Buffer.concat([preamble, imageBuffer, closing]);

      const uploadRes = await fetch(
        'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,webViewLink,thumbnailLink',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': `multipart/related; boundary=${boundary}`,
            'Content-Length': String(multipartBody.length),
          },
          body: multipartBody,
        }
      );

      const uploadJson = (await uploadRes.json().catch(() => ({}))) as {
        id?: string;
        webViewLink?: string;
        thumbnailLink?: string;
        error?: { message?: string; errors?: Array<{ reason?: string }> };
      };

      if (!uploadRes.ok || !uploadJson.id) {
        const reason = uploadJson.error?.errors?.[0]?.reason || '';
        const msg = uploadJson.error?.message || `HTTP ${uploadRes.status}`;
        if (uploadRes.status === 404) {
          res.status(404).json({
            ok: false,
            error: `Folder Google Drive tidak ditemukan atau belum dibagikan (Share) ke ${creds.client_email} sebagai Editor.`,
          });
          return;
        }
        if (reason === 'storageQuotaExceeded' || msg.toLowerCase().includes('storage quota')) {
          res.status(403).json({
            ok: false,
            error:
              'Kuota Service Account penuh / dibatasi Google Drive (akun Gmail biasa membatasi upload Service Account di luar Shared Drive). Gunakan Shared Drive (Google Workspace) atau hubungi Admin.',
          });
          return;
        }
        res.status(502).json({
          ok: false,
          error: `Gagal mengunggah ke Google Drive: ${msg}`,
        });
        return;
      }

      // Best-effort: set Anyone with link can view so all teachers can see the photo
      try {
        await fetch(
          `https://www.googleapis.com/drive/v3/files/${uploadJson.id}/permissions?supportsAllDrives=true`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ role: 'reader', type: 'anyone' }),
          }
        );
      } catch {
        // Ignore if domain policy blocks public link sharing
      }

      res.json({
        ok: true,
        fileId: uploadJson.id,
        webViewLink:
          uploadJson.webViewLink || `https://drive.google.com/file/d/${uploadJson.id}/view`,
        thumbnailUrl: `https://drive.google.com/thumbnail?id=${uploadJson.id}&sz=w1200`,
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error:
          err instanceof Error
            ? `Gagal mengunggah ke Google Drive: ${err.message}`
            : 'Gagal mengunggah ke Google Drive.',
      });
    }
  });

  const httpServer = http.createServer(app);

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        allowedHosts: true,
        hmr: process.env.DISABLE_HMR === 'true' ? false : { server: httpServer },
        ws: { server: httpServer },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`SIBK server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
