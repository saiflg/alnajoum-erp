import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PackageStatus, RegistrationStatus } from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { InvoicesService } from '../payments/invoices.service';
import { HajjPilgrimInputDto } from './dto/register-hajj.dto';

function generateRegistrationNumber(): string {
  return `HAJJ-${randomBytes(4).toString('hex').toUpperCase()}`;
}

interface PilgrimSnapshot {
  customerId: string | null;
  familyMemberId: string | null;
  firstName: string;
  lastName: string;
  passportNumber: string | null;
}

@Injectable()
export class HajjRegistrationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly invoicesService: InvoicesService,
    private readonly notificationsService: NotificationsService,
  ) {}

  private async resolvePilgrimSnapshots(
    customerId: string,
    inputs: HajjPilgrimInputDto[],
  ): Promise<PilgrimSnapshot[]> {
    const snapshots: PilgrimSnapshot[] = [];
    for (const input of inputs) {
      if (input.familyMemberId) {
        const member = await this.prisma.familyMember.findUnique({
          where: { id: input.familyMemberId },
        });
        if (!member) {
          throw new NotFoundException('Family member not found');
        }
        if (member.customerId !== customerId) {
          throw new ForbiddenException(
            'This family member does not belong to this customer',
          );
        }
        snapshots.push({
          customerId: null,
          familyMemberId: member.id,
          firstName: member.firstName,
          lastName: member.lastName,
          passportNumber: member.passportNumber,
        });
      } else {
        const customer = await this.prisma.customer.findUnique({
          where: { id: customerId },
        });
        if (!customer) {
          throw new NotFoundException('Customer not found');
        }
        snapshots.push({
          customerId,
          familyMemberId: null,
          firstName: customer.firstName,
          lastName: customer.lastName,
          passportNumber: customer.passportNumber,
        });
      }
    }
    return snapshots;
  }

  async register(
    customerId: string,
    packageId: string,
    pilgrimInputs: HajjPilgrimInputDto[],
    staffId?: string,
  ) {
    const pkg = await this.prisma.hajjPackage.findUnique({
      where: { id: packageId },
    });
    if (!pkg) {
      throw new NotFoundException('Hajj package not found');
    }
    if (pkg.status !== PackageStatus.PUBLISHED) {
      throw new ConflictException(
        'This package is not open for registration',
      );
    }
    if (pilgrimInputs.length > pkg.seatsAvailable) {
      throw new BadRequestException(
        `Only ${pkg.seatsAvailable} seat(s) remain on this package`,
      );
    }

    const snapshots = await this.resolvePilgrimSnapshots(
      customerId,
      pilgrimInputs,
    );
    const totalAmount = pkg.price * snapshots.length;

    const registration = await this.prisma.$transaction(async (tx) => {
      const created = await tx.hajjRegistration.create({
        data: {
          registrationNumber: generateRegistrationNumber(),
          packageId: pkg.id,
          customerId,
          registeredByStaffId: staffId,
          status: RegistrationStatus.CONFIRMED,
          currency: pkg.currency,
          totalAmount,
          pilgrims: {
            create: snapshots.map((s) => ({
              customerId: s.customerId,
              familyMemberId: s.familyMemberId,
              firstName: s.firstName,
              lastName: s.lastName,
              passportNumber: s.passportNumber,
            })),
          },
        },
        include: { pilgrims: true, package: true },
      });

      const remainingSeats = pkg.seatsAvailable - snapshots.length;
      await tx.hajjPackage.update({
        where: { id: pkg.id },
        data: {
          seatsAvailable: remainingSeats,
          status:
            remainingSeats <= 0 ? PackageStatus.FULLY_BOOKED : pkg.status,
        },
      });

      await this.invoicesService.createForHajjRegistration(
        created,
        created.pilgrims,
        tx,
      );

      return created;
    });

    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      include: { identity: { select: { email: true } } },
    });
    if (customer) {
      await this.notificationsService.sendPilgrimageRegistrationConfirmation(
        customer.identity.email,
        {
          kind: 'Hajj',
          registrationNumber: registration.registrationNumber,
          packageName: registration.package.name,
          totalAmount: registration.totalAmount,
          currency: registration.currency,
          pilgrimCount: snapshots.length,
        },
      );
    }

    return registration;
  }

  listForCustomer(customerId: string) {
    return this.prisma.hajjRegistration.findMany({
      where: { customerId },
      include: { pilgrims: true, package: true, invoice: { include: { payments: true, lineItems: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  listAll(filters: { customerId?: string; packageId?: string }) {
    return this.prisma.hajjRegistration.findMany({
      where: filters,
      include: {
        pilgrims: true,
        package: true,
        invoice: { include: { payments: true, lineItems: true } },
        customer: { select: { firstName: true, lastName: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getRegistration(id: string, ownerCustomerId?: string) {
    const registration = await this.prisma.hajjRegistration.findUnique({
      where: { id },
      include: { pilgrims: true, package: true, invoice: { include: { payments: true, lineItems: true } } },
    });
    if (!registration) {
      throw new NotFoundException('Hajj registration not found');
    }
    if (ownerCustomerId && registration.customerId !== ownerCustomerId) {
      throw new ForbiddenException(
        'This registration does not belong to this customer',
      );
    }
    return registration;
  }
}
