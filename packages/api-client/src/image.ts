/**
 * Pictures are re-encoded as WebP in the browser before they are uploaded (owner's rule,
 * 2026-10-21): uploads get smaller — a pasted screenshot fits the 2 MB limit — and the longest
 * side is kept to `MAX_SIDE`. The server converts every upload to WebP again, so a browser that
 * cannot encode WebP simply sends the original file.
 */
const MAX_SIDE = 2400;
const QUALITY = 0.85;

export async function toWebpForUpload(file: Blob): Promise<Blob> {
  if (typeof document === 'undefined' || typeof createImageBitmap !== 'function') return file;
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) return file;
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((done) =>
      canvas.toBlob(done, 'image/webp', QUALITY),
    );
    // Some browsers fall back to PNG when they cannot encode WebP.
    if (!blob || blob.type !== 'image/webp') return file;
    return file.type === 'image/webp' && blob.size >= file.size ? file : blob;
  } catch {
    return file;
  }
}

/** The multipart body of an image upload (one `file` field). */
export async function imageForm(file: Blob): Promise<FormData> {
  const image = await toWebpForUpload(file);
  const form = new FormData();
  if (image.type === 'image/webp') form.append('file', image, 'image.webp');
  else form.append('file', image);
  return form;
}
