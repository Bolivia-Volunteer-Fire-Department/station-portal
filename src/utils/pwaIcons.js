/**
 * Client-side PWA icon generation and dynamic manifest / favicon management.
 *
 * Allows any fire department to upload their custom emblem/patch, and:
 *  1. Resizes and cleans the image for in-app display and storage.
 *  2. Dynamically updates browser favicons, apple-touch-icon, and web manifest at runtime.
 *  3. Generates complete standard PWA icon suites (16px to 512px + maskable) and packages
 *     them into a downloadable .zip pack alongside an updated manifest.webmanifest.
 */

// CRC-32 table for zero-dependency zip creation
const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  }
  CRC_TABLE[i] = c >>> 0;
}

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * Creates an uncompressed standard PKZip archive from a list of files.
 * @param {Array<{ name: string, data: Uint8Array | string }>} files
 * @returns {Blob}
 */
export function createZipArchive(files) {
  const parts = [];
  const centralDirectoryHeaders = [];
  let offset = 0;

  const now = new Date();
  const dosTime = ((now.getHours() << 11) | (now.getMinutes() << 5) | (Math.floor(now.getSeconds() / 2))) & 0xffff;
  const dosDate = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xffff;

  for (const file of files) {
    const rawData = typeof file.data === 'string' ? new TextEncoder().encode(file.data) : file.data;
    const nameBytes = new TextEncoder().encode(file.name);
    const fileCrc = crc32(rawData);
    const size = rawData.length;

    // Local file header (30 bytes + name)
    const localHeader = new Uint8Array(30 + nameBytes.length);
    const view = new DataView(localHeader.buffer);
    view.setUint32(0, 0x04034b50, true); // signature
    view.setUint16(4, 20, true);         // version needed
    view.setUint16(6, 0, true);          // general purpose bit flag
    view.setUint16(8, 0, true);          // compression method (0 = stored)
    view.setUint16(10, dosTime, true);
    view.setUint16(12, dosDate, true);
    view.setUint32(14, fileCrc, true);
    view.setUint32(18, size, true);      // compressed size
    view.setUint32(22, size, true);      // uncompressed size
    view.setUint16(26, nameBytes.length, true);
    view.setUint16(28, 0, true);         // extra field length
    localHeader.set(nameBytes, 30);

    parts.push(localHeader);
    parts.push(rawData);

    // Central directory header (46 bytes + name)
    const cdHeader = new Uint8Array(46 + nameBytes.length);
    const cdView = new DataView(cdHeader.buffer);
    cdView.setUint32(0, 0x02014b50, true); // signature
    cdView.setUint16(4, 20, true);         // version made by
    cdView.setUint16(6, 20, true);         // version needed
    cdView.setUint16(8, 0, true);          // flags
    cdView.setUint16(10, 0, true);         // compression
    cdView.setUint16(12, dosTime, true);
    cdView.setUint16(14, dosDate, true);
    cdView.setUint32(16, fileCrc, true);
    cdView.setUint32(20, size, true);      // compressed
    cdView.setUint32(24, size, true);      // uncompressed
    cdView.setUint16(28, nameBytes.length, true);
    cdView.setUint16(30, 0, true);         // extra len
    cdView.setUint16(32, 0, true);         // comment len
    cdView.setUint16(34, 0, true);         // disk start
    cdView.setUint16(36, 0, true);         // int attr
    cdView.setUint32(38, 0, true);         // ext attr
    cdView.setUint32(42, offset, true);    // local header offset
    cdHeader.set(nameBytes, 46);

    centralDirectoryHeaders.push(cdHeader);
    offset += localHeader.length + rawData.length;
  }

  const cdOffset = offset;
  let cdSize = 0;
  for (const cdh of centralDirectoryHeaders) {
    parts.push(cdh);
    cdSize += cdh.length;
  }

  // End of central directory record (22 bytes)
  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);
  eocdView.setUint32(0, 0x06054b50, true);
  eocdView.setUint16(4, 0, true);
  eocdView.setUint16(6, 0, true);
  eocdView.setUint16(8, files.length, true);
  eocdView.setUint16(10, files.length, true);
  eocdView.setUint32(12, cdSize, true);
  eocdView.setUint32(16, cdOffset, true);
  eocdView.setUint16(20, 0, true);
  parts.push(eocd);

  return new Blob(parts, { type: 'application/zip' });
}

/**
 * Loads an image from a URL, Blob, or Data URL into an HTML Image element.
 */
export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = (err) => reject(new Error('Failed to load image: ' + (err?.message || 'unknown error')));
    img.src = src;
  });
}

/**
 * Renders an image into a square canvas of given dimensions, preserving aspect ratio and centering.
 * If paddingPercent > 0, the image is rendered inside the safe area (used for maskable icons).
 */
export function renderIconCanvas(img, size, { paddingPercent = 0, background = null } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get 2D canvas context');

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, size, size);
  }

  const pad = Math.round(size * (paddingPercent / 100));
  const availableSize = size - pad * 2;

  const aspect = img.width / img.height;
  let drawW = availableSize;
  let drawH = availableSize;

  if (aspect > 1) {
    drawH = Math.round(availableSize / aspect);
  } else {
    drawW = Math.round(availableSize * aspect);
  }

  const drawX = pad + Math.round((availableSize - drawW) / 2);
  const drawY = pad + Math.round((availableSize - drawH) / 2);

  ctx.drawImage(img, drawX, drawY, drawW, drawH);
  return canvas;
}

/**
 * Converts a canvas to a PNG Uint8Array.
 */
export async function canvasToBytes(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('Failed to export canvas to Blob'));
        return;
      }
      const reader = new FileReader();
      reader.onload = () => resolve(new Uint8Array(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(blob);
    }, 'image/png');
  });
}

