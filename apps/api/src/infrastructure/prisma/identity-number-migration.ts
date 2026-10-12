import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { FieldCipher } from '../../common/security/field-cipher';
import { IDENTITY_NUMBER_COLUMNS } from './identity-number-encryption';
import { PrismaService } from './prisma.service';

type Delegate = {
  findUnique: (args: unknown) => Promise<Record<string, unknown> | null>;
  update: (args: unknown) => Promise<unknown>;
};

const BATCH = 500;

/**
 * Seals passport numbers written before encryption existed, once, at startup (the same approach as the staff
 * bank-account numbers). Plaintext rows, and rows sealed under an older key id, are re-saved through the encrypting
 * client; customers also get their lookup fingerprint. Idempotent: rows already sealed under the active key are not
 * touched, so a normal start does one cheap query per column.
 */
@Injectable()
export class IdentityNumberMigration implements OnModuleInit {
  private readonly logger = new Logger(IdentityNumberMigration.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.run();
    } catch (err) {
      this.logger.error(
        `Could not encrypt passport numbers: ${(err as Error).message}`,
      );
    }
  }

  async run(): Promise<{ sealed: number; indexed: number }> {
    const activeKey = FieldCipher.default().activeKeyId;
    let sealed = 0;
    for (const col of IDENTITY_NUMBER_COLUMNS) {
      const table = this.tableOf(col.model);
      const delegate = this.delegate(col.delegate);
      const seen = new Set<string>();
      for (;;) {
        const rows = await this.prisma.$queryRawUnsafe<{ id: string }[]>(
          `SELECT "id" FROM "${table}" WHERE "${col.field}" IS NOT NULL AND "${col.field}" NOT LIKE $1 LIMIT ${BATCH}`,
          `enc:v1:${activeKey}:%`,
        );
        const fresh = rows.filter((r) => !seen.has(r.id));
        if (fresh.length === 0) break; // nothing left, or only rows that could not be re-saved
        for (const { id } of fresh) {
          seen.add(id);
          if (await this.resave(delegate, id, col.field)) sealed++;
        }
      }
    }

    // Customers sealed before the lookup fingerprint existed.
    let indexed = 0;
    const customers = this.delegate('customer');
    const seen = new Set<string>();
    for (;;) {
      const rows = await this.prisma.$queryRawUnsafe<{ id: string }[]>(
        `SELECT "id" FROM "${this.tableOf('Customer')}" WHERE "passportNumber" IS NOT NULL AND "passportNumberIndex" IS NULL LIMIT ${BATCH}`,
      );
      const fresh = rows.filter((r) => !seen.has(r.id));
      if (fresh.length === 0) break;
      for (const { id } of fresh) {
        seen.add(id);
        if (await this.resave(customers, id, 'passportNumber')) indexed++;
      }
    }

    if (sealed || indexed)
      this.logger.log(
        `Encrypted ${sealed} passport number(s); indexed ${indexed} customer(s)`,
      );
    return { sealed, indexed };
  }

  /** Reads the value through the decrypting client and writes it back through the encrypting one. */
  private async resave(
    delegate: Delegate,
    id: string,
    field: string,
  ): Promise<boolean> {
    try {
      const row = await delegate.findUnique({
        where: { id },
        select: { [field]: true },
      });
      const value = row?.[field];
      if (typeof value !== 'string' || value.startsWith('[unreadable')) {
        return false;
      }
      await delegate.update({ where: { id }, data: { [field]: value } });
      return true;
    } catch (err) {
      this.logger.error(
        `Could not re-save ${field} of ${id}: ${(err as Error).message}`,
      );
      return false;
    }
  }

  private delegate(name: string): Delegate {
    return (this.prisma as unknown as Record<string, Delegate>)[name];
  }

  private tableOf(model: string): string {
    const found = Prisma.dmmf.datamodel.models.find((m) => m.name === model);
    return found?.dbName ?? model;
  }
}
