import {
  Controller,
  ForbiddenException,
  Get,
  Param,
  ParseEnumPipe,
} from '@nestjs/common';
import { PilgrimType } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthContext } from '../../common/interfaces/auth-context.interface';
import { CustomersService } from '../customers/customers.service';
import { CheckInService } from './checkin.service';
import { PilgrimLookupService } from './pilgrim-lookup.service';
import { ReadinessService } from './readiness.service';

/**
 * Spec #19 (pilgrim portal dashboard) / #37 ("My Travel Documents" download
 * section) — a customer's own view of their (or their family member's)
 * pilgrim record: group, readiness/document checklist, and QR code. No
 * @RequirePermissions() — CUSTOMER holds no RBAC permissions by design (see
 * HajjRegistrationsOwnController); access is scoped by ownership instead.
 */
@Controller('hajj-ops/portal')
export class PilgrimPortalController {
  constructor(
    private readonly customersService: CustomersService,
    private readonly pilgrimLookup: PilgrimLookupService,
    private readonly readinessService: ReadinessService,
    private readonly checkInService: CheckInService,
  ) {}

  @Get(':type/:id')
  async myStatus(
    @CurrentUser() user: AuthContext,
    @Param('type', new ParseEnumPipe(PilgrimType)) type: PilgrimType,
    @Param('id') id: string,
  ) {
    const customerId = await this.customersService.getCustomerIdForIdentity(
      user.sub,
    );
    const pilgrim = await this.pilgrimLookup.getPilgrim(type, id);
    const owns =
      pilgrim.customerId === customerId ||
      (pilgrim.familyMember && pilgrim.familyMember.customerId === customerId);
    if (!owns) {
      throw new ForbiddenException(
        'This pilgrim record does not belong to you',
      );
    }

    const [readiness, qr] = await Promise.all([
      this.readinessService.compute(type, id),
      this.checkInService.getOrCreateQrCode(type, id),
    ]);

    return {
      pilgrim: {
        id: pilgrim.id,
        firstName: pilgrim.firstName,
        lastName: pilgrim.lastName,
        group: pilgrim.group,
      },
      readiness,
      qrCode: qr.pilgrimCode,
    };
  }
}
