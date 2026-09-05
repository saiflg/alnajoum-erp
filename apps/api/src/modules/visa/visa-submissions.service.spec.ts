import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
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
import { VISA_PROVIDER } from './providers/visa-provider.port';
import { VisaProviderRouter } from './providers/visa-provider.router';
import { VisaChecklistService } from './visa-checklist.service';
import { VisaSubmissionsService } from './visa-submissions.service';
import { VisaService } from './visa.service';

describe('VisaSubmissionsService', () => {
  let service: VisaSubmissionsService;
  let prisma: {
    visaApplication: {
      findUnique: jest.Mock;
      findUniqueOrThrow: jest.Mock;
      update: jest.Mock;
    };
    visaSubmission: {
      create: jest.Mock;
      findFirst: jest.Mock;
      update: jest.Mock;
      findMany: jest.Mock;
    };
    visaProviderMessage: {
      create: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
    };
  };
  let visaService: { updateStatus: jest.Mock };
  let checklistService: {
    computeChecklist: jest.Mock;
    computePassportValidity: jest.Mock;
  };
  let visaProviderRouter: {
    getActiveProviderName: jest.Mock;
    resolveByName: jest.Mock;
  };
  let countryVisaRulesService: { getApplicableRule: jest.Mock };
  let visaProvider: { submitApplication: jest.Mock; checkStatus: jest.Mock };
  let auditService: { record: jest.Mock };

  const readyApplication = {
    id: 'app-1',
    status: VisaApplicationStatus.UNDER_REVIEW,
    applicationReference: 'VISA-2026-000001',
    destinationCountry: 'UAE',
    visaType: 'TOURIST',
    applicantFirstName: 'Amina',
    applicantLastName: 'Bello',
    applicantPassportNumber: 'A1234567',
    guarantorRequired: false,
    guarantorExempt: false,
    guarantor: null,
    invoice: { status: InvoiceStatus.PAID },
  };

  beforeEach(async () => {
    prisma = {
      visaApplication: {
        findUnique: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        update: jest.fn(),
      },
      visaSubmission: {
        create: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn(),
      },
      visaProviderMessage: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };
    visaService = { updateStatus: jest.fn() };
    checklistService = {
      computeChecklist: jest
        .fn()
        .mockResolvedValue({ items: [], mandatoryComplete: true }),
      computePassportValidity: jest.fn().mockResolvedValue({ level: 'GREEN' }),
    };
    visaProvider = { submitApplication: jest.fn(), checkStatus: jest.fn() };
    visaProviderRouter = {
      getActiveProviderName: jest.fn().mockResolvedValue('manual'),
      // Lazily reads `visaProvider` — every existing syncStatus test that
      // stubs `visaProvider.checkStatus` keeps working unchanged since
      // resolveByName defaults to returning that same mock provider.
      resolveByName: jest.fn().mockImplementation(() => visaProvider),
    };
    countryVisaRulesService = {
      getApplicableRule: jest.fn().mockResolvedValue(null),
    };
    auditService = { record: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VisaSubmissionsService,
        { provide: PrismaService, useValue: prisma },
        { provide: VisaService, useValue: visaService },
        { provide: VisaChecklistService, useValue: checklistService },
        { provide: VisaProviderRouter, useValue: visaProviderRouter },
        { provide: CountryVisaRulesService, useValue: countryVisaRulesService },
        { provide: AuditService, useValue: auditService },
        { provide: VISA_PROVIDER, useValue: visaProvider },
      ],
    }).compile();

    service = module.get(VisaSubmissionsService);
  });

  describe('submit', () => {
    beforeEach(() => {
      prisma.visaApplication.findUnique.mockResolvedValue({
        ...readyApplication,
      });
      visaProvider.submitApplication.mockResolvedValue({
        externalReference: 'MOCKVISA-AAAA1111',
        providerStatus: 'RECEIVED',
        message: 'Application received',
      });
      prisma.visaSubmission.create.mockResolvedValue({ id: 'sub-1' });
    });

    it('creates the submission, logs the provider message, and advances the status', async () => {
      await service.submit('app-1', 'staff-1');

      expect(prisma.visaSubmission.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          applicationId: 'app-1',
          submittedByStaffId: 'staff-1',
          provider: VisaProviderName.MANUAL,
          externalReference: 'MOCKVISA-AAAA1111',
        }),
      });
      expect(prisma.visaProviderMessage.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          applicationId: 'app-1',
          message: 'Application received',
          severity: ProviderMessageSeverity.INFO,
        }),
      });
      expect(visaService.updateStatus).toHaveBeenCalledWith(
        'app-1',
        VisaApplicationStatus.SUBMITTED_TO_PROVIDER,
      );
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'visa_submission.created' }),
      );
    });

    it('snapshots the SLA target from the applicable CountryVisaRule at submission time (spec #30)', async () => {
      countryVisaRulesService.getApplicableRule.mockResolvedValue({
        processingTimeDays: 10,
      });

      await service.submit('app-1', 'staff-1');

      expect(prisma.visaApplication.update).toHaveBeenCalledWith({
        where: { id: 'app-1' },
        data: expect.objectContaining({
          slaTargetDays: 10,
          slaDueAt: expect.any(Date),
        }),
      });
    });

    it('does not set an SLA when no rule configures a processing time', async () => {
      countryVisaRulesService.getApplicableRule.mockResolvedValue(null);

      await service.submit('app-1', 'staff-1');

      expect(prisma.visaApplication.update).not.toHaveBeenCalled();
    });

    it('throws NotFound for a missing application', async () => {
      prisma.visaApplication.findUnique.mockResolvedValue(null);

      await expect(service.submit('missing', 'staff-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('rejects submission for an application not currently UNDER_REVIEW', async () => {
      prisma.visaApplication.findUnique.mockResolvedValue({
        ...readyApplication,
        status: VisaApplicationStatus.PAYMENT_PENDING,
      });

      await expect(service.submit('app-1', 'staff-1')).rejects.toThrow(
        ConflictException,
      );
      expect(visaProvider.submitApplication).not.toHaveBeenCalled();
    });

    it('hard-blocks submission when a required guarantor is not verified + approved (spec #6)', async () => {
      prisma.visaApplication.findUnique.mockResolvedValue({
        ...readyApplication,
        guarantorRequired: true,
        guarantor: {
          verificationStatus: VerificationStatus.PENDING,
          approvalStatus: ApprovalStatus.PENDING,
        },
      });

      await expect(service.submit('app-1', 'staff-1')).rejects.toThrow(
        ConflictException,
      );
      expect(visaProvider.submitApplication).not.toHaveBeenCalled();
    });

    it('allows submission when the guarantor requirement was staff-exempted', async () => {
      prisma.visaApplication.findUnique.mockResolvedValue({
        ...readyApplication,
        guarantorRequired: true,
        guarantorExempt: true,
        guarantor: null,
      });

      await service.submit('app-1', 'staff-1');

      expect(visaProvider.submitApplication).toHaveBeenCalled();
    });

    it('blocks submission when payment has not been verified', async () => {
      prisma.visaApplication.findUnique.mockResolvedValue({
        ...readyApplication,
        invoice: { status: InvoiceStatus.ISSUED },
      });

      await expect(service.submit('app-1', 'staff-1')).rejects.toThrow(
        ConflictException,
      );
    });

    it('blocks submission when the document checklist is incomplete', async () => {
      checklistService.computeChecklist.mockResolvedValue({
        items: [],
        mandatoryComplete: false,
      });

      await expect(service.submit('app-1', 'staff-1')).rejects.toThrow(
        ConflictException,
      );
      expect(visaProvider.submitApplication).not.toHaveBeenCalled();
    });

    it('blocks submission when the passport validity is RED', async () => {
      checklistService.computePassportValidity.mockResolvedValue({
        level: 'RED',
      });

      await expect(service.submit('app-1', 'staff-1')).rejects.toThrow(
        ConflictException,
      );
      expect(visaProvider.submitApplication).not.toHaveBeenCalled();
    });
  });

  describe('syncStatus', () => {
    beforeEach(() => {
      prisma.visaSubmission.findFirst.mockResolvedValue({
        id: 'sub-1',
        externalReference: 'MOCKVISA-AAAA1111',
        providerStatus: 'RECEIVED',
      });
      prisma.visaApplication.findUniqueOrThrow.mockResolvedValue({
        id: 'app-1',
        status: VisaApplicationStatus.SUBMITTED_TO_PROVIDER,
      });
      prisma.visaSubmission.update.mockResolvedValue({ id: 'sub-1' });
    });

    it('polls the provider recorded on the submission, not whichever provider is active right now (regression)', async () => {
      // Submission was made via MOCK, but the platform has since switched
      // its active provider to something else — syncStatus must still ask
      // resolveByName for 'mock', never fall back to "whatever's active".
      prisma.visaSubmission.findFirst.mockResolvedValue({
        id: 'sub-1',
        externalReference: 'MOCKVISA-AAAA1111',
        providerStatus: 'RECEIVED',
        provider: VisaProviderName.MOCK,
      });
      visaProviderRouter.getActiveProviderName.mockResolvedValue('manual');
      visaProvider.checkStatus.mockResolvedValue({
        providerStatus: 'PROCESSING',
        message: null,
        requiresAction: false,
      });

      await service.syncStatus('app-1', 'staff-1');

      expect(visaProviderRouter.resolveByName).toHaveBeenCalledWith('mock');
    });

    it('advances the internal status when the provider reports PROCESSING', async () => {
      visaProvider.checkStatus.mockResolvedValue({
        providerStatus: 'PROCESSING',
        message: 'Application is being processed.',
        requiresAction: false,
      });

      await service.syncStatus('app-1', 'staff-1');

      expect(visaService.updateStatus).toHaveBeenCalledWith(
        'app-1',
        VisaApplicationStatus.PROCESSING,
      );
      expect(prisma.visaProviderMessage.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          severity: ProviderMessageSeverity.INFO,
        }),
      });
    });

    it('maps APPROVED to COMPLETED, reusing VisaService.updateStatus (and its incentive trigger)', async () => {
      visaProvider.checkStatus.mockResolvedValue({
        providerStatus: 'APPROVED',
        message: 'Visa approved.',
        requiresAction: false,
      });

      await service.syncStatus('app-1', 'staff-1');

      expect(visaService.updateStatus).toHaveBeenCalledWith(
        'app-1',
        VisaApplicationStatus.COMPLETED,
      );
    });

    it('flags an ACTION_REQUIRED message when the provider requires action', async () => {
      visaProvider.checkStatus.mockResolvedValue({
        providerStatus: 'ADDITIONAL_INFO_REQUIRED',
        message: 'Please provide an additional document.',
        requiresAction: true,
      });

      await service.syncStatus('app-1', 'staff-1');

      expect(prisma.visaProviderMessage.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          severity: ProviderMessageSeverity.ACTION_REQUIRED,
        }),
      });
    });

    it('does not change the internal status for an unrecognized/no-op provider status', async () => {
      visaProvider.checkStatus.mockResolvedValue({
        providerStatus: 'RECEIVED',
        message: null,
        requiresAction: false,
      });

      await service.syncStatus('app-1', 'staff-1');

      expect(visaService.updateStatus).not.toHaveBeenCalled();
    });

    it('never overwrites the status of an application that has already reached a terminal state', async () => {
      prisma.visaApplication.findUniqueOrThrow.mockResolvedValue({
        id: 'app-1',
        status: VisaApplicationStatus.COMPLETED,
      });
      visaProvider.checkStatus.mockResolvedValue({
        providerStatus: 'PROCESSING',
        message: null,
        requiresAction: false,
      });

      await service.syncStatus('app-1', 'staff-1');

      expect(visaService.updateStatus).not.toHaveBeenCalled();
    });

    it('throws NotFound when there is no submission yet', async () => {
      prisma.visaSubmission.findFirst.mockResolvedValue(null);

      await expect(service.syncStatus('app-1', 'staff-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws BadRequest for a manual submission with no external reference to poll', async () => {
      prisma.visaSubmission.findFirst.mockResolvedValue({
        id: 'sub-1',
        externalReference: null,
        providerStatus: 'MANUAL_PROCESSING',
      });

      await expect(service.syncStatus('app-1', 'staff-1')).rejects.toThrow(
        BadRequestException,
      );
      expect(visaProvider.checkStatus).not.toHaveBeenCalled();
    });
  });

  describe('addManualProviderMessage', () => {
    it('creates a provider message for an existing application', async () => {
      prisma.visaApplication.findUnique.mockResolvedValue({ id: 'app-1' });
      prisma.visaProviderMessage.create.mockResolvedValue({ id: 'msg-1' });

      await service.addManualProviderMessage(
        'app-1',
        'Called the embassy, 2 more weeks',
      );

      expect(prisma.visaProviderMessage.create).toHaveBeenCalledWith({
        data: {
          applicationId: 'app-1',
          message: 'Called the embassy, 2 more weeks',
          severity: ProviderMessageSeverity.INFO,
        },
      });
    });

    it('throws NotFound for a missing application', async () => {
      prisma.visaApplication.findUnique.mockResolvedValue(null);

      await expect(
        service.addManualProviderMessage('missing', 'note'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('acknowledgeProviderMessage', () => {
    it('stamps the acknowledging staff member and timestamp', async () => {
      prisma.visaProviderMessage.findUnique.mockResolvedValue({ id: 'msg-1' });
      prisma.visaProviderMessage.update.mockResolvedValue({ id: 'msg-1' });

      await service.acknowledgeProviderMessage('msg-1', 'staff-1');

      expect(prisma.visaProviderMessage.update).toHaveBeenCalledWith({
        where: { id: 'msg-1' },
        data: expect.objectContaining({ acknowledgedByStaffId: 'staff-1' }),
      });
    });

    it('throws NotFound for a missing message', async () => {
      prisma.visaProviderMessage.findUnique.mockResolvedValue(null);

      await expect(
        service.acknowledgeProviderMessage('missing', 'staff-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
