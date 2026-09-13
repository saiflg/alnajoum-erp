import {
  BadRequestException,
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import type { AuthContext } from '../../common/interfaces/auth-context.interface';
import { resolveTenantFilter } from '../../common/utils/tenant.util';
import { PERMISSIONS } from '../rbac/constants/permissions.constant';
import { DataImportService } from './data-import.service';

const MAX_IMPORT_SIZE_BYTES = 2 * 1024 * 1024; // 2MB — a bulk customer list has no business being bigger

/** Held in memory, never written to disk — parsed once and discarded,
 * unlike CustomerDocument uploads which need to persist permanently
 * (see document-storage.util.ts's diskStorage). */
const csvUploadOptions = {
  storage: memoryStorage(),
  limits: { fileSize: MAX_IMPORT_SIZE_BYTES },
};

@Controller('data-import')
@RequirePermissions(PERMISSIONS.DATA.IMPORT)
export class DataImportController {
  constructor(private readonly service: DataImportService) {}

  /** A Super Admin has no single tenant to attribute imported customers
   * to — same reasoning as FlightSuppliersController.create. */
  @Post('customers')
  @UseInterceptors(FileInterceptor('file', csvUploadOptions))
  async importCustomers(
    @CurrentUser() user: AuthContext,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException(
        'No file uploaded — expected a "file" field',
      );
    }
    const tenantCompanyId = resolveTenantFilter(user);
    if (tenantCompanyId === undefined) {
      throw new BadRequestException(
        'Super Admin has no single tenant to import customers into — sign in as a tenant admin instead.',
      );
    }
    return this.service.importCustomers(
      file.buffer.toString('utf-8'),
      tenantCompanyId,
      user.sub,
    );
  }
}
