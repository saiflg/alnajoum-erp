import { BadRequestException } from '@nestjs/common';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import sharp from 'sharp';
import {
  assertImageIsReadable,
  assertImageIsReadableOrCleanup,
} from './image-quality.util';

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'image-quality-test-'));

async function writeFlatImage(filePath: string): Promise<void> {
  await sharp({
    create: {
      width: 400,
      height: 400,
      channels: 3,
      background: { r: 200, g: 200, b: 200 },
    },
  })
    .jpeg()
    .toFile(filePath);
}

async function writeNoisyImage(filePath: string): Promise<void> {
  const size = 400;
  const buffer = Buffer.alloc(size * size * 3);
  for (let i = 0; i < buffer.length; i += 1) {
    // Deterministic high-frequency checkerboard-ish noise, not truly random,
    // so the test is reproducible while still having strong edge content.
    buffer[i] = (i * 2654435761) % 256;
  }
  await sharp(buffer, { raw: { width: size, height: size, channels: 3 } })
    .jpeg()
    .toFile(filePath);
}

function documentLikeSvg(): string {
  const lines = Array.from(
    { length: 12 },
    (_, i) =>
      `<text x="10" y="${30 + i * 30}" font-family="monospace" font-size="20">PASSPORT NO A1234567 SURNAME GIVEN NAMES</text>`,
  ).join('');
  return `<svg width="400" height="400" xmlns="http://www.w3.org/2000/svg">
    <rect width="400" height="400" fill="white"/>
    ${lines}
  </svg>`;
}

/** A sharp, text-bearing PNG that keeps its alpha channel (regression fixture). */
async function writeSharpImageWithAlpha(filePath: string): Promise<void> {
  await sharp(Buffer.from(documentLikeSvg())).png().toFile(filePath);
}

/** The same document-like image, Gaussian-blurred enough to be unreadable. */
async function writeBlurredDocumentImage(filePath: string): Promise<void> {
  await sharp(Buffer.from(documentLikeSvg())).blur(6).jpeg().toFile(filePath);
}

describe('image-quality.util', () => {
  afterAll(() => {
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
  });

  describe('assertImageIsReadable', () => {
    it('rejects a flat, solid-color image as too blurry to read', async () => {
      const filePath = path.join(TMP_DIR, 'flat.jpg');
      await writeFlatImage(filePath);

      await expect(
        assertImageIsReadable(filePath, 'image/jpeg'),
      ).rejects.toThrow(BadRequestException);
    });

    it('accepts a high-detail/noisy image as sharp enough to read', async () => {
      const filePath = path.join(TMP_DIR, 'noisy.jpg');
      await writeNoisyImage(filePath);

      await expect(
        assertImageIsReadable(filePath, 'image/jpeg'),
      ).resolves.toBeUndefined();
    });

    it('rejects a realistically blurred document photo', async () => {
      const filePath = path.join(TMP_DIR, 'blurred-document.jpg');
      await writeBlurredDocumentImage(filePath);

      await expect(
        assertImageIsReadable(filePath, 'image/jpeg'),
      ).rejects.toThrow(BadRequestException);
    });

    it('accepts a sharp image that has an alpha channel (regression)', async () => {
      // sharp's .convolve() previously produced an all-zero result for
      // premultiplied-alpha images, which made every PNG upload with
      // transparency score as unreadable regardless of actual sharpness.
      const filePath = path.join(TMP_DIR, 'sharp-with-alpha.png');
      await writeSharpImageWithAlpha(filePath);

      await expect(
        assertImageIsReadable(filePath, 'image/png'),
      ).resolves.toBeUndefined();
    });

    it('skips the check entirely for non-image mime types (e.g. PDF)', async () => {
      const filePath = path.join(TMP_DIR, 'flat-but-pdf.jpg');
      await writeFlatImage(filePath);

      await expect(
        assertImageIsReadable(filePath, 'application/pdf'),
      ).resolves.toBeUndefined();
    });
  });

  describe('assertImageIsReadableOrCleanup', () => {
    it('deletes the file and rethrows when the image is rejected', async () => {
      const filePath = path.join(TMP_DIR, 'flat-to-delete.jpg');
      await writeFlatImage(filePath);
      expect(fs.existsSync(filePath)).toBe(true);

      await expect(
        assertImageIsReadableOrCleanup(filePath, 'image/jpeg'),
      ).rejects.toThrow(BadRequestException);

      expect(fs.existsSync(filePath)).toBe(false);
    });

    it('leaves the file in place when the image passes', async () => {
      const filePath = path.join(TMP_DIR, 'noisy-to-keep.jpg');
      await writeNoisyImage(filePath);

      await expect(
        assertImageIsReadableOrCleanup(filePath, 'image/jpeg'),
      ).resolves.toBeUndefined();
      expect(fs.existsSync(filePath)).toBe(true);
    });
  });
});
