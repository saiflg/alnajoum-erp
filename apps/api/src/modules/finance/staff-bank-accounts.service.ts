import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

/** Spec #12 — the Finance-side half of staff payout bank account verification (the staff self-service update lives in StaffPayoutsController). */
@Injectable()
export class StaffBankAccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  listUnverified() {
    return this.prisma.staff.findMany({
      where: {
        bankAccountVerified: false,
        bankAccountNumber: { not: null },
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        employeeCode: true,
        bankName: true,
        bankAccountNumber: true,
        bankAccountName: true,
      },
      orderBy: { lastName: 'asc' },
    });
  }

  async verify(
    staffId: string,
    verifiedByStaffId: string,
    actorIdentityId?: string,
  ) {
    const staff = await this.prisma.staff.findUnique({
      where: { id: staffId },
    });
    if (!staff) {
      throw new NotFoundException('Staff member not found');
    }
    if (!staff.bankName || !staff.bankAccountNumber || !staff.bankAccountName) {
      throw new BadRequestException(
        'This staff member has no bank details on file to verify',
      );
    }

    const updated = await this.prisma.staff.update({
      where: { id: staffId },
      data: {
        bankAccountVerified: true,
        bankAccountVerifiedAt: new Date(),
        bankAccountVerifiedByStaffId: verifiedByStaffId,
      },
    });

    await this.auditService.record({
      identityId: actorIdentityId,
      action: 'staff_bank_account.verified',
      entityType: 'Staff',
      entityId: staffId,
      metadata: { verifiedByStaffId },
    });

    return updated;
  }
}
