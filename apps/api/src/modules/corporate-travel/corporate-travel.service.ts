import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CorporateBookingStatus } from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { InvoicesService } from '../payments/invoices.service';
import { CreateCorporateAccountDto } from './dto/create-corporate-account.dto';
import { CreateCorporateBookingDto } from './dto/create-corporate-booking.dto';
import { CreateCorporateTravelerDto } from './dto/create-corporate-traveler.dto';
import { UpdateCorporateAccountDto } from './dto/update-corporate-account.dto';

function generateBookingReference(): string {
  return `CORP-${randomBytes(4).toString('hex').toUpperCase()}`;
}

@Injectable()
export class CorporateTravelService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly invoicesService: InvoicesService,
  ) {}

  // ---------------------------------------------------------------------
  // Corporate accounts (the client company)
  // ---------------------------------------------------------------------

  createAccount(dto: CreateCorporateAccountDto) {
    return this.prisma.corporateAccount.create({ data: dto });
  }

  listAccounts(filters: { managedBranchId?: string; isActive?: boolean }) {
    return this.prisma.corporateAccount.findMany({
      where: filters,
      include: { managedBranch: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getAccount(id: string) {
    const account = await this.prisma.corporateAccount.findUnique({
      where: { id },
      include: {
        managedBranch: { select: { name: true } },
        travelers: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!account) {
      throw new NotFoundException('Corporate account not found');
    }
    return account;
  }

  async updateAccount(id: string, dto: UpdateCorporateAccountDto) {
    await this.getAccount(id);
    return this.prisma.corporateAccount.update({ where: { id }, data: dto });
  }

  // ---------------------------------------------------------------------
  // Travelers (roster of the client company's employees)
  // ---------------------------------------------------------------------

  async addTraveler(
    corporateAccountId: string,
    dto: CreateCorporateTravelerDto,
  ) {
    await this.getAccount(corporateAccountId);
    return this.prisma.corporateTraveler.create({
      data: { ...dto, corporateAccountId },
    });
  }

  async listTravelers(corporateAccountId: string) {
    await this.getAccount(corporateAccountId);
    return this.prisma.corporateTraveler.findMany({
      where: { corporateAccountId },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ---------------------------------------------------------------------
  // Bookings — one consolidated invoice per booking, one line item per
  // traveler (see InvoicesService.createForCorporateBooking).
  // ---------------------------------------------------------------------

  async createBooking(
    corporateAccountId: string,
    dto: CreateCorporateBookingDto,
    staffId: string,
  ) {
    const account = await this.getAccount(corporateAccountId);

    const travelers = await this.prisma.corporateTraveler.findMany({
      where: {
        id: { in: dto.travelers.map((t) => t.travelerId) },
        corporateAccountId,
      },
    });
    if (travelers.length !== dto.travelers.length) {
      throw new NotFoundException(
        'One or more travelers were not found on this corporate account',
      );
    }

    const totalAmount = dto.travelers.reduce((sum, t) => sum + t.amount, 0);

    const booking = await this.prisma.$transaction(async (tx) => {
      const created = await tx.corporateBooking.create({
        data: {
          bookingReference: generateBookingReference(),
          corporateAccountId,
          bookedByStaffId: staffId,
          description: dto.description,
          status: CorporateBookingStatus.CONFIRMED,
          currency: 'NGN',
          totalAmount,
          travelers: {
            create: dto.travelers.map((t) => ({
              travelerId: t.travelerId,
              description: t.description,
              amount: t.amount,
            })),
          },
        },
        include: {
          travelers: { include: { traveler: true } },
        },
      });

      await this.invoicesService.createForCorporateBooking(
        { ...created, corporateAccount: { name: account.name } },
        created.travelers,
        tx,
      );

      return created;
    });

    return booking;
  }

  listBookings(filters: {
    corporateAccountId?: string;
    status?: CorporateBookingStatus;
  }) {
    return this.prisma.corporateBooking.findMany({
      where: filters,
      include: {
        corporateAccount: { select: { name: true } },
        travelers: { include: { traveler: true } },
        invoice: { include: { payments: true, lineItems: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getBooking(id: string) {
    const booking = await this.prisma.corporateBooking.findUnique({
      where: { id },
      include: {
        corporateAccount: { select: { name: true } },
        travelers: { include: { traveler: true } },
        invoice: { include: { payments: true, lineItems: true } },
      },
    });
    if (!booking) {
      throw new NotFoundException('Corporate booking not found');
    }
    return booking;
  }

  async cancelBooking(id: string) {
    const booking = await this.getBooking(id);
    if (booking.status === CorporateBookingStatus.CANCELLED) {
      throw new ConflictException('This booking has already been cancelled');
    }

    const cancelled = await this.prisma.corporateBooking.update({
      where: { id },
      data: { status: CorporateBookingStatus.CANCELLED },
    });

    await this.invoicesService.voidCorporateBookingIfUnpaid(id);

    return cancelled;
  }
}
