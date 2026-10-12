import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { FieldCipher } from '../../common/security/field-cipher';
import { identityNumberEncryption } from './identity-number-encryption';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      log: [
        { level: 'warn', emit: 'stdout' },
        { level: 'error', emit: 'stdout' },
      ],
    });
    // Passport numbers are encrypted on their way into the database and decrypted on the way out (see
    // identity-number-encryption.ts). Everything else in the app keeps using this object exactly as before;
    // it is the extended client, with the lifecycle hooks Nest looks for carried over to it.
    const extended = this.$extends(
      identityNumberEncryption(FieldCipher.default()),
    );
    return Object.assign(extended, {
      onModuleInit: () => this.onModuleInit(),
      onModuleDestroy: () => this.onModuleDestroy(),
    }) as unknown as PrismaService;
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Connected to PostgreSQL via Prisma');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