/**
 * Downscales and optimizes an uploaded department logo for storage in settings.
 * Fits within 384x384 while retaining PNG transparency, producing an efficient Data URL.
 */
export async function processUploadedLogo(file) {
  if (!file) throw new Error('No file provided');
  if (!file.type.match(/^image\/(png|jpeg|jpg|webp|svg\+xml)/)) {
    throw new Error('Please select a PNG, JPEG, WebP, or SVG image file.');
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await loadImage(objectUrl);
    // Fit within 384x384 max edge to keep data size light (~30-70KB)
    const maxEdge = 384;
    const aspect = img.width / img.height;
    let targetW = img.width;
    let targetH = img.height;

    if (targetW > maxEdge || targetH > maxEdge) {
      if (aspect > 1) {
        targetW = maxEdge;
        targetH = Math.round(maxEdge / aspect);
      } else {
        targetH = maxEdge;
        targetW = Math.round(maxEdge * aspect);
      }
    }

    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not get 2D canvas context');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, targetW, targetH);

    return canvas.toDataURL('image/png');
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export const PWA_ICON_SIZES = [
  { name: 'favicon-16x16.png', size: 16, label: '16×16 Favicon' },
  { name: 'favicon-32x32.png', size: 32, label: '32×32 Favicon' },
  { name: 'icon-48x48.png', size: 48, label: '48×48 Browser' },
  { name: 'icon-152x152.png', size: 152, label: '152×152 iPad' },
  { name: 'icon-180x180.png', size: 180, label: '180×180 Apple Touch' },
  { name: 'icon-192x192.png', size: 192, label: '192×192 PWA Android' },
  { name: 'icon-384x384.png', size: 384, label: '384×384 PWA Medium' },
  { name: 'icon-512x512.png', size: 512, label: '512×512 PWA Splash' },
  { name: 'icon-192x192-maskable.png', size: 192, label: '192×192 Maskable', paddingPercent: 12, background: '#0A2A5B' },
  { name: 'icon-512x512-maskable.png', size: 512, label: '512×512 Maskable', paddingPercent: 12, background: '#0A2A5B' },
];

/**
 * Generates all PWA asset files (PNGs and manifest) from a source image URL or Data URL.
 */
export async function generatePwaAssets(imageSrc, { departmentName = 'Station' } = {}) {
  const img = await loadImage(imageSrc);
  const files = [];

  for (const def of PWA_ICON_SIZES) {
    const canvas = renderIconCanvas(img, def.size, {
      paddingPercent: def.paddingPercent || 0,
      background: def.background || null,
    });
    const bytes = await canvasToBytes(canvas);
    files.push({
      name: `icons/${def.name}`,
      data: bytes,
      label: def.label,
      size: def.size,
      dataUrl: canvas.toDataURL('image/png'),
    });
  }

  const appName = `${departmentName ? `${departmentName} ` : ''}StationSync`.trim();
  const manifest = {
    id: './',
    name: appName,
    short_name: appName,
    description: `Station timeclock, scheduling and shift offers for ${departmentName || 'fire department'} members.`,
    start_url: './',
    scope: './',
    display: 'standalone',
    display_override: ['fullscreen', 'standalone'],
    orientation: 'any',
    background_color: '#0A2A5B',
    theme_color: '#0A2A5B',
    icons: [
      { src: 'icons/icon-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: 'icons/icon-384x384.png', sizes: '384x384', type: 'image/png', purpose: 'any' },
      { src: 'icons/icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: 'icons/icon-192x192-maskable.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: 'icons/icon-512x512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };

  files.push({
    name: 'manifest.webmanifest',
    data: JSON.stringify(manifest, null, 2),
    label: 'Web App Manifest',
  });

  return files;
}

/**
 * Triggers a browser download of a Blob.
 */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

let activeManifestBlobUrl = null;

/**
 * Dynamically updates the document head with runtime favicons and apple-touch-icon.
 */
export function updateRuntimePwaIcons(logoUrl, departmentName = '') {
  if (typeof document === 'undefined') return;

  if (!logoUrl) {
    // Revert to original / default icons
    if (activeManifestBlobUrl) {
      URL.revokeObjectURL(activeManifestBlobUrl);
      activeManifestBlobUrl = null;
    }
    return;
  }

  // Update existing favicon and apple-touch-icon links
  const iconLinks = document.querySelectorAll("link[rel*='icon']");
  iconLinks.forEach((link) => {
    link.href = logoUrl;
  });

  const appleLinks = document.querySelectorAll("link[rel='apple-touch-icon']");
  appleLinks.forEach((link) => {
    link.href = logoUrl;
  });

  // Dynamically update webmanifest
  try {
    const appName = `${departmentName ? `${departmentName} ` : ''}StationSync`.trim();
    const manifest = {
      id: './',
      name: appName,
      short_name: appName,
      description: `Station timeclock, scheduling and shift offers for ${departmentName || 'fire department'} members.`,
      start_url: './',
      scope: './',
      display: 'standalone',
      display_override: ['fullscreen', 'standalone'],
      orientation: 'any',
      background_color: '#0A2A5B',
      theme_color: '#0A2A5B',
      icons: [
        { src: logoUrl, sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: logoUrl, sizes: '512x512', type: 'image/png', purpose: 'any' },
      ],
    };

    if (activeManifestBlobUrl) {
      URL.revokeObjectURL(activeManifestBlobUrl);
    }
    const manifestBlob = new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/manifest+json' });
    activeManifestBlobUrl = URL.createObjectURL(manifestBlob);

    const manifestLink = document.querySelector("link[rel='manifest']");
    if (manifestLink) {
      manifestLink.href = activeManifestBlobUrl;
    }
  } catch {
    // Non-critical if manifest update fails
  }
}

