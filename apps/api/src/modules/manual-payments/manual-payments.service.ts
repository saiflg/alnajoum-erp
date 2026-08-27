import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InvoiceStatus, ManualPaymentStatus } from '@prisma/client';
import { randomBytes } from 'crypto';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { IncentivesService } from '../incentives/incentives.service';
import { NotificationsService } from '../notifications/notifications.service';
import { InvoicesService } from '../payments/invoices.service';
import { ReviewManualPaymentDto } from './dto/review-manual-payment.dto';
import { SubmitManualPaymentDto } from './dto/submit-manual-payment.dto';

function generatePaymentReference(): string {
  return `MPAY-${randomBytes(4).toString('hex').toUpperCase()}`;
}

@Injectable()
export class ManualPaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly invoicesService: InvoicesService,
    private readonly notificationsService: NotificationsService,
    private readonly auditService: AuditService,
    private readonly incentivesService: IncentivesService,
  ) {}

  /**
   * Records the claim only — this has ZERO effect on the invoice or any
   * ledger. Nothing here creates a Payment row; only `approve()` does that,
   * which is what "never affects the official financial ledger before
   * approval" means in practice (see schema.prisma's doc comment on the
   * model).
   */
  async submit(
    customerId: string,
    dto: SubmitManualPaymentDto,
    staffId: string | undefined,
    actorIdentityId: string | undefined,
  ) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: dto.invoiceId },
      include: { payments: true },
    });
    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }
    if (invoice.customerId !== customerId) {
      throw new ForbiddenException(
        'This invoice does not belong to this customer',
      );
    }
    if (invoice.status === InvoiceStatus.VOID) {
      throw new ConflictException('Cannot submit a payment for a voided invoice');
    }
    if (invoice.status === InvoiceStatus.PAID) {
      throw new ConflictException('This invoice is already fully paid');
    }
    const totalPaid = invoice.payments.reduce((sum, p) => sum + p.amount, 0);
    const outstanding = invoice.totalAmount - totalPaid;
    if (dto.amount > outstanding) {
      throw new BadRequestException(
        `Submitted amount (${dto.amount}) exceeds the outstanding balance (${outstanding})`,
      );
    }

    const submission = await this.prisma.manualPaymentSubmission.create({
      data: {
        invoiceId: dto.invoiceId,
        customerId,
        amount: dto.amount,
        method: dto.method,
        bankName: dto.bankName,
        transactionReference: dto.transactionReference,
        description: dto.description,
        submittedByStaffId: staffId,
        status: ManualPaymentStatus.PENDING_VERIFICATION,
      },
    });

    await this.auditService.record({
      identityId: actorIdentityId,
      action: 'manual_payment.submitted',
      entityType: 'ManualPaymentSubmission',
      entityId: submission.id,
      metadata: { invoiceId: dto.invoiceId, amount: dto.amount, staffId },
    });

    return submission;
  }

  async attachReceipt(id: string, storedFileName: string) {
    return this.prisma.manualPaymentSubmission.update({
      where: { id },
      data: { receiptDocumentPath: storedFileName },
    });
  }

  listPending() {
    return this.prisma.manualPaymentSubmission.findMany({
      where: { status: ManualPaymentStatus.PENDING_VERIFICATION },
      include: {
        invoice: { select: { invoiceNumber: true } },
        customer: { select: { firstName: true, lastName: true } },
        submittedByStaff: { select: { firstName: true, lastName: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  listAll(filters: { customerId?: string; status?: ManualPaymentStatus }) {
    return this.prisma.manualPaymentSubmission.findMany({
      where: filters,
      include: {
        invoice: { select: { invoiceNumber: true } },
        customer: { select: { firstName: true, lastName: true } },
        submittedByStaff: { select: { firstName: true, lastName: true } },
        reviewedByStaff: { select: { firstName: true, lastName: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getOne(id: string) {
    const submission = await this.prisma.manualPaymentSubmission.findUnique({
      where: { id },
      include: { invoice: true, customer: { include: { identity: true } } },
    });
    if (!submission) {
      throw new NotFoundException('Manual payment submission not found');
    }
    return submission;
  }

  /** Approving is the one action that creates the real, ledger-affecting Payment row. */
  async approve(
    id: string,
    staffId: string | undefined,
    note: string | undefined,
    actorIdentityId: string | undefined,
  ) {
    const submission = await this.getOne(id);
    if (submission.status !== ManualPaymentStatus.PENDING_VERIFICATION) {
      throw new ConflictException(
        `This submission has already been ${submission.status.toLowerCase().replace('_', ' ')}`,
      );
    }

    const invoice = await this.prisma.invoice.findUniqueOrThrow({
      where: { id: submission.invoiceId },
      include: { payments: true },
    });
    const totalPaid = invoice.payments.reduce((sum, p) => sum + p.amount, 0);
    const outstanding = invoice.totalAmount - totalPaid;
    if (submission.amount > outstanding) {
      throw new BadRequestException(
        `Submitted amount (${submission.amount}) now exceeds the outstanding balance (${outstanding}) — reject and ask for resubmission`,
      );
    }

    const reference = generatePaymentReference();
    await this.prisma.$transaction(async (tx) => {
      const payment = await tx.payment.create({
        data: {
          paymentReference: reference,
          invoiceId: submission.invoiceId,
          amount: submission.amount,
          method: submission.method,
          note: submission.description ?? undefined,
          recordedByStaffId: submission.submittedByStaffId,
        },
      });
      await tx.manualPaymentSubmission.update({
        where: { id },
        data: {
          status: ManualPaymentStatus.APPROVED,
          reviewedByStaffId: staffId,
          reviewNote: note,
          reviewedAt: new Date(),
          paymentId: payment.id,
        },
      });
    });

    const updatedInvoice = await this.invoicesService.recomputeStatus(
      submission.invoiceId,
    );

    await this.notificationsService.sendManualPaymentStatus(
      submission.customer.identity.email,
      submission.customer.identityId,
      {
        invoiceNumber: invoice.invoiceNumber,
        amount: submission.amount,
        currency: invoice.currency,
        status: 'APPROVED',
        reviewNote: note,
      },
    );

    await this.auditService.record({
      identityId: actorIdentityId,
      action: 'manual_payment.approved',
      entityType: 'ManualPaymentSubmission',
      entityId: id,
      metadata: { amount: submission.amount, invoiceId: submission.invoiceId },
    });

    await this.incentivesService.applyForInvoicePayment(
      submission.invoiceId,
      submission.amount,
    );

    return updatedInvoice;
  }

  async reject(
    id: string,
    staffId: string | undefined,
    note: string | undefined,
    actorIdentityId: string | undefined,
  ) {
    const submission = await this.getOne(id);
    if (submission.status !== ManualPaymentStatus.PENDING_VERIFICATION) {
      throw new ConflictException(
        `This submission has already been ${submission.status.toLowerCase().replace('_', ' ')}`,
      );
    }

    const updated = await this.prisma.manualPaymentSubmission.update({
      where: { id },
      data: {
        status: ManualPaymentStatus.REJECTED,
        reviewedByStaffId: staffId,
        reviewNote: note,
        reviewedAt: new Date(),
      },
    });

    await this.notificationsService.sendManualPaymentStatus(
      submission.customer.identity.email,
      submission.customer.identityId,
      {
        invoiceNumber: submission.invoice.invoiceNumber,
        amount: submission.amount,
        currency: submission.invoice.currency,
        status: 'REJECTED',
        reviewNote: note,
      },
    );

    await this.auditService.record({
      identityId: actorIdentityId,
      action: 'manual_payment.rejected',
      entityType: 'ManualPaymentSubmission',
      entityId: id,
      metadata: { reason: note },
    });

    return updated;
  }

  async requestClarification(
    id: string,
    staffId: string | undefined,
    note: string,
    actorIdentityId: string | undefined,
  ) {
    const submission = await this.getOne(id);
    if (submission.status !== ManualPaymentStatus.PENDING_VERIFICATION) {
      throw new ConflictException(
        `This submission has already been ${submission.status.toLowerCase().replace('_', ' ')}`,
      );
    }

    const updated = await this.prisma.manualPaymentSubmission.update({
      where: { id },
      data: {
        status: ManualPaymentStatus.CLARIFICATION_REQUESTED,
        reviewedByStaffId: staffId,
        reviewNote: note,
        reviewedAt: new Date(),
      },
    });

    await this.notificationsService.sendManualPaymentStatus(
      submission.customer.identity.email,
      submission.customer.identityId,
      {
        invoiceNumber: submission.invoice.invoiceNumber,
        amount: submission.amount,
        currency: submission.invoice.currency,
        status: 'CLARIFICATION_REQUESTED',
        reviewNote: note,
      },
    );

    await this.auditService.record({
      identityId: actorIdentityId,
      action: 'manual_payment.clarification_requested',
      entityType: 'ManualPaymentSubmission',
      entityId: id,
      metadata: { note },
    });

    return updated;
  }
}
