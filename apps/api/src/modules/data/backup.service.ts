import { execFile } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service';

const execFileAsync = promisify(execFile);

/** A safe, self-generated filename shape — also doubles as the validator
 * for a filename coming back in from a request (download/delete), which
 * is the one place path-traversal actually matters (`../../etc/passwd`
 * as a ":filename" param). Never accept a filename that doesn't match this. */
const BACKUP_FILENAME_PATTERN =
  /^backup-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.dump$/;

export interface BackupInfo {
  filename: string;
  sizeBytes: number;
  createdAt: string;
}

/**
 * Phase 11's "backup management" — platform-wide, not tenant-scoped
 * (see BACKUP.MANAGE's own comment): a single Postgres instance backs
 * every tenant, so a backup is inherently a Super Admin operation.
 *
 * Deliberately create/list/download/delete only — no restore endpoint.
 * A safe restore needs things this platform doesn't have yet
 * (maintenance mode to drain connections, a confirmation flow harder to
 * misfire than a single click, a place to test the restored data before
 * it's live) — building an "overwrite the live database" button without
 * those is a bigger, separate piece of work, not a corner to cut here.
 * What this does give an admin: a real, downloadable snapshot they can
 * store off-server, which is the actual safety property "backups" is
 * about.
 *
 * Shells out to pg_dump/the Postgres client tools rather than a JS
 * reimplementation — there's no reliable npm equivalent that produces a
 * real, restorable dump. Requires postgresql-client installed in the
 * runtime image (see apps/api/Dockerfile) and DATABASE_URL on the
 * environment, same connection string Prisma already uses — pg_dump
 * accepts a full connection URI as of Postgres 9.2+, so no separate
 * parsing of it is needed here.
 */
@Injectable()
export class BackupService {
  constructor(private readonly auditService: AuditService) {}

  private backupsDir(): string {
    return path.resolve(process.cwd(), process.env.BACKUPS_DIR ?? './backups');
  }

  private validateFilename(filename: string): string {
    if (!BACKUP_FILENAME_PATTERN.test(filename)) {
      throw new BadRequestException('Invalid backup filename');
    }
    return path.join(this.backupsDir(), filename);
  }

  /** Prisma's own connection string carries a `?schema=` query param it
   * interprets itself — that's a Prisma convention, not a libpq one, and
   * pg_dump's URI parser rejects it outright ("invalid URI query
   * parameter"). pg_dump has no equivalent connection-string option for
   * "default schema" anyway (schema selection there is -n/--schema on
   * the dump itself, not the connection), so the fix is just to strip
   * it — the whole database still dumps correctly, public schema
   * included, since that's the only schema this platform uses. */
  private pgDumpConnectionString(databaseUrl: string): string {
    const url = new URL(databaseUrl);
    url.searchParams.delete('schema');
    return url.toString();
  }

  async create(triggeredByIdentityId: string): Promise<BackupInfo> {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new InternalServerErrorException('DATABASE_URL is not configured');
    }

    const dir = this.backupsDir();
    fs.mkdirSync(dir, { recursive: true });

    // Custom format (-F c): compressed and restorable with pg_restore,
    // including selectively — the standard choice for anything beyond a
    // toy database, over a plain .sql text dump.
    const filename = `backup-${new Date().toISOString().replace(/[:.]/g, '-')}.dump`;
    const filePath = path.join(dir, filename);

    try {
      await execFileAsync('pg_dump', [
        this.pgDumpConnectionString(databaseUrl),
        '-F',
        'c',
        '-f',
        filePath,
      ]);
    } catch (error) {
      // Never leave a partial/corrupt file behind for listCustomers to
      // pick up as if it were a real, restorable backup.
      fs.rmSync(filePath, { force: true });
      const message = error instanceof Error ? error.message : String(error);
      throw new InternalServerErrorException(`pg_dump failed: ${message}`);
    }

    const stats = fs.statSync(filePath);

    await this.auditService.record({
      identityId: triggeredByIdentityId,
      action: 'backup.created',
      entityType: 'DatabaseBackup',
      entityId: filename,
      metadata: { sizeBytes: stats.size },
    });

    return {
      filename,
      sizeBytes: stats.size,
      createdAt: stats.birthtime.toISOString(),
    };
  }

  listAll(): BackupInfo[] {
    const dir = this.backupsDir();
    if (!fs.existsSync(dir)) return [];

    return fs
      .readdirSync(dir)
      .filter((filename) => BACKUP_FILENAME_PATTERN.test(filename))
      .map((filename) => {
        const stats = fs.statSync(path.join(dir, filename));
        return {
          filename,
          sizeBytes: stats.size,
          createdAt: stats.birthtime.toISOString(),
        };
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  getFilePath(filename: string): string {
    const filePath = this.validateFilename(filename);
    if (!fs.existsSync(filePath)) {
      throw new NotFoundException('Backup not found');
    }
    return filePath;
  }

  async delete(filename: string, actorIdentityId: string): Promise<void> {
    const filePath = this.getFilePath(filename);
    fs.rmSync(filePath);

    await this.auditService.record({
      identityId: actorIdentityId,
      action: 'backup.deleted',
      entityType: 'DatabaseBackup',
      entityId: filename,
    });
  }
}
