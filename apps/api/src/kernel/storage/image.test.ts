import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { MAX_IMAGE_SIDE, toStorableImage } from './image.js';

const picture = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: '#0f766e' } });

describe('uploaded pictures are stored as WebP', () => {
  it('converts a PNG and a JPEG to WebP, keeping small pictures at their size', async () => {
    for (const input of [
      await picture(40, 30).png().toBuffer(),
      await picture(40, 30).jpeg().toBuffer(),
    ]) {
      const out = await toStorableImage(input);
      expect(out?.contentType).toBe('image/webp');
      expect(out?.extension).toBe('webp');
      const meta = await sharp(out!.data).metadata();
      expect(meta.format).toBe('webp');
      expect([meta.width, meta.height]).toEqual([40, 30]);
    }
  });

  it('scales a large picture down to the longest side and keeps its proportions', async () => {
    const out = await toStorableImage(await picture(4800, 1200).png().toBuffer());
    const meta = await sharp(out!.data).metadata();
    expect([meta.width, meta.height]).toEqual([MAX_IMAGE_SIDE, MAX_IMAGE_SIDE / 4]);
  });

  it('applies the camera orientation and drops the metadata', async () => {
    // 60×20 stored, but EXIF orientation 6 = shown rotated: 20×60.
    const input = await picture(60, 20)
      .jpeg()
      .withMetadata({ orientation: 6, exif: { IFD0: { Artist: 'Someone' } } })
      .toBuffer();
    const meta = await sharp((await toStorableImage(input))!.data).metadata();
    expect([meta.width, meta.height]).toEqual([20, 60]);
    expect(meta.exif).toBeUndefined();
    expect(meta.orientation).toBeUndefined();
  });

  it('refuses files that are not pictures, or only pretend to be one', async () => {
    expect(await toStorableImage(Buffer.from('<svg onload=alert(1)>'))).toBeNull();
    const fakePng = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(64, 1),
    ]);
    expect(await toStorableImage(fakePng)).toBeNull();
  });
});
