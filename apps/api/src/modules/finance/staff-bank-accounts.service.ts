import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import {
  openBankAccount,
  sealBankAccount,
} from '../../common/security/bank-account-cipher';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

/** 0123456789 -> ******6789. Enough for a person to recognise the account, not to use it. */
export function maskAccountNumber(value: string): string {
  const digits = value.trim();
  if (digits.length <= 4) return '*'.repeat(digits.length);
  return '*'.repeat(digits.length - 4) + digits.slice(-4);
}

/** Spec #12 — the Finance-side half of staff payout bank account verification (the staff self-service update lives in StaffPayoutsController). */
@Injectable()
export class StaffBankAccountsService implements OnModuleInit {
  private readonly logger = new Logger(StaffBankAccountsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  /** Phase 22 S-24: account numbers written before encryption existed are sealed once, at startup. */
  async onModuleInit(): Promise<void> {
    try {
      const rows = await this.prisma.staff.findMany({
        where: {
          bankAccountNumber: { not: null },
          NOT: { bankAccountNumber: { startsWith: 'enc:v1:' } },
        },
        select: { id: true, bankAccountNumber: true },
      });
      for (const row of rows) {
        await this.prisma.staff.update({
          where: { id: row.id },
          data: {
            bankAccountNumber: sealBankAccount(row.id, row.bankAccountNumber!),
          },
        });
      }
      if (rows.length)
        this.logger.log(
          `Encrypted ${rows.length} staff bank account number(s)`,
        );
    } catch (err) {
      this.logger.error(
        `Could not encrypt bank account numbers: ${(err as Error).message}`,
      );
    }
  }

  async listUnverified(tenant?: string) {
    const rows = await this.prisma.staff.findMany({
      where: {
        bankAccountVerified: false,
        bankAccountNumber: { not: null },
        ...(tenant !== undefined && { companyId: tenant }),
      },
      take: 500,
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
    // The verifier has to see the real number to compare it with the bank's records.
    return rows.map((r) => ({
      ...r,
      bankAccountNumber: openBankAccount(r.id, r.bankAccountNumber!),
    }));
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
    // Segregation of duties: you cannot vouch for your own payout account.
    if (staff.id === verifiedByStaffId) {
      throw new ForbiddenException(
        'You cannot verify your own payout bank account',
      );
    }

    await this.prisma.staff.update({
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

    // Never echo the account number back: the verifier already saw it on the list.
    return {
      staffId,
      bankName: staff.bankName,
      bankAccountNumber: maskAccountNumber(
        openBankAccount(staff.id, staff.bankAccountNumber),
      ),
      bankAccountVerified: true,
    };
  }
}
