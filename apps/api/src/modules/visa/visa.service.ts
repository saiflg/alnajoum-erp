import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  InvoiceStatus,
  Prisma,
  VisaApplicationStatus,
  VisaServiceStatus,
  VisaType,
} from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { InvoicesService } from '../payments/invoices.service';
import { SubmitVisaApplicationDto } from './dto/submit-visa-application.dto';
import { VisaIncentivesService } from './visa-incentives.service';

/**
 * Flat processing-fee schedule per visa type, whole NGN — used only for
 * Phase 2's simple flow (no visaServiceId). Phase 3 applications linked to
 * a VisaService catalog entry are priced from that entry instead — see
 * VisaService.submit().
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

/**
 * Statuses that no further staff action (or provider sync — see
 * VisaSubmissionsService) can move out of. Exported so every module that
 * needs to check "is this application done" — VisaSubmissionsService's
 * status-sync guard, the future expiry sweep — shares this single list
 * rather than each keeping its own drift-prone copy.
 */
export const TERMINAL_STATUSES: VisaApplicationStatus[] = [
  VisaApplicationStatus.REJECTED,
  VisaApplicationStatus.ISSUED,
  VisaApplicationStatus.CANCELLED,
  VisaApplicationStatus.COMPLETED,
  VisaApplicationStatus.EXPIRED,
];

interface OfflineEntryOptions {
  isOfflineEntry?: boolean;
  offlineReason?: string;
  guarantorExempt?: boolean;
  guarantorExemptReason?: string;
}

