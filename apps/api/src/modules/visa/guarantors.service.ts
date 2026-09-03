import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ApprovalStatus,
  VerificationStatus,
  VisaApplicationStatus,
} from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateGuarantorDto } from './dto/create-guarantor.dto';
import { VerifyGuarantorDto } from './dto/verify-guarantor.dto';

@Injectable()
export class GuarantorsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly notificationsService: NotificationsService,
  ) {}

  /**
   * Attaches a new guarantor to an application that requires one, moving it
   * from AWAITING_GUARANTOR to GUARANTOR_VERIFICATION. Only valid while the
   * application is actually awaiting a guarantor — matches the workflow
   * diagram in the spec (guarantor info requested -> record created ->
   * documents uploaded -> verification).
   */
  async attachToApplication(applicationId: string, dto: CreateGuarantorDto) {
    const application = await this.prisma.visaApplication.findUnique({
      where: { id: applicationId },
    });
    if (!application) {
      throw new NotFoundException('Visa application not found');
    }
    if (application.guarantorId) {
      throw new ConflictException(
        'This application already has a guarantor attached',
      );
    }

    const guarantor = await this.prisma.guarantor.create({ data: dto });
    await this.prisma.visaApplication.update({
      where: { id: applicationId },
      data: {
        guarantorId: guarantor.id,
        status: VisaApplicationStatus.GUARANTOR_VERIFICATION,
      },
    });

    await this.auditService.record({
      action: 'guarantor.attached',
      entityType: 'Guarantor',
      entityId: guarantor.id,
      metadata: { applicationId },
    });

    return guarantor;
  }

  async get(id: string) {
    const guarantor = await this.prisma.guarantor.findUnique({
      where: { id },
      include: { documents: true, application: true },
    });
    if (!guarantor) {
      throw new NotFoundException('Guarantor not found');
    }
    return guarantor;
  }

  list(filters: {
    verificationStatus?: VerificationStatus;
    approvalStatus?: ApprovalStatus;
  }) {
    return this.prisma.guarantor.findMany({
      where: filters,
      include: { application: { select: { applicationReference: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Staff verifying/approving or rejecting a guarantor. When the guarantor
   * becomes fully verified + approved, the linked application automatically
   * advances out of GUARANTOR_VERIFICATION into PAYMENT_PENDING — the
   * guarantor step is complete, payment is next per the spec's status list,
   * and staff review of the application itself begins once that's verified
   * too (see VisaService.markPaymentVerified). A rejection sends the
   * application back to AWAITING_GUARANTOR so a replacement can be
   * attached, rather than dead-ending it.
   */
  async verify(id: string, dto: VerifyGuarantorDto, staffId: string) {
    const guarantor = await this.get(id);

    const updated = await this.prisma.guarantor.update({
      where: { id },
      data: {
        verificationStatus: dto.verificationStatus,
        approvalStatus: dto.approvalStatus,
        verificationNote: dto.verificationNote,
        verifiedByStaffId: staffId,
        acceptedResponsibilityAt:
          dto.approvalStatus === ApprovalStatus.APPROVED
            ? new Date()
            : undefined,
      },
    });

    await this.auditService.record({
      action: 'guarantor.verified',
      entityType: 'Guarantor',
      entityId: id,
      metadata: {
        verificationStatus: updated.verificationStatus,
        approvalStatus: updated.approvalStatus,
      },
    });

    if (guarantor.application) {
      if (
        updated.verificationStatus === VerificationStatus.VERIFIED &&
        updated.approvalStatus === ApprovalStatus.APPROVED
      ) {
        // The guarantor step is complete — advance to payment, not
        // straight into review. Staff review begins once payment is
        // verified too (see VisaService.markPaymentVerified).
        await this.prisma.visaApplication.update({
          where: { id: guarantor.application.id },
          data: { status: VisaApplicationStatus.PAYMENT_PENDING },
        });
      } else if (updated.approvalStatus === ApprovalStatus.REJECTED) {
        await this.prisma.visaApplication.update({
          where: { id: guarantor.application.id },
          data: {
            status: VisaApplicationStatus.AWAITING_GUARANTOR,
            guarantorId: null,
          },
        });
      }

      const application = await this.prisma.visaApplication.findUnique({
        where: { id: guarantor.application.id },
        include: {
          customer: {
            include: { identity: { select: { id: true, email: true } } },
          },
        },
      });
      if (application && updated.approvalStatus !== ApprovalStatus.PENDING) {
        await this.notificationsService.sendGuarantorUpdate(
          application.customer.identity.email,
          application.customer.identity.id,
          {
            applicationReference: application.applicationReference,
            approved: updated.approvalStatus === ApprovalStatus.APPROVED,
            note: updated.verificationNote,
          },
        );
      }
    }

    return updated;
  }
}
