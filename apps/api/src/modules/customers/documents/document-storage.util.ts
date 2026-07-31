import { BadRequestException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import { diskStorage, FileFilterCallback } from 'multer';
import * as path from 'path';
import { Request } from 'express';

export const ALLOWED_DOCUMENT_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'application/pdf',
];

export const MAX_DOCUMENT_SIZE_BYTES = 5 * 1024 * 1024; // 5MB

export function documentsUploadRoot(): string {
  return path.resolve(process.cwd(), process.env.UPLOADS_DIR ?? './uploads', 'customer-documents');
}

export function documentFilePath(storedFileName: string): string {
  return path.join(documentsUploadRoot(), storedFileName);
}

export const documentMulterOptions = {
  storage: diskStorage({
    destination: (
      _req: Request,
      _file: Express.Multer.File,
      callback: (error: Error | null, destination: string) => void,
    ) => {
      const dir = documentsUploadRoot();
      fs.mkdirSync(dir, { recursive: true });
      callback(null, dir);
    },
    filename: (
      _req: Request,
      file: Express.Multer.File,
      callback: (error: Error | null, filename: string) => void,
    ) => {
      const ext = path.extname(file.originalname);
      callback(null, `${randomUUID()}${ext}`);
    },
  }),
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
