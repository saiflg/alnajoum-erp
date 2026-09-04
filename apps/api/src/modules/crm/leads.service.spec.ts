import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { LeadStatus } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { LeadsService } from './leads.service';

describe('LeadsService', () => {
  let service: LeadsService;
  let prisma: Record<string, any>;
  let notificationsService: { sendGeneric: jest.Mock };

  const openLead = {
    id: 'lead-1',
    leadNumber: 'LEAD-ABC123',
    name: 'Blessing Adeyemi',
    phone: '+2348021110001',
    email: 'blessing@example.com',
    status: LeadStatus.OPEN,
    stageId: 'stage-new',
    stage: { id: 'stage-new', name: 'New Lead' },
    assignedStaffId: null,
    assignedBranchId: null,
  };

  beforeEach(async () => {
    prisma = {
      leadStage: {
        upsert: jest.fn(),
        findFirstOrThrow: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
      },
      lead: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn(),
      },
      leadActivity: { create: jest.fn() },
      staff: { findUnique: jest.fn(), findMany: jest.fn() },
      customer: { findUnique: jest.fn(), findFirst: jest.fn() },
      identity: { findUnique: jest.fn(), create: jest.fn() },
      role: { findUnique: jest.fn() },
      customerTimelineEvent: { create: jest.fn() },
    };
    notificationsService = { sendGeneric: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LeadsService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: { record: jest.fn() } },
        { provide: NotificationsService, useValue: notificationsService },
      ],
    }).compile();

    service = module.get(LeadsService);
  });

  describe('create', () => {
    it('creates a lead in the default (lowest-order, non-terminal) stage and logs the first activity', async () => {
      prisma.leadStage.findFirstOrThrow.mockResolvedValue({
        id: 'stage-new',
        name: 'New Lead',
      });
      prisma.lead.create.mockResolvedValue({
        id: 'lead-1',
        leadNumber: 'LEAD-ABC123',
      });

      await service.create(
        {
          name: 'Blessing Adeyemi',
          phone: '+2348021110001',
          source: 'WHATSAPP',
        } as never,
        'staff-1',
      );

      expect(prisma.lead.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            stageId: 'stage-new',
            createdByStaffId: 'staff-1',
          }),
        }),
      );
      expect(prisma.leadActivity.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'created',
            leadId: 'lead-1',
          }),
        }),
      );
    });
  });

  describe('changeStage', () => {
    it('rejects moving a lead that is already converted or lost', async () => {
      prisma.lead.findUnique.mockResolvedValue({
        ...openLead,
        status: LeadStatus.CONVERTED,
      });

      await expect(service.changeStage('lead-1', 'stage-2')).rejects.toThrow(
        ConflictException,
      );
    });

    it('records a stage_changed activity with the from/to stage names', async () => {
      prisma.lead.findUnique.mockResolvedValue(openLead);
      prisma.leadStage.findUnique.mockResolvedValue({
        id: 'stage-2',
        name: 'Contacted',
      });
      prisma.lead.update.mockResolvedValue({ ...openLead, stageId: 'stage-2' });

      await service.changeStage('lead-1', 'stage-2', 'staff-1');

      expect(prisma.leadActivity.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'stage_changed',
            fromStageId: 'stage-new',
            toStageId: 'stage-2',
          }),
        }),
      );
    });
  });

  describe('assign', () => {
    it('assigns a lead to the staff member and inherits their branch', async () => {
      prisma.lead.findUnique.mockResolvedValue(openLead);
      prisma.staff.findUnique.mockResolvedValue({
        id: 'staff-2',
        firstName: 'Fatima',
        lastName: 'Sule',
        branchId: 'branch-1',
      });
      prisma.lead.update.mockResolvedValue({
        ...openLead,
        assignedStaffId: 'staff-2',
        assignedBranchId: 'branch-1',
      });

      const result = await service.assign('lead-1', 'staff-2', 'staff-1');

      expect(prisma.lead.update).toHaveBeenCalledWith({
        where: { id: 'lead-1' },
        data: { assignedStaffId: 'staff-2', assignedBranchId: 'branch-1' },
      });
      expect(result.assignedStaffId).toBe('staff-2');
    });

    it('throws NotFound for an unknown staff member', async () => {
      prisma.lead.findUnique.mockResolvedValue(openLead);
      prisma.staff.findUnique.mockResolvedValue(null);

      await expect(service.assign('lead-1', 'missing-staff')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('markLost', () => {
    it('rejects marking an already-converted lead lost', async () => {
      prisma.lead.findUnique.mockResolvedValue({
        ...openLead,
        status: LeadStatus.CONVERTED,
      });

      await expect(service.markLost('lead-1', 'no budget')).rejects.toThrow(
        ConflictException,
      );
    });

    it('moves the lead to the Lost stage and records the reason', async () => {
      prisma.lead.findUnique.mockResolvedValue(openLead);
      prisma.leadStage.findFirstOrThrow.mockResolvedValue({
        id: 'stage-lost',
        name: 'Lost',
        isLost: true,
      });
      prisma.lead.update.mockResolvedValue({
        ...openLead,
        status: LeadStatus.LOST,
      });

      await service.markLost('lead-1', 'Chose a competitor', 'staff-1');

      expect(prisma.lead.update).toHaveBeenCalledWith({
        where: { id: 'lead-1' },
        data: {
          status: LeadStatus.LOST,
          stageId: 'stage-lost',
          lostReason: 'Chose a competitor',
        },
      });
    });
  });

  describe('convert (spec #6 — no duplicate customer records)', () => {
    beforeEach(() => {
      prisma.lead.findUnique.mockResolvedValue(openLead);
      prisma.leadStage.findFirstOrThrow.mockResolvedValue({
        id: 'stage-won',
        name: 'Converted',
        isWon: true,
      });
    });

    it('reuses an existing customer matching the lead phone/email instead of creating a new one', async () => {
      const existingCustomer = { id: 'customer-existing' };
      prisma.customer.findFirst.mockResolvedValue(existingCustomer);
      prisma.lead.update.mockResolvedValue({
        ...openLead,
        status: LeadStatus.CONVERTED,
        convertedCustomerId: 'customer-existing',
      });

      const result = await service.convert('lead-1', {
        actorStaffId: 'staff-1',
      });

      expect(prisma.identity.create).not.toHaveBeenCalled();
      expect(result.customer.id).toBe('customer-existing');
      expect(prisma.lead.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            convertedCustomerId: 'customer-existing',
          }),
        }),
      );
    });

    it('reuses an explicitly passed existingCustomerId over the phone/email lookup', async () => {
      prisma.customer.findUnique.mockResolvedValue({ id: 'customer-picked' });
      prisma.lead.update.mockResolvedValue({
        ...openLead,
        status: LeadStatus.CONVERTED,
        convertedCustomerId: 'customer-picked',
      });

      const result = await service.convert('lead-1', {
        existingCustomerId: 'customer-picked',
        actorStaffId: 'staff-1',
      });

      expect(prisma.customer.findFirst).not.toHaveBeenCalled();
      expect(result.customer.id).toBe('customer-picked');
    });

    it('throws NotFound when an explicit existingCustomerId does not exist', async () => {
      prisma.customer.findUnique.mockResolvedValue(null);

      await expect(
        service.convert('lead-1', { existingCustomerId: 'missing' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('creates a brand-new customer account and sends a welcome message when no match is found', async () => {
      prisma.customer.findFirst.mockResolvedValue(null);
      prisma.identity.findUnique.mockResolvedValue(null); // no email collision
      prisma.role.findUnique.mockResolvedValue({ id: 'role-customer' });
      prisma.identity.create.mockResolvedValue({
        id: 'identity-new',
        customer: {
          id: 'customer-new',
          firstName: 'Blessing',
          lastName: 'Adeyemi',
        },
      });
      prisma.lead.update.mockResolvedValue({
        ...openLead,
        status: LeadStatus.CONVERTED,
        convertedCustomerId: 'customer-new',
      });

      const result = await service.convert('lead-1', {
        actorStaffId: 'staff-1',
      });

      expect(prisma.identity.create).toHaveBeenCalled();
      expect(notificationsService.sendGeneric).toHaveBeenCalledWith(
        expect.any(String),
        'identity-new',
        expect.stringContaining('Welcome'),
        expect.any(String),
      );
      expect(result.customer.id).toBe('customer-new');
    });

    it('refuses to silently overwrite an existing account with a colliding email', async () => {
      prisma.customer.findFirst.mockResolvedValue(null);
      prisma.identity.findUnique.mockResolvedValue({
        id: 'identity-collision',
      });

      await expect(service.convert('lead-1', {})).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.identity.create).not.toHaveBeenCalled();
    });

    it('rejects converting a lead that is already converted or lost', async () => {
      prisma.lead.findUnique.mockResolvedValue({
        ...openLead,
        status: LeadStatus.LOST,
      });

      await expect(service.convert('lead-1', {})).rejects.toThrow(
        ConflictException,
      );
    });
  });
});