@Injectable()
export class VisaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly invoicesService: InvoicesService,
    private readonly notificationsService: NotificationsService,
    private readonly auditService: AuditService,
    private readonly visaIncentivesService: VisaIncentivesService,
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

  /**
   * "VISA-2026-000001" — sequential per calendar year. Computed inside the
   * same transaction as the insert to minimize (not eliminate) the race
   * window between two concurrent submissions in the same year; this
   * codebase has no advisory-lock/sequence mechanism elsewhere either, so a
   * plain count-based approach matches its existing level of rigor. A
   * genuine collision would surface as a unique-constraint error on
   * applicationReference and the submission would simply fail and need
   * retrying — documented as a known limitation rather than silently risked.
   */
  private async generateApplicationReference(
    tx: Prisma.TransactionClient,
  ): Promise<string> {
    const year = new Date().getFullYear();
    const prefix = `VISA-${year}-`;
    const count = await tx.visaApplication.count({
      where: { applicationReference: { startsWith: prefix } },
    });
    return `${prefix}${String(count + 1).padStart(6, '0')}`;
  }

  /**
   * "the applicant is NOT an authorized staff member or does not qualify
   * for an exemption" — this platform's Customer and Staff are distinct
   * identity types with no natural overlap, so "authorized staff member"
   * is implemented as VisaService.requiresGuarantor (the admin-configured
   * business rule) combined with a staff-authorized, per-application,
   * always-audited exemption (guarantorExempt/guarantorExemptReason) —
   * never settable by the customer themselves. See SubmitVisaApplicationForDto.
   */
  private isGuarantorRequired(
    service: { requiresGuarantor: boolean },
    exempt: boolean,
  ): boolean {
    return service.requiresGuarantor && !exempt;
  }

  async submit(
    customerId: string,
    dto: SubmitVisaApplicationDto,
    staffId?: string,
    offlineOptions?: OfflineEntryOptions,
  ) {
    if (offlineOptions?.isOfflineEntry && !offlineOptions.offlineReason) {
      throw new BadRequestException(
        'A reason is required when recording an offline/manual transaction',
      );
    }
    if (
      offlineOptions?.guarantorExempt &&
      !offlineOptions.guarantorExemptReason
    ) {
      throw new BadRequestException(
        'A reason is required when exempting an application from the guarantor requirement',
      );
    }

    const applicant = await this.resolveApplicant(
      customerId,
      dto.familyMemberId,
    );

    let visaService: {
      id: string;
      currency: string;
      companyCost: number;
      sellingPrice: number;
      processingFee: number;
      otherFees: number;
      requiresGuarantor: boolean;
    } | null = null;
    if (dto.visaServiceId) {
      const service = await this.prisma.visaService.findUnique({
        where: { id: dto.visaServiceId },
      });
      if (!service) {
        throw new NotFoundException('Visa service not found');
      }
      if (service.status !== VisaServiceStatus.ACTIVE || !service.isAvailable) {
        throw new ConflictException(
          'This visa service is not currently available',
        );
      }
      visaService = service;
    }

    const currency = visaService?.currency ?? 'NGN';
    const totalAmount = visaService
      ? visaService.sellingPrice +
        visaService.processingFee +
        visaService.otherFees
      : VISA_PROCESSING_FEES[dto.visaType];

    const guarantorRequired = visaService
      ? this.isGuarantorRequired(
          visaService,
          offlineOptions?.guarantorExempt ?? false,
        )
      : false;

    const application = await this.prisma.$transaction(async (tx) => {
      const created = await tx.visaApplication.create({
        data: {
          applicationReference: await this.generateApplicationReference(tx),
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
          currency,
          totalAmount,
          notes: dto.notes,
          visaServiceId: visaService?.id,
          companyCostSnapshot: visaService?.companyCost,
          sellingPriceSnapshot: visaService?.sellingPrice,
          guarantorRequired,
          guarantorExempt: offlineOptions?.guarantorExempt ?? false,
          guarantorExemptReason: offlineOptions?.guarantorExemptReason,
          previousVisaInfo: dto.previousVisaInfo,
          contactPhone: dto.contactPhone,
          contactEmail: dto.contactEmail,
          isOfflineEntry: offlineOptions?.isOfflineEntry ?? false,
          offlineReason: offlineOptions?.offlineReason,
        },
      });

      await this.invoicesService.createForVisaApplication(created, tx);

      // Advance out of SUBMITTED immediately for catalog-linked
      // applications — Phase 2's simple flow (no visaServiceId) stays at
      // SUBMITTED exactly as before.
      if (visaService) {
        const nextStatus = guarantorRequired
          ? VisaApplicationStatus.AWAITING_GUARANTOR
          : VisaApplicationStatus.PAYMENT_PENDING;
        await tx.visaApplication.update({
          where: { id: created.id },
          data: { status: nextStatus },
        });
        created.status = nextStatus;
      }

      return created;
    });

    if (offlineOptions?.isOfflineEntry) {
      // Note: identityId is intentionally omitted — AuditLog.identityId is a
      // foreign key to Identity, and staffId here is a Staff id (a
      // different table/id space); passing it as identityId would violate
      // the FK. The acting staff member is still recorded in metadata.
      await this.auditService.record({
        action: 'visa_application.offline_entry',
        entityType: 'VisaApplication',
        entityId: application.id,
        metadata: { staffId, reason: offlineOptions.offlineReason },
      });
    }
    if (offlineOptions?.guarantorExempt) {
      await this.auditService.record({
        action: 'visa_application.guarantor_exempted',
        entityType: 'VisaApplication',
        entityId: application.id,
        metadata: { staffId, reason: offlineOptions.guarantorExemptReason },
      });
    }

    await this.notifyStatus(application.id);
    if (application.status === VisaApplicationStatus.AWAITING_GUARANTOR) {
      const customer = await this.prisma.customer.findUnique({
        where: { id: customerId },
        include: { identity: { select: { id: true, email: true } } },
      });
      if (customer) {
        await this.notificationsService.sendGuarantorRequired(
          customer.identity.email,
          customer.identity.id,
          application.applicationReference,
        );
      }
    }

    return application;
  }

  listForCustomer(customerId: string) {
    return this.prisma.visaApplication.findMany({
      where: { customerId },
      include: {
        invoice: { include: { payments: true, lineItems: true } },
        visaService: true,
        guarantor: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  listAll(filters: {
    customerId?: string;
    status?: VisaApplicationStatus;
    assignedStaffId?: string;
  }) {
    return this.prisma.visaApplication.findMany({
      where: filters,
      include: {
        invoice: { include: { payments: true, lineItems: true } },
        customer: { select: { firstName: true, lastName: true } },
        visaService: true,
        guarantor: true,
        assignedStaff: { select: { firstName: true, lastName: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Internal notes (VisaApplicationNote) are deliberately never included
   * here even though this method is also used by the staff-facing admin
   * controller — staff read them via the dedicated GET .../notes endpoint
   * instead, so there's exactly one code path that can return them and
   * VisaApplicationsOwnController never has to remember to strip them.
   */
  async getApplication(id: string, ownerCustomerId?: string) {
    const application = await this.prisma.visaApplication.findUnique({
      where: { id },
      include: {
        invoice: { include: { payments: true, lineItems: true } },
        visaService: true,
        guarantor: true,
        assignedStaff: { select: { firstName: true, lastName: true } },
      },
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
    if (status === VisaApplicationStatus.COMPLETED) {
      const updated = await this.prisma.visaApplication.findUniqueOrThrow({
        where: { id },
      });
      await this.visaIncentivesService.createForCompletedApplication(updated);
    }

    await this.notifyStatus(id);

    return this.getApplication(id);
  }

  /**
   * Staff-only: confirm the invoice is fully paid and move
   * PAYMENT_PENDING -> PAYMENT_VERIFIED. Deliberately a manual click even
   * when the invoice already shows PAID (e.g. an online payment) — the
   * spec calls out payment verification as its own gated permission
   * (visa.payment.verify), distinct from however the payment itself was
   * confirmed. A subsequent updateStatus() to UNDER_REVIEW (gated by
   * visa.review) begins the actual application review.
   */
  async markPaymentVerified(id: string, staffId: string) {
    const application = await this.getApplication(id);
    if (application.status !== VisaApplicationStatus.PAYMENT_PENDING) {
      throw new ConflictException(
        `This application is ${application.status.toLowerCase()}, not awaiting payment verification`,
      );
    }
    if (
      !application.invoice ||
      application.invoice.status !== InvoiceStatus.PAID
    ) {
      throw new ConflictException(
        "This application's invoice is not fully paid yet",
      );
    }

    await this.prisma.visaApplication.update({
      where: { id },
      data: { status: VisaApplicationStatus.PAYMENT_VERIFIED },
    });
    await this.auditService.record({
      action: 'visa_application.payment_verified',
      entityType: 'VisaApplication',
      entityId: id,
      metadata: { staffId },
    });
    await this.notifyStatus(id);
    return this.getApplication(id);
  }

  /** Staff-only: assign the application to a visa officer. */
  async assign(id: string, assignedStaffId: string, actorIdentityId?: string) {
    await this.getApplication(id);
    const updated = await this.prisma.visaApplication.update({
      where: { id },
      data: { assignedStaffId },
    });
    await this.auditService.record({
      identityId: actorIdentityId,
      action: 'visa_application.assigned',
      entityType: 'VisaApplication',
      entityId: id,
      metadata: { assignedStaffId },
    });
    return updated;
  }

  /** Staff-only: append an internal note (never visible to the customer). */
  async addNote(id: string, staffId: string, note: string) {
    await this.getApplication(id);
    const created = await this.prisma.visaApplicationNote.create({
      data: { applicationId: id, staffId, note },
    });
    await this.auditService.record({
      action: 'visa_application.note_added',
      entityType: 'VisaApplication',
      entityId: id,
      metadata: { staffId },
    });
    return created;
  }

  listNotes(id: string) {
    return this.prisma.visaApplicationNote.findMany({
      where: { applicationId: id },
      include: { staff: { select: { firstName: true, lastName: true } } },
      orderBy: { createdAt: 'desc' },
    });
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
