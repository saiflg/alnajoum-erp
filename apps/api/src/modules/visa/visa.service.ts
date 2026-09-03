import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { VisaApplicationStatus, VisaType } from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { InvoicesService } from '../payments/invoices.service';
import { SubmitVisaApplicationDto } from './dto/submit-visa-application.dto';

function generateApplicationReference(): string {
  return `VISA-${randomBytes(4).toString('hex').toUpperCase()}`;
}

/**
 * Flat processing-fee schedule per visa type, whole NGN — deliberately
 * simple (no per-country pricing) for phase 1, same spirit as the mock
 * flight/hotel/vehicle providers using a fixed catalogue rather than a real
 * pricing engine. Easy to make staff-editable later without touching the
 * booking flow, same way HajjPackage.price already is.
 */
export const VISA_PROCESSING_FEES: Record<VisaType, number> = {
  TOURIST: 25000,
  BUSINESS: 35000,
  STUDENT: 30000,
  WORK: 50000,
  TRANSIT: 15000,
  PILGRIMAGE: 20000,
  OTHER: 25000,
};

const TERMINAL_STATUSES: VisaApplicationStatus[] = [
  VisaApplicationStatus.REJECTED,
  VisaApplicationStatus.ISSUED,
  VisaApplicationStatus.CANCELLED,
];

@Injectable()
export class VisaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly invoicesService: InvoicesService,
    private readonly notificationsService: NotificationsService,
  ) {}

  private async resolveApplicant(customerId: string, familyMemberId?: string) {
    if (familyMemberId) {
      const member = await this.prisma.familyMember.findUnique({
        where: { id: familyMemberId },
      });
      if (!member) {
        throw new NotFoundException('Family member not found');
      }
      if (member.customerId !== customerId) {
        throw new ForbiddenException(
          'This family member does not belong to this customer',
        );
      }
      return {
        familyMemberId: member.id,
        firstName: member.firstName,
        lastName: member.lastName,
        passportNumber: member.passportNumber,
      };
    }

    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
    });
    if (!customer) {
      throw new NotFoundException('Customer not found');
    }
    return {
      familyMemberId: null,
      firstName: customer.firstName,
      lastName: customer.lastName,
      passportNumber: customer.passportNumber,
    };
  }

  async submit(
    customerId: string,
    dto: SubmitVisaApplicationDto,
    staffId?: string,
  ) {
    const applicant = await this.resolveApplicant(
      customerId,
      dto.familyMemberId,
    );
    const totalAmount = VISA_PROCESSING_FEES[dto.visaType];

    const application = await this.prisma.$transaction(async (tx) => {
      const created = await tx.visaApplication.create({
        data: {
          applicationReference: generateApplicationReference(),
          customerId,
          familyMemberId: applicant.familyMemberId,
          appliedByStaffId: staffId,
          destinationCountry: dto.destinationCountry,
          visaType: dto.visaType,
          intendedTravelDate: dto.intendedTravelDate
            ? new Date(dto.intendedTravelDate)
            : null,
          applicantFirstName: applicant.firstName,
          applicantLastName: applicant.lastName,
          applicantPassportNumber: applicant.passportNumber,
          status: VisaApplicationStatus.SUBMITTED,
          currency: 'NGN',
          totalAmount,
          notes: dto.notes,
        },
      });

      await this.invoicesService.createForVisaApplication(created, tx);

      return created;
    });

    await this.notifyStatus(application.id);

    return application;
  }

  listForCustomer(customerId: string) {
    return this.prisma.visaApplication.findMany({
      where: { customerId },
      include: { invoice: { include: { payments: true, lineItems: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  listAll(filters: { customerId?: string; status?: VisaApplicationStatus }) {
    return this.prisma.visaApplication.findMany({
      where: filters,
      include: {
        invoice: { include: { payments: true, lineItems: true } },
        customer: { select: { firstName: true, lastName: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getApplication(id: string, ownerCustomerId?: string) {
    const application = await this.prisma.visaApplication.findUnique({
      where: { id },
      include: { invoice: { include: { payments: true, lineItems: true } } },
    });
    if (!application) {
      throw new NotFoundException('Visa application not found');
    }
    if (ownerCustomerId && application.customerId !== ownerCustomerId) {
      throw new ForbiddenException(
        'This application does not belong to this customer',
      );
    }
    return application;
  }

  /** Staff-only: move the application to a new status, with an optional note. */
  async updateStatus(
    id: string,
    status: VisaApplicationStatus,
    staffNote?: string,
  ) {
    const application = await this.getApplication(id);
    if (TERMINAL_STATUSES.includes(application.status)) {
      throw new ConflictException(
        `This application is already ${application.status.toLowerCase()} and cannot be updated further`,
      );
    }

    await this.prisma.visaApplication.update({
      where: { id },
      data: { status, staffNote },
    });

    if (status === VisaApplicationStatus.CANCELLED) {
      await this.invoicesService.voidVisaApplicationIfUnpaid(id);
    }

    await this.notifyStatus(id);

    return this.getApplication(id);
  }

  /** Customer (or staff) cancelling an application that hasn't reached a terminal state yet. */
  async cancel(id: string, ownerCustomerId?: string) {
    const application = await this.getApplication(id, ownerCustomerId);
    if (TERMINAL_STATUSES.includes(application.status)) {
      throw new ConflictException(
        `This application is already ${application.status.toLowerCase()} and cannot be cancelled`,
      );
    }

    await this.prisma.visaApplication.update({
      where: { id },
      data: { status: VisaApplicationStatus.CANCELLED },
    });

    await this.invoicesService.voidVisaApplicationIfUnpaid(id);
    await this.notifyStatus(id);

    return this.getApplication(id);
  }

  private async notifyStatus(id: string) {
    const application = await this.prisma.visaApplication.findUnique({
      where: { id },
      include: {
        customer: {
          include: { identity: { select: { id: true, email: true } } },
        },
      },
    });
    if (!application) {
      return;
    }
    await this.notificationsService.sendVisaApplicationStatusUpdate(
      application.customer.identity.email,
      application.customer.identity.id,
      {
        applicationReference: application.applicationReference,
        destinationCountry: application.destinationCountry,
        status: application.status,
        staffNote: application.staffNote,
      },
    );
  }
}
