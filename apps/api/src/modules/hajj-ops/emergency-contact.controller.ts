import { Controller, Get, Param, ParseEnumPipe } from '@nestjs/common';
import { PilgrimType } from '@prisma/client';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { PERMISSIONS } from '../rbac/constants/permissions.constant';
import { PilgrimLookupService } from './pilgrim-lookup.service';

/**
 * Spec #27 — emergency contact access restricted to authorized personnel.
 * Reuses Customer/FamilyMember's existing emergencyContactName/Phone fields
 * rather than a new model; this endpoint's only job is the access
 * restriction (EMERGENCY_CONTACT_VIEW), not new storage.
 */
@Controller('hajj-ops/emergency-contact')
export class EmergencyContactController {
  constructor(private readonly pilgrimLookup: PilgrimLookupService) {}

  @Get(':type/:id')
  @RequirePermissions(PERMISSIONS.HAJJ_OPS.EMERGENCY_CONTACT_VIEW)
  async get(
    @Param('type', new ParseEnumPipe(PilgrimType)) type: PilgrimType,
    @Param('id') id: string,
  ) {
    const pilgrim = await this.pilgrimLookup.getPilgrim(type, id);
    const source = pilgrim.customer ?? pilgrim.familyMember;
    return {
      pilgrimName: `${pilgrim.firstName} ${pilgrim.lastName}`,
      emergencyContactName: source?.emergencyContactName ?? null,
      emergencyContactPhone: source?.emergencyContactPhone ?? null,
    };
  }
}
