import sharp from 'sharp';
import { sniffImageType } from './file-storage.js';

/** The longest side an uploaded picture keeps; larger ones are scaled down. */
export const MAX_IMAGE_SIDE = 2400;

export type StorableImage = { data: Buffer; contentType: 'image/webp'; extension: 'webp' };

/**
 * Every uploaded picture is stored as WebP (owner's rule, 2026-10-21): the real type is checked
 * from its bytes (JPEG, PNG or WebP), the EXIF orientation applied and the metadata dropped,
 * the picture scaled down to `MAX_IMAGE_SIDE` and encoded at quality 82. Returns null for a
 * file that is not one of those pictures or cannot be decoded.
 */
export async function toStorableImage(input: Buffer): Promise<StorableImage | null> {
  if (!sniffImageType(input)) return null;
  try {
    const data = await sharp(input, { limitInputPixels: 50_000_000, failOn: 'error' })
      .rotate()
      .resize({
        width: MAX_IMAGE_SIDE,
        height: MAX_IMAGE_SIDE,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: 82, effort: 4 })
      .toBuffer();
    return { data, contentType: 'image/webp', extension: 'webp' };
  } catch {
    return null;
  }
}
