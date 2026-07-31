import { BadRequestException } from '@nestjs/common';
import * as fs from 'fs';
import sharp from 'sharp';

/**
 * Below this Laplacian-variance score, an image is considered too blurry/flat
 * to reliably read (e.g. a photo of a passport that's out of focus, or a
 * blank/solid-color frame). Tunable via DOCUMENT_BLUR_THRESHOLD.
 *
 * Calibrated against a synthetic document-like test image (see
 * apps/api/calibrate-blur.ts) rendered at increasing Gaussian blur radii:
 * sigma 0 (sharp) ≈ 666, sigma 1.5 (mild softness) ≈ 54, sigma 2 (text
 * starting to blur) ≈ 15, sigma 3+ (clearly illegible) < 3. A threshold of
 * 20 rejects roughly sigma >= 2 while tolerating minor camera softness —
 * a starting point, not a value calibrated against real passport photos.
 */
const DEFAULT_BLUR_THRESHOLD = 20;

function getBlurThreshold(): number {
  const configured = Number(process.env.DOCUMENT_BLUR_THRESHOLD);
  return Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_BLUR_THRESHOLD;
}

/**
 * Approximates image sharpness via Laplacian-edge variance: a grayscale
 * Laplacian convolution highlights edges, and a sharp/in-focus image has
 * high-variance edge response while a blurry or flat image does not.
 */
async function computeSharpnessScore(filePath: string): Promise<number> {
  const { data, info } = await sharp(filePath)
    // Flatten away any alpha channel first: sharp's .convolve() produces a
    // degenerate all-zero result on images with (premultiplied) alpha, which
    // would otherwise make every PNG upload with transparency score as 0 and
    // get rejected regardless of actual sharpness.
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .resize(400, 400, { fit: 'inside', withoutEnlargement: true })
    .greyscale()
    // A light pre-blur suppresses sensor/JPEG-compression noise so the
    // Laplacian responds to genuine large-scale edges rather than block
    // artifacts — without it, even visibly out-of-focus JPEGs can retain
    // enough compression noise to score as "sharp".
    .blur(1)
    .convolve({
      width: 3,
      height: 3,
      kernel: [0, 1, 0, 1, -4, 1, 0, 1, 0],
    })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const pixelCount = info.width * info.height;
  if (pixelCount === 0) return 0;

  let sum = 0;
  for (let i = 0; i < data.length; i += 1) {
    sum += data[i];
  }
  const mean = sum / data.length;

  let variance = 0;
  for (let i = 0; i < data.length; i += 1) {
    const diff = data[i] - mean;
    variance += diff * diff;
  }
  return variance / data.length;
}

const IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png']);

/**
 * Rejects image uploads that are too blurry or visually flat to be legible
 * (e.g. an out-of-focus passport photo). Only applies to image/* files —
 * PDFs are skipped since single-frame sharpness scoring doesn't apply.
 */
export async function assertImageIsReadable(
  filePath: string,
  mimeType: string,
): Promise<void> {
  if (!IMAGE_MIME_TYPES.has(mimeType)) {
    return;
  }

  const score = await computeSharpnessScore(filePath);
  if (score < getBlurThreshold()) {
    throw new BadRequestException(
      'This image is too blurry or unclear to read. Please retake the photo — ' +
        'ensure good lighting, hold the camera steady, and make sure all text is in focus — then upload again.',
    );
  }
}

/**
 * Same as `assertImageIsReadable`, but deletes the just-uploaded file from
 * disk before rethrowing on failure, so a rejected upload never leaves an
 * orphaned file behind (multer's diskStorage has already written it by the
 * time this runs).
 */
export async function assertImageIsReadableOrCleanup(
  filePath: string,
  mimeType: string,
): Promise<void> {
  try {
    await assertImageIsReadable(filePath, mimeType);
  } catch (error) {
    await fs.promises.unlink(filePath).catch(() => undefined);
    throw error;
  }
}
