import { Injectable } from '@nestjs/common';
import {
  DocumentType,
  PilgrimType,
  ReadinessStatus,
  VisaApplicationStatus,
} from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PilgrimLookupService } from './pilgrim-lookup.service';

// Spec #3's "centralized pilgrim document checklist" — same idea as
// CrmAutomationService.REQUIRED_VISA_DOCUMENT_TYPES, just the pilgrimage-
// specific set (matches HajjPackage.requiredDocuments' own example text:
// "Passport, Yellow Card, 2 photos").
const REQUIRED_PILGRIM_DOCUMENT_TYPES: DocumentType[] = [
  DocumentType.PASSPORT,
  DocumentType.PHOTO,
  DocumentType.VACCINATION_CERTIFICATE,
];

const APPROVED_VISA_STATUSES: VisaApplicationStatus[] = [
  VisaApplicationStatus.APPROVED,
  VisaApplicationStatus.ISSUED,
];

export interface PilgrimReadiness {
  pilgrimType: PilgrimType;
  pilgrimId: string;
  documentsComplete: boolean;
  missingDocuments: DocumentType[];
  visaStatus: 'NOT_APPLIED' | 'IN_PROGRESS' | 'APPROVED';
  paymentComplete: boolean;
  outstandingAmount: number;
  flightAssigned: boolean;
  hotelAssigned: boolean;
  computedStatus: ReadinessStatus;
  override: {
    status: ReadinessStatus;
    reason: string;
    overriddenAt: Date;
  } | null;
  finalStatus: ReadinessStatus;
}

/**
 * Spec #3 (document checklist), #28-#30 (readiness score / departure
 * checklist / GREEN-AMBER-RED). Deliberately computed live from real data —
 * documents, VisaApplication, Invoice/Payment, FlightBookingPassenger,
 * HotelBookingGuest — rather than a synced/duplicated status field, so it
 * structurally cannot drift out of date (same discipline as
 * Customer360Service.segments() in Phase 7).
 */
@Injectable()
export class ReadinessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly pilgrimLookup: PilgrimLookupService,
  ) {}

  async compute(type: PilgrimType, id: string): Promise<PilgrimReadiness> {
    const pilgrim = await this.pilgrimLookup.getPilgrim(type, id);
    const customerId: string | null = pilgrim.customerId;
    const familyMemberId: string | null = pilgrim.familyMemberId;

    const uploadedTypes = new Set<DocumentType>(
      customerId
        ? (
            await this.prisma.customerDocument.findMany({
              where: { customerId },
              select: { type: true },
            })
          ).map((d) => d.type)
        : (
            await this.prisma.familyMemberDocument.findMany({
              where: { familyMemberId: familyMemberId! },
              select: { type: true },
            })
          ).map((d) => d.type),
    );
    const missingDocuments = REQUIRED_PILGRIM_DOCUMENT_TYPES.filter(
      (t) => !uploadedTypes.has(t),
    );
    const documentsComplete = missingDocuments.length === 0;

    const visaApp = await this.prisma.visaApplication.findFirst({
      where: customerId
        ? { customerId, familyMemberId: null }
        : { familyMemberId },
      orderBy: { createdAt: 'desc' },
      select: { status: true },
    });
    const visaStatus: PilgrimReadiness['visaStatus'] = !visaApp
      ? 'NOT_APPLIED'
      : APPROVED_VISA_STATUSES.includes(visaApp.status)
        ? 'APPROVED'
        : 'IN_PROGRESS';

    const invoice = pilgrim.registration?.invoice;
    const totalPaid = invoice
      ? invoice.payments.reduce(
          (sum: number, p: { amount: number }) => sum + p.amount,
          0,
        )
      : 0;
    const outstandingAmount = invoice ? invoice.totalAmount - totalPaid : 0;
    const paymentComplete = outstandingAmount <= 0;

    const flightAssigned =
      (await this.prisma.flightBookingPassenger.count({
        where: customerId
          ? { customerId }
          : { familyMemberId: familyMemberId! },
      })) > 0;
    const hotelAssigned =
      (await this.prisma.hotelBookingGuest.count({
        where: customerId
          ? { customerId }
          : { familyMemberId: familyMemberId! },
      })) > 0;

    let computedStatus: ReadinessStatus;
    if (!documentsComplete || !paymentComplete) {
      computedStatus = ReadinessStatus.RED;
    } else if (visaStatus !== 'APPROVED' || !flightAssigned || !hotelAssigned) {
      computedStatus = ReadinessStatus.AMBER;
    } else {
      computedStatus = ReadinessStatus.GREEN;
    }

    const overrideRow = await this.prisma.pilgrimReadinessOverride.findFirst({
      where: { pilgrimType: type, pilgrimId: id },
      orderBy: { overriddenAt: 'desc' },
    });
    const override = overrideRow
      ? {
          status: overrideRow.status,
          reason: overrideRow.reason,
          overriddenAt: overrideRow.overriddenAt,
        }
      : null;

    return {
      pilgrimType: type,
      pilgrimId: id,
      documentsComplete,
      missingDocuments,
      visaStatus,
      paymentComplete,
      outstandingAmount,
      flightAssigned,
      hotelAssigned,
      computedStatus,
      override,
      // Spec #30: staff cannot silently change the readiness status — an
      // override only ever comes from setOverride() below, which is always
      // audited and gated behind CHECKLIST_OVERRIDE at the controller.
      finalStatus: override ? override.status : computedStatus,
    };
  }

  /** Spec #30's authorized, audited manual override. */
  async setOverride(
    type: PilgrimType,
    id: string,
    status: ReadinessStatus,
    reason: string,
    staffId: string,
  ) {
    await this.pilgrimLookup.getPilgrim(type, id);
    const override = await this.prisma.pilgrimReadinessOverride.create({
      data: {
        pilgrimType: type,
        pilgrimId: id,
        status,
        reason,
        overriddenByStaffId: staffId,
      },
    });
    await this.auditService.record({
      action: 'pilgrim_readiness.overridden',
      entityType:
        type === PilgrimType.HAJJ
          ? 'HajjRegistrationPilgrim'
          : 'UmrahRegistrationPilgrim',
      entityId: id,
      metadata: { status, reason, overriddenByStaffId: staffId },
    });
    return override;
  }

  async computeForGroup(groupType: PilgrimType, groupId: string) {
    const pilgrims =
      groupType === PilgrimType.HAJJ
        ? await this.prisma.hajjRegistrationPilgrim.findMany({
            where: { groupId },
          })
        : await this.prisma.umrahRegistrationPilgrim.findMany({
            where: { groupId },
          });

    return Promise.all(pilgrims.map((p) => this.compute(groupType, p.id)));
  }
}
