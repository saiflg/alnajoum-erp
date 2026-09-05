import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DocumentType, VisaDocumentStatus } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CountryVisaRulesService } from './country-visa-rules.service';

export type ChecklistItemState =
  | 'MISSING' // required, nothing uploaded yet
  | 'UPLOADED' // uploaded, awaiting staff review
  | 'VERIFIED'
  | 'REJECTED'
  | 'EXPIRED'
  | 'EXEMPTED'; // a staff-authorized DocumentChecklistException covers it

export interface ChecklistItem {
  documentType: DocumentType;
  required: boolean;
  state: ChecklistItemState;
  documentId: string | null;
  exceptionReason: string | null;
}

export type PassportValidityLevel = 'GREEN' | 'AMBER' | 'RED' | 'UNKNOWN';

export interface PassportValidity {
  level: PassportValidityLevel;
  passportExpiryDate: string | null;
  minPassportValidityMonths: number | null;
  monthsUntilExpiry: number | null;
}

/**
 * Spec #9/#11 — the document checklist and passport-validity indicator are
 * both computed live from CountryVisaRule + the real VisaDocument/
 * CustomerDocument/FamilyMemberDocument rows, never a stored, driftable
 * copy — same discipline as Customer360Service.segments() in Phase 7.
 */
@Injectable()
export class VisaChecklistService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly countryVisaRulesService: CountryVisaRulesService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Spec #9's "allow authorized administrators to configure exceptions...
   * any exception must require reason/approver/date/audit record" — gated
   * behind VISA.CHECKLIST_EXCEPTION at the controller, and this row itself
   * *is* the audit record (plus the standard AuditLog entry below).
   */
  async addException(
    applicationId: string,
    documentType: DocumentType,
    reason: string,
    approvedByStaffId: string,
  ) {
    await this.getApplication(applicationId);
    const existing = await this.prisma.documentChecklistException.findUnique({
      where: { applicationId_documentType: { applicationId, documentType } },
    });
    if (existing) {
      throw new ConflictException(
        `An exception for ${documentType} already exists on this application`,
      );
    }

    const exception = await this.prisma.documentChecklistException.create({
      data: { applicationId, documentType, reason, approvedByStaffId },
    });
    await this.auditService.record({
      action: 'visa_document_checklist.exception_granted',
      entityType: 'VisaApplication',
      entityId: applicationId,
      metadata: { documentType, reason, approvedByStaffId },
    });
    return exception;
  }

  private async getApplication(applicationId: string) {
    const application = await this.prisma.visaApplication.findUnique({
      where: { id: applicationId },
      include: {
        documents: true,
        checklistExceptions: true,
        customer: true,
        familyMember: true,
      },
    });
    if (!application) throw new NotFoundException('Visa application not found');
    return application;
  }

  async computeChecklist(applicationId: string): Promise<{
    items: ChecklistItem[];
    mandatoryComplete: boolean;
  }> {
    const application = await this.getApplication(applicationId);
    const rule = await this.countryVisaRulesService.getApplicableRule(
      application.destinationCountry,
      application.visaType,
    );

    // No rule configured yet for this country/type — nothing to check
    // against, so nothing blocks submission on the checklist's account.
    // (Spec #9 says "prevent submission when mandatory documents are
    // missing" — with no configured requirements, there are none.)
    const required = rule?.requiredDocumentTypes ?? [];
    const optional = rule?.optionalDocumentTypes ?? [];

    const latestByType = new Map<
      DocumentType,
      (typeof application.documents)[number]
    >();
    for (const doc of application.documents) {
      const existing = latestByType.get(doc.type);
      if (!existing || doc.createdAt > existing.createdAt) {
        latestByType.set(doc.type, doc);
      }
    }
    const exceptionByType = new Map(
      application.checklistExceptions.map((e) => [e.documentType, e.reason]),
    );

    const allTypes = [...new Set([...required, ...optional])];
    const items: ChecklistItem[] = allTypes.map((documentType) => {
      const isRequired = required.includes(documentType);
      const doc = latestByType.get(documentType);
      const exceptionReason = exceptionByType.get(documentType) ?? null;

      let state: ChecklistItemState;
      if (!doc) {
        state = exceptionReason ? 'EXEMPTED' : 'MISSING';
      } else if (doc.expiryDate && doc.expiryDate < new Date()) {
        state = 'EXPIRED';
      } else if (doc.status === VisaDocumentStatus.VERIFIED) {
        state = 'VERIFIED';
      } else if (doc.status === VisaDocumentStatus.REJECTED) {
        state = exceptionReason ? 'EXEMPTED' : 'REJECTED';
      } else {
        state = 'UPLOADED';
      }

      return {
        documentType,
        required: isRequired,
        state,
        documentId: doc?.id ?? null,
        exceptionReason,
      };
    });

    const mandatoryComplete = items
      .filter((i) => i.required)
      .every(
        (i) =>
          i.state === 'VERIFIED' ||
          i.state === 'UPLOADED' ||
          i.state === 'EXEMPTED',
      );

    return { items, mandatoryComplete };
  }

  async computePassportValidity(
    applicationId: string,
  ): Promise<PassportValidity> {
    const application = await this.getApplication(applicationId);
    const rule = await this.countryVisaRulesService.getApplicableRule(
      application.destinationCountry,
      application.visaType,
    );
    const minMonths = rule?.minPassportValidityMonths ?? null;

    const expiryDate =
      (application.familyMemberId
        ? application.familyMember?.passportExpiryDate
        : application.customer.passportExpiryDate) ?? null;

    if (!expiryDate) {
      return {
        level: 'UNKNOWN',
        passportExpiryDate: null,
        minPassportValidityMonths: minMonths,
        monthsUntilExpiry: null,
      };
    }

    const monthsUntilExpiry =
      (expiryDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24 * 30.44);

    // Never a hard-coded universal rule (spec #11) — with nothing
    // configured, we can only say the passport has or hasn't expired yet.
    let level: PassportValidityLevel;
    if (monthsUntilExpiry <= 0) {
      level = 'RED';
    } else if (minMonths == null) {
      level = 'GREEN';
    } else if (monthsUntilExpiry < minMonths) {
      level = 'RED';
    } else if (monthsUntilExpiry < minMonths + 3) {
      // Within 3 months of the configured minimum — "near expiry" per
      // spec #11's AMBER band.
      level = 'AMBER';
    } else {
      level = 'GREEN';
    }

    return {
      level,
      passportExpiryDate: expiryDate.toISOString(),
      minPassportValidityMonths: minMonths,
      monthsUntilExpiry: Math.floor(monthsUntilExpiry),
    };
  }
}
