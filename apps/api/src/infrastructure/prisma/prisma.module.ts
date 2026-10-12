import { Global, Module } from '@nestjs/common';
import { IdentityNumberMigration } from './identity-number-migration';
import { PrismaService } from './prisma.service';

@Global()
@Module({
  providers: [PrismaService, IdentityNumberMigration],
  exports: [PrismaService],
})
export class PrismaModule {}
