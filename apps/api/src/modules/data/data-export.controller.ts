import { Controller, Get, Res, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import type { AuthContext } from '../../common/interfaces/auth-context.interface';
import { resolveTenantFilter } from '../../common/utils/tenant.util';
import { PERMISSIONS } from '../rbac/constants/permissions.constant';
import { CsvExport, DataExportService } from './data-export.service';

@Controller('data-export')
@RequirePermissions(PERMISSIONS.DATA.EXPORT)
export class DataExportController {
  constructor(private readonly service: DataExportService) {}

  private stream(csv: CsvExport, res: Response): StreamableFile {
    res.set({
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="${csv.filename}"`,
    });
    return new StreamableFile(Buffer.from(csv.content, 'utf-8'));
  }

  @Get('customers')
  async customers(
    @CurrentUser() user: AuthContext,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    return this.stream(
      await this.service.exportCustomers(resolveTenantFilter(user)),
      res,
    );
  }

  @Get('invoices')
  async invoices(
    @CurrentUser() user: AuthContext,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    return this.stream(
      await this.service.exportInvoices(resolveTenantFilter(user)),
      res,
    );
  }

  @Get('flight-bookings')
  async flightBookings(
    @CurrentUser() user: AuthContext,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    return this.stream(
      await this.service.exportFlightBookings(resolveTenantFilter(user)),
      res,
    );
  }
}
