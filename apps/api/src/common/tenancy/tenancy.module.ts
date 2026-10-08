import { Global, Module } from '@nestjs/common';
import { TenantGuardService } from './tenant-guard.service';

/** Global so any controller or service can inject TenantGuardService without importing a module. */
@Global()
@Module({
  providers: [TenantGuardService],
  exports: [TenantGuardService],
})
export class TenancyModule {}
