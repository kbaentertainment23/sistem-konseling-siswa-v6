let activeManifestBlobUrl: string | null = null;

function renderLogoToDataUrl(
  img: HTMLImageElement,
  size: number,
  paddingRatio: number
): string {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  // Clean white background so transparent school logos remain crisp on any home screen
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, size, size);

  const pad = Math.round(size * paddingRatio);
  const avail = size - pad * 2;
  const scale = Math.min(avail / img.naturalWidth, avail / img.naturalHeight);
  const drawW = img.naturalWidth * scale;
  const drawH = img.naturalHeight * scale;
  const dx = (size - drawW) / 2;
  const dy = (size - drawH) / 2;

  ctx.drawImage(img, dx, dy, drawW, drawH);
  return canvas.toDataURL('image/png');
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = (err) => reject(err);
    img.src = src;
  });
}

/**
 * Dynamically updates favicon, apple-touch-icon, and the Web App Manifest icons
 * using the school logo uploaded in Pengaturan -> Identitas Sekolah.
 */
export async function syncPWABrandingWithLogo(
  schoolLogoUrl?: string,
  schoolName?: string
): Promise<void> {
  if (typeof document === 'undefined' || !schoolLogoUrl) return;

  try {
    const img = await loadImage(schoolLogoUrl);
    if (!img.naturalWidth || !img.naturalHeight) return;

    const icon180 = renderLogoToDataUrl(img, 180, 0.08);
    const icon192 = renderLogoToDataUrl(img, 192, 0.08);
    const icon512 = renderLogoToDataUrl(img, 512, 0.08);
    const maskable512 = renderLogoToDataUrl(img, 512, 0.16);

    if (!icon192 || !icon512) return;

    // Update browser favicon
    let favicon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!favicon) {
      favicon = document.createElement('link');
      favicon.rel = 'icon';
      document.head.appendChild(favicon);
    }
    favicon.type = 'image/png';
    favicon.href = icon192;

    // Update iOS apple-touch-icon
    let appleIcon = document.querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"]');
    if (!appleIcon) {
      appleIcon = document.createElement('link');
      appleIcon.rel = 'apple-touch-icon';
      document.head.appendChild(appleIcon);
    }
    appleIcon.href = icon180 || icon192;

    // Update dynamic Web App Manifest with uploaded school logo
    const manifestObj = {
      id: '/',
      name: 'SIBK',
      short_name: 'SIBK',
      description: schoolName
        ? `Sistem Informasi Bimbingan dan Konseling — ${schoolName}`
        : 'Sistem Informasi Bimbingan dan Konseling (SIBK)',
      theme_color: '#1E3A5F',
      background_color: '#F8FAFC',
      display: 'standalone',
      start_url: '/',
      scope: '/',
      icons: [
        {
          src: icon192,
          sizes: '192x192',
          type: 'image/png',
          purpose: 'any',
        },
        {
          src: icon512,
          sizes: '512x512',
          type: 'image/png',
          purpose: 'any',
        },
        {
          src: maskable512,
          sizes: '512x512',
          type: 'image/png',
          purpose: 'maskable',
        },
      ],
    };

    const blob = new Blob([JSON.stringify(manifestObj)], { type: 'application/manifest+json' });
    const nextBlobUrl = URL.createObjectURL(blob);

    let manifestLink = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
    if (!manifestLink) {
      manifestLink = document.createElement('link');
      manifestLink.rel = 'manifest';
      document.head.appendChild(manifestLink);
    }
    manifestLink.href = nextBlobUrl;

    if (activeManifestBlobUrl) {
      URL.revokeObjectURL(activeManifestBlobUrl);
    }
    activeManifestBlobUrl = nextBlobUrl;
  } catch {
    // Keep default manifest & icons if logo cannot be drawn (e.g., CORS restriction)
  }
}
