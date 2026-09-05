import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { DocumentType, VisaDocumentStatus } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CountryVisaRulesService } from './country-visa-rules.service';
import { VisaChecklistService } from './visa-checklist.service';

describe('VisaChecklistService', () => {
  let service: VisaChecklistService;
  let prisma: {
    visaApplication: { findUnique: jest.Mock };
    documentChecklistException: { findUnique: jest.Mock; create: jest.Mock };
  };
  let countryVisaRulesService: { getApplicableRule: jest.Mock };
  let auditService: { record: jest.Mock };

  const baseApplication = {
    id: 'app-1',
    destinationCountry: 'UAE',
    visaType: 'TOURIST',
    familyMemberId: null,
    customer: { passportExpiryDate: null },
    familyMember: null,
    documents: [] as Array<{
      type: DocumentType;
      status: VisaDocumentStatus;
      id: string;
      createdAt: Date;
      expiryDate: Date | null;
    }>,
    checklistExceptions: [] as Array<{
      documentType: DocumentType;
      reason: string;
    }>,
  };

  beforeEach(async () => {
    prisma = {
      visaApplication: { findUnique: jest.fn() },
      documentChecklistException: { findUnique: jest.fn(), create: jest.fn() },
    };
    countryVisaRulesService = { getApplicableRule: jest.fn() };
    auditService = { record: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VisaChecklistService,
        { provide: PrismaService, useValue: prisma },
        { provide: CountryVisaRulesService, useValue: countryVisaRulesService },
        { provide: AuditService, useValue: auditService },
      ],
    }).compile();

    service = module.get(VisaChecklistService);
  });

  describe('computeChecklist', () => {
    it('throws NotFound for a missing application', async () => {
      prisma.visaApplication.findUnique.mockResolvedValue(null);

      await expect(service.computeChecklist('missing')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('marks a required document MISSING when nothing is configured to cover it', async () => {
      prisma.visaApplication.findUnique.mockResolvedValue({
        ...baseApplication,
      });
      countryVisaRulesService.getApplicableRule.mockResolvedValue({
        requiredDocumentTypes: [DocumentType.PASSPORT],
        optionalDocumentTypes: [],
      });

      const result = await service.computeChecklist('app-1');

      expect(result.items).toEqual([
        expect.objectContaining({
          documentType: DocumentType.PASSPORT,
          required: true,
          state: 'MISSING',
        }),
      ]);
      expect(result.mandatoryComplete).toBe(false);
    });

    it('mandatoryComplete is true with no configured rule at all', async () => {
      prisma.visaApplication.findUnique.mockResolvedValue({
        ...baseApplication,
      });
      countryVisaRulesService.getApplicableRule.mockResolvedValue(null);

      const result = await service.computeChecklist('app-1');

      expect(result.items).toEqual([]);
      expect(result.mandatoryComplete).toBe(true);
    });

    it('an uploaded (not yet verified) required document still counts as mandatory-complete', async () => {
      prisma.visaApplication.findUnique.mockResolvedValue({
        ...baseApplication,
        documents: [
          {
            type: DocumentType.PASSPORT,
            status: VisaDocumentStatus.PENDING_REVIEW,
            id: 'doc-1',
            createdAt: new Date('2026-01-01'),
            expiryDate: null,
          },
        ],
      });
      countryVisaRulesService.getApplicableRule.mockResolvedValue({
        requiredDocumentTypes: [DocumentType.PASSPORT],
        optionalDocumentTypes: [],
      });

      const result = await service.computeChecklist('app-1');

      expect(result.items[0].state).toBe('UPLOADED');
      expect(result.mandatoryComplete).toBe(true);
    });

    it('a rejected required document without an exception blocks mandatoryComplete', async () => {
      prisma.visaApplication.findUnique.mockResolvedValue({
        ...baseApplication,
        documents: [
          {
            type: DocumentType.PASSPORT,
            status: VisaDocumentStatus.REJECTED,
            id: 'doc-1',
            createdAt: new Date('2026-01-01'),
            expiryDate: null,
          },
        ],
      });
      countryVisaRulesService.getApplicableRule.mockResolvedValue({
        requiredDocumentTypes: [DocumentType.PASSPORT],
        optionalDocumentTypes: [],
      });

      const result = await service.computeChecklist('app-1');

      expect(result.items[0].state).toBe('REJECTED');
      expect(result.mandatoryComplete).toBe(false);
    });

    it('an exception covers a missing required document as EXEMPTED', async () => {
      prisma.visaApplication.findUnique.mockResolvedValue({
        ...baseApplication,
        checklistExceptions: [
          {
            documentType: DocumentType.PASSPORT,
            reason: 'Passport lost, police report on file',
          },
        ],
      });
      countryVisaRulesService.getApplicableRule.mockResolvedValue({
        requiredDocumentTypes: [DocumentType.PASSPORT],
        optionalDocumentTypes: [],
      });

      const result = await service.computeChecklist('app-1');

      expect(result.items[0].state).toBe('EXEMPTED');
      expect(result.mandatoryComplete).toBe(true);
    });

    it('an expired document is flagged EXPIRED even if it was previously verified', async () => {
      prisma.visaApplication.findUnique.mockResolvedValue({
        ...baseApplication,
        documents: [
          {
            type: DocumentType.TRAVEL_INSURANCE,
            status: VisaDocumentStatus.VERIFIED,
            id: 'doc-1',
            createdAt: new Date('2025-01-01'),
            expiryDate: new Date('2025-06-01'),
          },
        ],
      });
      countryVisaRulesService.getApplicableRule.mockResolvedValue({
        requiredDocumentTypes: [DocumentType.TRAVEL_INSURANCE],
        optionalDocumentTypes: [],
      });

      const result = await service.computeChecklist('app-1');

      expect(result.items[0].state).toBe('EXPIRED');
      expect(result.mandatoryComplete).toBe(false);
    });
  });

  describe('computePassportValidity', () => {
    it('returns UNKNOWN when the applicant has no passport expiry date on file', async () => {
      prisma.visaApplication.findUnique.mockResolvedValue({
        ...baseApplication,
      });
      countryVisaRulesService.getApplicableRule.mockResolvedValue(null);

      const result = await service.computePassportValidity('app-1');

      expect(result.level).toBe('UNKNOWN');
    });

    it('RED when the passport has already expired', async () => {
      prisma.visaApplication.findUnique.mockResolvedValue({
        ...baseApplication,
        customer: { passportExpiryDate: new Date('2020-01-01') },
      });
      countryVisaRulesService.getApplicableRule.mockResolvedValue(null);

      const result = await service.computePassportValidity('app-1');

      expect(result.level).toBe('RED');
    });

    it('GREEN with no configured minimum validity, as long as the passport has not expired', async () => {
      const future = new Date();
      future.setFullYear(future.getFullYear() + 2);
      prisma.visaApplication.findUnique.mockResolvedValue({
        ...baseApplication,
        customer: { passportExpiryDate: future },
      });
      countryVisaRulesService.getApplicableRule.mockResolvedValue(null);

      const result = await service.computePassportValidity('app-1');

      expect(result.level).toBe('GREEN');
    });

    it('RED when validity is below the configured minimum', async () => {
      const soon = new Date();
      soon.setMonth(soon.getMonth() + 2);
      prisma.visaApplication.findUnique.mockResolvedValue({
        ...baseApplication,
        customer: { passportExpiryDate: soon },
      });
      countryVisaRulesService.getApplicableRule.mockResolvedValue({
        minPassportValidityMonths: 6,
      });

      const result = await service.computePassportValidity('app-1');

      expect(result.level).toBe('RED');
    });

    it('AMBER when within 3 months of the configured minimum', async () => {
      const almostThere = new Date();
      almostThere.setMonth(almostThere.getMonth() + 7);
      prisma.visaApplication.findUnique.mockResolvedValue({
        ...baseApplication,
        customer: { passportExpiryDate: almostThere },
      });
      countryVisaRulesService.getApplicableRule.mockResolvedValue({
        minPassportValidityMonths: 6,
      });

      const result = await service.computePassportValidity('app-1');

      expect(result.level).toBe('AMBER');
    });

    it('reads the family member passport when the application is for one', async () => {
      const future = new Date();
      future.setFullYear(future.getFullYear() + 2);
      prisma.visaApplication.findUnique.mockResolvedValue({
        ...baseApplication,
        familyMemberId: 'fm-1',
        customer: { passportExpiryDate: null },
        familyMember: { passportExpiryDate: future },
      });
      countryVisaRulesService.getApplicableRule.mockResolvedValue(null);

      const result = await service.computePassportValidity('app-1');

      expect(result.level).toBe('GREEN');
    });
  });

  describe('addException', () => {
    it('creates the exception and audits it', async () => {
      prisma.visaApplication.findUnique.mockResolvedValue({
        ...baseApplication,
      });
      prisma.documentChecklistException.findUnique.mockResolvedValue(null);
      prisma.documentChecklistException.create.mockResolvedValue({
        id: 'exc-1',
        applicationId: 'app-1',
        documentType: DocumentType.PASSPORT,
        reason: 'Lost passport, police report attached',
        approvedByStaffId: 'staff-1',
      });

      await service.addException(
        'app-1',
        DocumentType.PASSPORT,
        'Lost passport, police report attached',
        'staff-1',
      );

      expect(prisma.documentChecklistException.create).toHaveBeenCalledWith({
        data: {
          applicationId: 'app-1',
          documentType: DocumentType.PASSPORT,
          reason: 'Lost passport, police report attached',
          approvedByStaffId: 'staff-1',
        },
      });
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'visa_document_checklist.exception_granted',
        }),
      );
    });

    it('rejects a duplicate exception for the same document type', async () => {
      prisma.visaApplication.findUnique.mockResolvedValue({
        ...baseApplication,
      });
      prisma.documentChecklistException.findUnique.mockResolvedValue({
        id: 'existing',
      });

      await expect(
        service.addException(
          'app-1',
          DocumentType.PASSPORT,
          'reason',
          'staff-1',
        ),
      ).rejects.toThrow(ConflictException);
      expect(prisma.documentChecklistException.create).not.toHaveBeenCalled();
    });
  });
});
