import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ApprovalStatus,
  InvoiceStatus,
  ProviderMessageSeverity,
  VerificationStatus,
  VisaApplicationStatus,
  VisaProviderName,
} from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CountryVisaRulesService } from './country-visa-rules.service';
import { VisaChecklistService } from './visa-checklist.service';
import { TERMINAL_STATUSES, VisaService } from './visa.service';
import { VISA_PROVIDER } from './providers/visa-provider.port';
import type { VisaProviderPort } from './providers/visa-provider.port';
import { VisaProviderRouter } from './providers/visa-provider.router';

/**
 * Spec #14/#15/#16/#17 — a real submission record (not just a status
 * click), routed through the active VisaProviderPort implementation, with
 * every status change flowing back through VisaService.updateStatus so the
 * existing terminal-status guard, notification, and (on completion)
 * incentive-creation logic are reused rather than duplicated (spec #12/#20).
 */
@Injectable()
export class VisaSubmissionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly visaService: VisaService,
    private readonly checklistService: VisaChecklistService,
    private readonly visaProviderRouter: VisaProviderRouter,
    private readonly countryVisaRulesService: CountryVisaRulesService,
    private readonly auditService: AuditService,
    @Inject(VISA_PROVIDER) private readonly visaProvider: VisaProviderPort,
  ) {}

  /**
   * Maps a provider's own status vocabulary onto this application's
   * internal VisaApplicationStatus — never a blind overwrite (spec #16):
   * a status this router doesn't recognize (or one that only means "still
   * with the provider", e.g. mock's RECEIVED / manual's MANUAL_PROCESSING)
   * leaves the internal status untouched.
   */
  private mapProviderStatus(
    providerStatus: string,
  ): VisaApplicationStatus | null {
    switch (providerStatus) {
      case 'PROCESSING':
      case 'PROCESSING_2':
        return VisaApplicationStatus.PROCESSING;
      case 'ADDITIONAL_INFO_REQUIRED':
        return VisaApplicationStatus.ADDITIONAL_INFO_REQUIRED;
      case 'APPROVED':
        // Reuse VisaService.updateStatus's own COMPLETED handling, which
        // already triggers VisaIncentivesService.createForCompletedApplication
        // — spec #20 says reuse the incentive engine, never duplicate it.
        return VisaApplicationStatus.COMPLETED;
      default:
        return null;
    }
  }

  /**
   * Spec #6's hard block, enforced again here even though the status
   * machine (guarantor -> payment -> under review) already gates most of
   * this — defense in depth against any future code path that could call
   * submit() out of sequence.
   */
  private async assertReadyToSubmit(applicationId: string) {
    const application = await this.prisma.visaApplication.findUnique({
      where: { id: applicationId },
      include: { invoice: true, guarantor: true },
    });
    if (!application) {
      throw new NotFoundException('Visa application not found');
    }
    if (application.status !== VisaApplicationStatus.UNDER_REVIEW) {
      throw new ConflictException(
        `Only an application under review can be submitted to the provider (currently ${application.status})`,
      );
    }
    if (application.guarantorRequired && !application.guarantorExempt) {
      if (
        !application.guarantor ||
        application.guarantor.verificationStatus !==
          VerificationStatus.VERIFIED ||
        application.guarantor.approvalStatus !== ApprovalStatus.APPROVED
      ) {
        throw new ConflictException(
          'This application requires a fully verified and approved guarantor before it can be submitted',
        );
      }
    }
    if (
      !application.invoice ||
      application.invoice.status !== InvoiceStatus.PAID
    ) {
      throw new ConflictException(
        'Payment has not been verified for this application yet',
      );
    }

    const checklist =
      await this.checklistService.computeChecklist(applicationId);
    if (!checklist.mandatoryComplete) {
      throw new ConflictException(
        'Required documents are missing or unverified — see the document checklist',
      );
    }
    const passportValidity =
      await this.checklistService.computePassportValidity(applicationId);
    if (passportValidity.level === 'RED') {
      throw new ConflictException(
        "The applicant's passport does not meet this destination's minimum validity requirement",
      );
    }

    return application;
  }

  async submit(applicationId: string, staffId: string) {
    const application = await this.assertReadyToSubmit(applicationId);
    const providerName = await this.visaProviderRouter.getActiveProviderName();

    const result = await this.visaProvider.submitApplication({
      applicationReference: application.applicationReference,
      destinationCountry: application.destinationCountry,
      visaType: application.visaType,
      applicantFirstName: application.applicantFirstName,
      applicantLastName: application.applicantLastName,
      applicantPassportNumber: application.applicantPassportNumber,
    });

    const submission = await this.prisma.visaSubmission.create({
      data: {
        applicationId,
        submittedByStaffId: staffId,
        provider:
          providerName === 'mock'
            ? VisaProviderName.MOCK
            : VisaProviderName.MANUAL,
        externalReference: result.externalReference,
        providerStatus: result.providerStatus,
        providerMessage: result.message,
      },
    });

    if (result.message) {
      await this.prisma.visaProviderMessage.create({
        data: {
          applicationId,
          message: result.message,
          severity: ProviderMessageSeverity.INFO,
        },
      });
    }

    // Spec #30 — the SLA target is set once, at submission time, from
    // whatever CountryVisaRule currently applies; a later edit to that rule
    // must never retroactively change an already-submitted application's
    // due date (same snapshot-at-creation-time discipline as
    // companyCostSnapshot/sellingPriceSnapshot above).
    const rule = await this.countryVisaRulesService.getApplicableRule(
      application.destinationCountry,
      application.visaType,
    );
    if (rule?.processingTimeDays) {
      await this.prisma.visaApplication.update({
        where: { id: applicationId },
        data: {
          slaTargetDays: rule.processingTimeDays,
          slaDueAt: new Date(
            Date.now() + rule.processingTimeDays * 24 * 60 * 60 * 1000,
          ),
        },
      });
    }

    await this.visaService.updateStatus(
      applicationId,
      VisaApplicationStatus.SUBMITTED_TO_PROVIDER,
    );

    await this.auditService.record({
      action: 'visa_submission.created',
      entityType: 'VisaSubmission',
      entityId: submission.id,
      metadata: { applicationId, staffId, provider: providerName },
    });

    return submission;
  }

  /**
   * Pulls the latest status from the provider for this application's most
   * recent submission and, if it maps to a further-along internal status,
   * advances the application through VisaService.updateStatus. A no-op
   * (BadRequestException surfaced to the caller) for a manual submission —
   * it has no externalReference to poll (spec #17: "do not assume every
   * provider exposes every restriction through an API").
   */
  async syncStatus(applicationId: string, staffId: string) {
    const submission = await this.prisma.visaSubmission.findFirst({
      where: { applicationId },
      orderBy: { createdAt: 'desc' },
    });
    if (!submission) {
      throw new NotFoundException(
        'No submission record for this application yet',
      );
    }
    if (!submission.externalReference) {
      throw new BadRequestException(
        'This submission has no provider reference to check — record status updates directly',
      );
    }

    const application = await this.prisma.visaApplication.findUniqueOrThrow({
      where: { id: applicationId },
    });

    // Poll the provider that actually handled THIS submission, not
    // whichever provider is active right now — the active provider can
    // change at /admin/integrations after this submission was made.
    const provider = this.visaProviderRouter.resolveByName(
      submission.provider === VisaProviderName.MOCK ? 'mock' : 'manual',
    );
    const result = await provider.checkStatus(
      submission.externalReference,
      submission.providerStatus,
    );

    const updatedSubmission = await this.prisma.visaSubmission.update({
      where: { id: submission.id },
      data: {
        providerStatus: result.providerStatus,
        providerMessage: result.message,
      },
    });

    if (result.message) {
      await this.prisma.visaProviderMessage.create({
        data: {
          applicationId,
          message: result.message,
          severity: result.requiresAction
            ? ProviderMessageSeverity.ACTION_REQUIRED
            : ProviderMessageSeverity.INFO,
        },
      });
    }

    const mappedStatus = this.mapProviderStatus(result.providerStatus);
    if (mappedStatus && !TERMINAL_STATUSES.includes(application.status)) {
      await this.visaService.updateStatus(applicationId, mappedStatus);
    }

    await this.auditService.record({
      action: 'visa_submission.status_synced',
      entityType: 'VisaSubmission',
      entityId: submission.id,
      metadata: {
        applicationId,
        staffId,
        providerStatus: result.providerStatus,
      },
    });

    return updatedSubmission;
  }

  listSubmissions(applicationId: string) {
    return this.prisma.visaSubmission.findMany({
      where: { applicationId },
      orderBy: { createdAt: 'desc' },
    });
  }

  listProviderMessages(applicationId: string) {
    return this.prisma.visaProviderMessage.findMany({
      where: { applicationId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Manual/offline provider has no status API for syncStatus to poll — this
   * lets staff log what the embassy/agent actually said (a phone call, an
   * email) so the communication trail (spec #17) exists for manual
   * submissions too, without fabricating a fake provider response.
   */
  async addManualProviderMessage(
    applicationId: string,
    message: string,
    severity: ProviderMessageSeverity = ProviderMessageSeverity.INFO,
  ) {
    const application = await this.prisma.visaApplication.findUnique({
      where: { id: applicationId },
    });
    if (!application) {
      throw new NotFoundException('Visa application not found');
    }
    return this.prisma.visaProviderMessage.create({
      data: { applicationId, message, severity },
    });
  }

  async acknowledgeProviderMessage(id: string, staffId: string) {
    const message = await this.prisma.visaProviderMessage.findUnique({
      where: { id },
    });
    if (!message) {
      throw new NotFoundException('Provider message not found');
    }
    return this.prisma.visaProviderMessage.update({
      where: { id },
      data: { acknowledgedByStaffId: staffId, acknowledgedAt: new Date() },
    });
  }
}
