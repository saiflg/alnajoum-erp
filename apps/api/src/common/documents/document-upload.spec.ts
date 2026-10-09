import {
  Controller,
  INestApplication,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import request from 'supertest';
import { HttpExceptionFilter } from '../filters/http-exception.filter';
import { createDocumentMulterOptions } from './document-storage.util';

@Controller('probe')
class UploadProbe {
  @Post()
  @UseInterceptors(
    FileInterceptor('file', createDocumentMulterOptions('probe-docs')),
  )
  upload(@UploadedFile() file: Express.Multer.File) {
    return { filename: file.filename, size: file.size };
  }
}

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64, 1),
]);
const JPEG = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
  Buffer.alloc(64, 2),
]);
const PDF = Buffer.from('%PDF-1.7\n1 0 obj<<>>endobj\n%%EOF');
const HTML = Buffer.from(
  '<!doctype html><script>alert(document.cookie)</script>',
);

jest.setTimeout(60_000);

describe('verified document uploads (Phase 22 S-31)', () => {
  let app: INestApplication;
  let dir: string;
  const saved = process.env.UPLOADS_DIR;

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uploads-'));
    process.env.UPLOADS_DIR = dir;
    const moduleRef = await Test.createTestingModule({
      controllers: [UploadProbe],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
  });
  afterAll(async () => {
    await app.close();
    if (saved === undefined) delete process.env.UPLOADS_DIR;
    else process.env.UPLOADS_DIR = saved;
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const stored = () =>
    fs.existsSync(path.join(dir, 'probe-docs'))
      ? fs.readdirSync(path.join(dir, 'probe-docs'))
      : [];
  beforeEach(() =>
    fs.rmSync(path.join(dir, 'probe-docs'), { recursive: true, force: true }),
  );

  it('stores a genuine PNG under a name built from the verified type, not the client file name', async () => {
    const res = await request(app.getHttpServer())
      .post('/probe')
      .attach('file', PNG, { filename: 'evil.html', contentType: 'image/png' })
      .expect(201);
    expect(res.body.filename).toMatch(/^[0-9a-f-]{36}\.png$/);
    expect(stored()).toEqual([res.body.filename]);
    expect(
      fs
        .readFileSync(path.join(dir, 'probe-docs', res.body.filename))
        .equals(PNG),
    ).toBe(true);
  });

  it('accepts a genuine JPEG and a genuine PDF', async () => {
    const jpg = await request(app.getHttpServer())
      .post('/probe')
      .attach('file', JPEG, { filename: 'a.jpeg', contentType: 'image/jpeg' })
      .expect(201);
    expect(jpg.body.filename).toMatch(/\.jpg$/);
    const pdf = await request(app.getHttpServer())
      .post('/probe')
      .attach('file', PDF, {
        filename: 'a.pdf',
        contentType: 'application/pdf',
      })
      .expect(201);
    expect(pdf.body.filename).toMatch(/\.pdf$/);
  });

  it('rejects HTML uploaded as an image and leaves nothing on disk', async () => {
    await request(app.getHttpServer())
      .post('/probe')
      .attach('file', HTML, {
        filename: 'passport.png',
        contentType: 'image/png',
      })
      .expect(400);
    expect(stored()).toEqual([]);
  });

  it('rejects a real file whose declared type is wrong (a JPEG sent as a PDF)', async () => {
    await request(app.getHttpServer())
      .post('/probe')
      .attach('file', JPEG, {
        filename: 'a.pdf',
        contentType: 'application/pdf',
      })
      .expect(400);
    expect(stored()).toEqual([]);
  });

  it('rejects a file too small to carry any signature', async () => {
    await request(app.getHttpServer())
      .post('/probe')
      .attach('file', Buffer.from('abc'), {
        filename: 'a.png',
        contentType: 'image/png',
      })
      .expect(400);
    expect(stored()).toEqual([]);
  });

  it('still refuses declared types outside the allow-list', async () => {
    await request(app.getHttpServer())
      .post('/probe')
      .attach('file', HTML, { filename: 'a.html', contentType: 'text/html' })
      .expect(400);
    expect(stored()).toEqual([]);
  });
});
