import { BadRequestException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import type { FileFilterCallback, StorageEngine } from 'multer';
import * as path from 'path';
import { Request } from 'express';
import { Transform, TransformCallback } from 'stream';
import {
  detectMime,
  EXTENSION_BY_MIME,
  SIGNATURE_BYTES,
} from './file-signature';

export const ALLOWED_DOCUMENT_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'application/pdf',
];

export const MAX_DOCUMENT_SIZE_BYTES = 5 * 1024 * 1024; // 5MB

/** `namespace` picks the upload subfolder, e.g. "customer-documents". */
export function documentsUploadRoot(namespace: string): string {
  return path.resolve(
    process.cwd(),
    process.env.UPLOADS_DIR ?? './uploads',
    namespace,
  );
}

export function documentFilePath(
  namespace: string,
  storedFileName: string,
): string {
  return path.join(documentsUploadRoot(namespace), storedFileName);
}

/**
 * Holds the first bytes of the upload, decides what the file really is, and only then lets anything
 * through to disk. The file is accepted only when its content matches the type the client declared.
 */
class SignatureGate extends Transform {
  private head = Buffer.alloc(0);
  private decided = false;
  constructor(private readonly declaredMime: string) {
    super();
  }

  private decide(): Error | null {
    this.decided = true;
    const real = detectMime(this.head);
    if (!real || real !== this.declaredMime) {
      return new BadRequestException(
        'The file content does not match its declared type. Only genuine JPEG, PNG or PDF files are accepted.',
      );
    }
    return null;
  }

  _transform(chunk: Buffer, _enc: BufferEncoding, cb: TransformCallback) {
    if (this.decided) return cb(null, chunk);
    this.head = Buffer.concat([this.head, chunk]);
    if (this.head.length < SIGNATURE_BYTES) return cb(); // not enough to judge yet
    const err = this.decide();
    if (err) return cb(err);
    const out = this.head;
    this.head = Buffer.alloc(0);
    cb(null, out);
  }

  _flush(cb: TransformCallback) {
    if (this.decided) return cb();
    const err = this.decide(); // a tiny file: judge what there is
    if (err) return cb(err);
    this.push(this.head);
    cb();
  }
}

/**
 * Multer disk storage that (a) names the file from its VERIFIED type, never the client's file name (a
 * client-chosen extension such as .html was kept before), and (b) refuses content that is not what it
 * claims to be. Same random-UUID naming and folder layout as before.
 */
class VerifiedDiskStorage implements StorageEngine {
  constructor(private readonly namespace: string) {}

  _handleFile(
    _req: Request,
    file: Express.Multer.File,
    callback: (error?: unknown, info?: Partial<Express.Multer.File>) => void,
  ): void {
    const dir = documentsUploadRoot(this.namespace);
    fs.mkdirSync(dir, { recursive: true });
    const ext =
      EXTENSION_BY_MIME[file.mimetype as keyof typeof EXTENSION_BY_MIME] ?? '';
    const filename = `${randomUUID()}${ext}`;
    const finalPath = path.join(dir, filename);
    const out = fs.createWriteStream(finalPath);
    const gate = new SignatureGate(file.mimetype);

    let settled = false;
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      file.stream.unpipe();
      // Remove the file only once the stream has really closed: destroying a stream whose open() is still
      // pending would otherwise create the file after the unlink and leave an empty file behind.
      const removeThenReport = () =>
        fs.unlink(finalPath, () => callback(error));
      if (out.closed) removeThenReport();
      else {
        out.once('close', removeThenReport);
        out.destroy();
      }
    };

    gate.on('error', fail);
    out.on('error', fail);
    file.stream.on('error', fail);
    out.on('finish', () => {
      if (settled) return;
      settled = true;
      callback(null, {
        destination: dir,
        filename,
        path: finalPath,
        size: out.bytesWritten,
      });
    });
    file.stream.pipe(gate).pipe(out);
  }

  _removeFile(
    _req: Request,
    file: Express.Multer.File,
    callback: (error: Error | null) => void,
  ): void {
    fs.unlink(file.path, (err) =>
      callback(err && err.code !== 'ENOENT' ? err : null),
    );
  }
}

export function createDocumentMulterOptions(namespace: string) {
  return {
    storage: new VerifiedDiskStorage(namespace),
    limits: { fileSize: MAX_DOCUMENT_SIZE_BYTES },
    fileFilter: (
      _req: Request,
      file: Express.Multer.File,
      callback: FileFilterCallback,
    ) => {
      if (!ALLOWED_DOCUMENT_MIME_TYPES.includes(file.mimetype)) {
        callback(
          new BadRequestException(
            `Unsupported file type "${file.mimetype}". Allowed: ${ALLOWED_DOCUMENT_MIME_TYPES.join(', ')}`,
          ),
        );
        return;
      }
      callback(null, true);
    },
  };
}
