import { BadRequestException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import sharp from 'sharp';
import { documentFilePath } from '../../common/documents/document-storage.util';

export const STAFF_PHOTO_NAMESPACE = 'staff-photos';
export const CARD_ASSET_NAMESPACE = 'staff-card-assets';

export type ImageKind = 'photo' | 'logo' | 'signature';

const SPECS: Record<
  ImageKind,
  {
    width: number;
    height: number;
    fit: 'cover' | 'inside';
    format: 'jpeg' | 'png';
  }
> = {
  // Portrait, cropped around the face area; JPEG keeps the file small for printing.
  photo: { width: 480, height: 600, fit: 'cover', format: 'jpeg' },
  // Logos and signatures keep their transparency and their shape.
  logo: { width: 800, height: 400, fit: 'inside', format: 'png' },
  signature: { width: 600, height: 240, fit: 'inside', format: 'png' },
};

/**
 * Takes a file the upload layer has already verified is a genuine JPEG or PNG, re-encodes it to the size and format the
 * card needs, deletes the original, and returns the stored filename. Re-encoding drops camera metadata (location,
 * device) from staff photos and guarantees the card never embeds anything but pixels. A PDF is not an image: refused.
 */
export async function normaliseCardImage(
  uploaded: Pick<Express.Multer.File, 'filename' | 'mimetype'>,
  namespace: string,
  kind: ImageKind,
): Promise<string> {
  const source = documentFilePath(namespace, uploaded.filename);
  if (uploaded.mimetype === 'application/pdf') {
    await fs.promises.rm(source, { force: true });
    throw new BadRequestException('Please upload a JPEG or PNG image.');
  }
  const spec = SPECS[kind];
  const outName = `${randomUUID()}.${spec.format === 'jpeg' ? 'jpg' : 'png'}`;
  const target = path.join(path.dirname(source), outName);
  try {
    let pipeline = sharp(source)
      .rotate()
      .resize(spec.width, spec.height, {
        fit: spec.fit,
        position: kind === 'photo' ? 'attention' : 'centre',
        withoutEnlargement: kind !== 'photo',
      });
    pipeline =
      spec.format === 'jpeg'
        ? pipeline.flatten({ background: '#ffffff' }).jpeg({ quality: 86 })
        : pipeline.png({ compressionLevel: 9 });
    await pipeline.toFile(target);
  } catch {
    await fs.promises.rm(target, { force: true });
    throw new BadRequestException(
      'That image could not be read. Please upload a different JPEG or PNG.',
    );
  } finally {
    await fs.promises.rm(source, { force: true });
  }
  return outName;
}

/** Deletes a previously stored image; a missing file is not an error. */
export async function removeCardImage(
  namespace: string,
  filename: string | null | undefined,
): Promise<void> {
  if (!filename || filename.includes('/') || filename.includes('\\')) return;
  await fs.promises.rm(documentFilePath(namespace, filename), { force: true });
}

export async function readCardImage(
  namespace: string,
  filename: string | null | undefined,
): Promise<Buffer | null> {
  if (!filename || filename.includes('/') || filename.includes('\\'))
    return null;
  try {
    return await fs.promises.readFile(documentFilePath(namespace, filename));
  } catch {
    return null;
  }
}
