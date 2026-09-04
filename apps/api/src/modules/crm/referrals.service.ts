import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ReferralStatus } from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

function generateReferralCode(): string {
  return `REF${randomBytes(3).toString('hex').toUpperCase()}`;
}

/** Spec #29 — rewards are never auto-paid; only `markQualified`/`markRewarded` (an explicit staff action against configured eligibility) moves a referral out of PENDING. */
@Injectable()
export class ReferralsService {
  constructor(private readonly prisma: PrismaService) {}

  async getOrCreateCode(customerId: string) {
    const existing = await this.prisma.referralCode.findUnique({
      where: { customerId },
    });
    if (existing) return existing;
    return this.prisma.referralCode.create({
      data: { customerId, code: generateReferralCode() },
    });
  }

  /** Called when a new customer registers with a referral code (see AuthService/LeadsService.convert integration point — deliberately loose-coupled via this one method rather than a hard dependency). */
  async recordReferral(code: string, referredCustomerId: string) {
    const referralCode = await this.prisma.referralCode.findUnique({
      where: { code },
    });
    if (!referralCode) {
      throw new NotFoundException('Referral code not found');
    }
    if (referralCode.customerId === referredCustomerId) {
      throw new ConflictException('Cannot refer yourself');
    }
    return this.prisma.referral.create({
      data: { referralCodeId: referralCode.id, referredCustomerId },
    });
  }

  listForCustomer(customerId: string) {
    return this.prisma.referral.findMany({
      where: { referralCode: { customerId } },
      include: {
        referredCustomer: { select: { firstName: true, lastName: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  listAll(filters: { status?: ReferralStatus }) {
    return this.prisma.referral.findMany({
      where: filters,
      include: {
        referredCustomer: { select: { firstName: true, lastName: true } },
        referralCode: {
          include: {
            customer: { select: { firstName: true, lastName: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async markQualified(
    id: string,
    serviceType: string,
    transactionId: string,
    transactionAmount: number,
  ) {
    return this.prisma.referral.update({
      where: { id },
      data: {
        status: ReferralStatus.QUALIFIED,
        serviceType,
        transactionId,
        transactionAmount,
      },
    });
  }

  async markRewarded(id: string, rewardAmount: number) {
    const referral = await this.prisma.referral.findUnique({ where: { id } });
    if (!referral) {
      throw new NotFoundException('Referral not found');
    }
    if (referral.status !== ReferralStatus.QUALIFIED) {
      throw new ConflictException('Only a QUALIFIED referral can be rewarded');
    }
    return this.prisma.referral.update({
      where: { id },
      data: {
        status: ReferralStatus.REWARDED,
        rewardAmount,
        rewardPaidAt: new Date(),
      },
    });
  }
}
