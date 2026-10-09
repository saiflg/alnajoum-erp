import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import { randomBytes } from 'crypto';
import * as fs from 'fs';
import { documentFilePath } from '../../common/documents/document-storage.util';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

const CUSTOMER_DOCS = 'customer-documents';
const FAMILY_DOCS = 'family-member-documents';
const ERASED = 'Erased';

/**
 * Customer data-subject requests (Phase 22 S-38): a copy of a customer's data, and erasure.
 *
 * ERASURE here means ANONYMISATION, deliberately. A travel agency must keep financial records (invoices,
 * payments, the ledger) for accounting and tax purposes, so those rows stay - but they no longer lead to a
 * person: the name, contact details, passport and identity numbers, emergency contacts, uploaded documents
 * and the login are removed or scrambled. It is refused while money is still owed either way (unpaid
 * invoices, a non-zero wallet) because erasing the person would orphan a live obligation.
 *
 * This implements a technical capability. Whether a particular request must be granted, and what the law
 * requires an agency to keep, is a legal decision for the company - this system does not make it.
 */
@Injectable()
export class PrivacyService {
  private readonly logger = new Logger(PrivacyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async load(customerId: string, tenant?: string) {
    const customer = await this.prisma.customer.findFirst({
      where: {
        id: customerId,
        ...(tenant !== undefined && { companyId: tenant }),
      },
      include: {
        identity: {
          select: { id: true, email: true, phone: true, status: true },
        },
      },
    });
    if (!customer) throw new NotFoundException('Customer not found');
    return customer;
  }

  /** Everything held about the customer, as a document that can be handed to them. Uploaded files are listed, not embedded. */
  async exportData(
    customerId: string,
    actor: { identityId: string },
    tenant?: string,
  ) {
    const customer = await this.load(customerId, tenant);
    const [
      family,
      documents,
      invoices,
      flights,
      hotels,
      visas,
      wallet,
      tickets,
      consent,
    ] = await Promise.all([
      this.prisma.familyMember.findMany({
        where: { customerId },
        include: {
          documents: {
            select: {
              type: true,
              originalFileName: true,
              sizeBytes: true,
              uploadedAt: true,
            },
          },
        },
      }),
      this.prisma.customerDocument.findMany({
        where: { customerId },
        select: {
          type: true,
          originalFileName: true,
          sizeBytes: true,
          uploadedAt: true,
        },
      }),
      this.prisma.invoice.findMany({
        where: { customerId },
        include: {
          payments: {
            select: {
              paymentReference: true,
              amount: true,
              method: true,
              paidAt: true,
            },
          },
        },
      }),
      this.prisma.flightBooking.findMany({
        where: { customerId },
        select: {
          bookingReference: true,
          status: true,
          totalAmount: true,
          currency: true,
          createdAt: true,
        },
      }),
      this.prisma.hotelBooking.findMany({
        where: { customerId },
        select: {
          bookingReference: true,
          status: true,
          totalAmount: true,
          currency: true,
          createdAt: true,
        },
      }),
      this.prisma.visaApplication.findMany({
        where: { customerId },
        select: { applicationReference: true, status: true, createdAt: true },
      }),
      this.prisma.wallet.findUnique({
        where: { customerId },
        include: {
          transactions: {
            select: {
              type: true,
              amount: true,
              currency: true,
              status: true,
              description: true,
              createdAt: true,
            },
            orderBy: { createdAt: 'asc' },
          },
        },
      }),
      this.prisma.supportTicket.count({ where: { customerId } }),
      this.prisma.whatsAppConsent.findUnique({ where: { customerId } }),
    ]);

    const { identity, ...profile } = customer;
    const data = {
      exportedAt: new Date().toISOString(),
      profile: { ...profile, email: identity.email, phone: identity.phone },
      familyMembers: family,
      documents,
      invoices,
      flightBookings: flights,
      hotelBookings: hotels,
      visaApplications: visas,
      wallet,
      supportTicketCount: tickets,
      whatsappConsent: consent,
    };
    const counts = {
      familyMembers: family.length,
      documents: documents.length,
      invoices: invoices.length,
      bookings: flights.length + hotels.length + visas.length,
    };
    await this.prisma.dataSubjectRequest.create({
      data: {
        companyId: customer.companyId,
        customerId,
        type: 'EXPORT',
        status: 'COMPLETED',
        handledByIdentityId: actor.identityId,
        outcome: counts,
      },
    });
    await this.audit.record({
      identityId: actor.identityId,
      companyId: customer.companyId,
      action: 'privacy.data_exported',
      entityType: 'Customer',
      entityId: customerId,
      metadata: counts,
    });
    return data;
  }

  /** What stands in the way of erasing this customer right now. */
  async erasureBlockers(customerId: string): Promise<string[]> {
    const blockers: string[] = [];
    const unpaid = await this.prisma.invoice.count({
      where: { customerId, status: { in: ['ISSUED', 'PARTIALLY_PAID'] } },
    });
    if (unpaid > 0) blockers.push(`${unpaid} invoice(s) are not fully paid`);
    const wallet = await this.prisma.wallet.findUnique({
      where: { customerId },
      select: { id: true },
    });
    if (wallet) {
      const sum = await this.prisma.walletTransaction.aggregate({
        where: { walletId: wallet.id, status: 'COMPLETED' },
        _sum: { amount: true },
      });
      if ((sum._sum.amount ?? 0) !== 0)
        blockers.push(`the wallet holds a balance of ${sum._sum.amount ?? 0}`);
    }
    const pendingManual = await this.prisma.manualPaymentSubmission.count({
      where: {
        customerId,
        status: { in: ['PENDING_VERIFICATION', 'CLARIFICATION_REQUESTED'] },
      },
    });
    if (pendingManual > 0)
      blockers.push(
        `${pendingManual} payment submission(s) are awaiting review`,
      );
    return blockers;
  }

  async erase(
    customerId: string,
    reason: string,
    actor: { identityId: string },
    tenant?: string,
  ) {
    const customer = await this.load(customerId, tenant);
    if (customer.identity.email.endsWith('@erased.invalid')) {
      throw new ConflictException('This customer has already been erased');
    }

    const blockers = await this.erasureBlockers(customerId);
    if (blockers.length > 0) {
      await this.prisma.dataSubjectRequest.create({
        data: {
          companyId: customer.companyId,
          customerId,
          type: 'ERASURE',
          status: 'REFUSED',
          handledByIdentityId: actor.identityId,
          outcome: { reason, blockers },
        },
      });
      await this.audit.record({
        identityId: actor.identityId,
        companyId: customer.companyId,
        action: 'privacy.erasure_refused',
        entityType: 'Customer',
        entityId: customerId,
        metadata: { blockers },
      });
      throw new ConflictException(`Cannot erase yet: ${blockers.join('; ')}.`);
    }

    const [customerDocs, familyMembers] = await Promise.all([
      this.prisma.customerDocument.findMany({
        where: { customerId },
        select: { id: true, storedFileName: true },
      }),
      this.prisma.familyMember.findMany({
        where: { customerId },
        select: {
          id: true,
          documents: { select: { id: true, storedFileName: true } },
        },
      }),
    ]);
    const randomPassword = await argon2.hash(randomBytes(32).toString('hex'));

    await this.prisma.$transaction(async (tx) => {
      await tx.customer.update({
        where: { id: customerId },
        data: {
          firstName: ERASED,
          lastName: 'Customer',
          dateOfBirth: null,
          nationality: null,
          gender: null,
          whatsapp: null,
          whatsappOptIn: false,
          address: null,
          city: null,
          state: null,
          country: null,
          passportNumber: null,
          passportExpiryDate: null,
          emergencyContactName: null,
          emergencyContactPhone: null,
        },
      });
      await tx.familyMember.updateMany({
        where: { customerId },
        data: {
          firstName: ERASED,
          lastName: 'Member',
          dateOfBirth: null,
          nationality: null,
          gender: null,
          phone: null,
          email: null,
          passportNumber: null,
          passportExpiryDate: null,
          emergencyContactName: null,
          emergencyContactPhone: null,
        },
      });
      await tx.customerDocument.deleteMany({ where: { customerId } });
      await tx.familyMemberDocument.deleteMany({
        where: { familyMember: { customerId } },
      });
      await tx.identity.update({
        where: { id: customer.identityId },
        data: {
          email: `erased+${customerId}@erased.invalid`,
          phone: null,
          passwordHash: randomPassword,
          status: 'DEACTIVATED',
          twoFactorEnabled: false,
          twoFactorSecret: null,
        },
      });
      // Phase 23: what the AI layer holds about this person goes too — conversations, memory, and the free text in
      // execution traces and feedback. (The audit log keeps the fact that an AI action happened, not the content.)
      await tx.aiMemory.deleteMany({
        where: {
          companyId: customer.companyId,
          subjectType: 'CUSTOMER',
          subjectId: customerId,
        },
      });
      await tx.aiConversationMessage.deleteMany({
        where: { conversation: { customerId } },
      });
      await tx.aiConversation.deleteMany({ where: { customerId } });
      await tx.aiFeedback.updateMany({
        where: { execution: { customerId } },
        data: { note: null },
      });
      await tx.aiExecutionStep.updateMany({
        where: { execution: { customerId } },
        data: { input: Prisma.JsonNull, output: Prisma.JsonNull },
      });
      await tx.aiExecution.updateMany({
        where: { customerId },
        data: { objective: '[erased]', result: Prisma.JsonNull },
      });
      await tx.refreshToken.updateMany({
        where: { identityId: customer.identityId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await tx.passwordResetToken.deleteMany({
        where: { identityId: customer.identityId },
      });
    });

    // Files after the database commit: a failure to delete a file leaves an orphan on disk, never a record pointing at nothing.
    let filesRemoved = 0;
    const unlink = (ns: string, name: string) => {
      try {
        fs.unlinkSync(documentFilePath(ns, name));
        filesRemoved += 1;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
          this.logger.warn(`Could not delete ${ns}/${name}: ${String(error)}`);
      }
    };
    customerDocs.forEach((d) => unlink(CUSTOMER_DOCS, d.storedFileName));
    familyMembers.forEach((m) =>
      m.documents.forEach((d) => unlink(FAMILY_DOCS, d.storedFileName)),
    );

    const outcome = {
      reason,
      familyMembersAnonymised: familyMembers.length,
      filesRemoved,
      financialRecordsKept: true,
    };
    await this.prisma.dataSubjectRequest.create({
      data: {
        companyId: customer.companyId,
        customerId,
        type: 'ERASURE',
        status: 'COMPLETED',
        handledByIdentityId: actor.identityId,
        outcome,
      },
    });
    await this.audit.record({
      identityId: actor.identityId,
      companyId: customer.companyId,
      action: 'privacy.customer_erased',
      entityType: 'Customer',
      entityId: customerId,
      metadata: outcome,
    });
    return { customerId, ...outcome };
  }

  listRequests(tenant?: string) {
    return this.prisma.dataSubjectRequest.findMany({
      where: tenant === undefined ? {} : { companyId: tenant },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }
}
