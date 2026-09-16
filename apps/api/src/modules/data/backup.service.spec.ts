import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as childProcess from 'child_process';
import * as fs from 'fs';
import { AuditService } from '../audit/audit.service';
import { BackupService } from './backup.service';

jest.mock('child_process');
jest.mock('fs');

describe('BackupService', () => {
  let service: BackupService;
  let auditService: { record: jest.Mock };
  const execFileMock = childProcess.execFile as unknown as jest.Mock;
  const fsMock = fs as jest.Mocked<typeof fs>;

  beforeEach(async () => {
    jest.clearAllMocks();
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/db';
    process.env.BACKUPS_DIR = '/tmp/backups';

    auditService = { record: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BackupService,
        { provide: AuditService, useValue: auditService },
      ],
    }).compile();

    service = module.get(BackupService);
  });

  describe('create', () => {
    it('invokes pg_dump with the connection string and a custom-format flag', async () => {
      execFileMock.mockImplementation((_file, _args, callback) => {
        callback(null, '', '');
      });
      fsMock.statSync.mockReturnValue({
        size: 12_345,
        birthtime: new Date('2026-01-01T00:00:00.000Z'),
      } as fs.Stats);

      const result = await service.create('identity-1');

      expect(execFileMock).toHaveBeenCalledWith(
        'pg_dump',
        expect.arrayContaining([
          'postgresql://user:pass@localhost:5432/db',
          '-F',
          'c',
        ]),
        expect.any(Function),
      );
      expect(result.sizeBytes).toBe(12_345);
      expect(result.filename).toMatch(/^backup-.*\.dump$/);
    });

    /**
     * Regression: pg_dump's URI parser rejects Prisma's own `?schema=`
     * query param outright ("invalid URI query parameter") since it's a
     * Prisma convention, not a libpq one — caught live in production on
     * this feature's first real deploy, not by a unit test, because the
     * local dev environment has no pg_dump on PATH to exercise this
     * against at all.
     */
    it('strips the Prisma-only ?schema= query param before invoking pg_dump', async () => {
      process.env.DATABASE_URL =
        'postgresql://user:pass@postgres:5432/alnajoum_erp?schema=public';
      execFileMock.mockImplementation((_file, _args, callback) => {
        callback(null, '', '');
      });
      fsMock.statSync.mockReturnValue({
        size: 1,
        birthtime: new Date(),
      } as fs.Stats);

      await service.create('identity-1');

      const [, args] = execFileMock.mock.calls[0] as [string, string[]];
      expect(args[0]).toBe('postgresql://user:pass@postgres:5432/alnajoum_erp');
    });

    it('records an audit entry with the actor and the backup size', async () => {
      execFileMock.mockImplementation((_file, _args, callback) => {
        callback(null, '', '');
      });
      fsMock.statSync.mockReturnValue({
        size: 12_345,
        birthtime: new Date(),
      } as fs.Stats);

      await service.create('identity-1');

      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          identityId: 'identity-1',
          action: 'backup.created',
          metadata: { sizeBytes: 12_345 },
        }),
      );
    });

    it('removes the partial file and rejects when pg_dump fails', async () => {
      execFileMock.mockImplementation((_file, _args, callback) => {
        callback(new Error('connection refused'), '', '');
      });

      await expect(service.create('identity-1')).rejects.toThrow(
        /pg_dump failed/,
      );
      expect(fsMock.rmSync).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ force: true }),
      );
      expect(auditService.record).not.toHaveBeenCalled();
    });
  });

  describe('listAll', () => {
    it('returns an empty list when the backups directory does not exist yet', () => {
      fsMock.existsSync.mockReturnValue(false);

      expect(service.listAll()).toEqual([]);
    });

    it('ignores a file that does not match the backup filename pattern', () => {
      fsMock.existsSync.mockReturnValue(true);
      fsMock.readdirSync.mockReturnValue([
        'backup-2026-01-01T00-00-00-000Z.dump',
        'not-a-backup.txt',
        '../escape-attempt.dump',
      ] as never);
      fsMock.statSync.mockReturnValue({
        size: 100,
        birthtime: new Date('2026-01-01T00:00:00.000Z'),
      } as fs.Stats);

      const result = service.listAll();

      expect(result).toHaveLength(1);
      expect(result[0].filename).toBe('backup-2026-01-01T00-00-00-000Z.dump');
    });

    it('sorts newest first', () => {
      fsMock.existsSync.mockReturnValue(true);
      fsMock.readdirSync.mockReturnValue([
        'backup-2026-01-01T00-00-00-000Z.dump',
        'backup-2026-06-01T00-00-00-000Z.dump',
      ] as never);
      fsMock.statSync.mockImplementation(
        (p) =>
          ({
            size: 100,
            birthtime: new Date(
              String(p).includes('06') ? '2026-06-01' : '2026-01-01',
            ),
          }) as fs.Stats,
      );

      const result = service.listAll();

      expect(result[0].filename).toContain('06-01');
      expect(result[1].filename).toContain('01-01T');
    });
  });

  describe('getFilePath / delete', () => {
    it('rejects a filename that does not match the safe pattern (path traversal defense)', () => {
      expect(() => service.getFilePath('../../etc/passwd')).toThrow(
        BadRequestException,
      );
    });

    it('throws NotFound for a well-formed filename that does not exist on disk', () => {
      fsMock.existsSync.mockReturnValue(false);

      expect(() =>
        service.getFilePath('backup-2026-01-01T00-00-00-000Z.dump'),
      ).toThrow(NotFoundException);
    });

    it('deletes the file and records an audit entry', async () => {
      fsMock.existsSync.mockReturnValue(true);

      await service.delete(
        'backup-2026-01-01T00-00-00-000Z.dump',
        'identity-1',
      );

      expect(fsMock.rmSync).toHaveBeenCalledWith(
        expect.stringContaining('backup-2026-01-01T00-00-00-000Z.dump'),
      );
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          identityId: 'identity-1',
          action: 'backup.deleted',
          entityId: 'backup-2026-01-01T00-00-00-000Z.dump',
        }),
      );
    });

    it('never reaches the filesystem for a path-traversal attempt on delete', async () => {
      await expect(
        service.delete('../../etc/passwd', 'identity-1'),
      ).rejects.toThrow(BadRequestException);
      expect(fsMock.rmSync).not.toHaveBeenCalled();
    });
  });
});
