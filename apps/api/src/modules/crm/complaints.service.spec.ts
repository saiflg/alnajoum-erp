import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ComplaintStatus } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ComplaintsService } from './complaints.service';

describe('ComplaintsService', () => {
  let service: ComplaintsService;
  let prisma: Record<string, any>;
  let notificationsService: { sendGeneric: jest.Mock };

  const complaint = {
    id: 'complaint-1',
    complaintNumber: 'CMP-0001',
    customerId: 'customer-1',
    customer: {
      id: 'customer-1',
      companyId: 'company-a',
      firstName: 'Amina',
      lastName: 'Bello',
    },
    status: ComplaintStatus.SUBMITTED,
  };

  beforeEach(async () => {
    prisma = {
      complaint: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
        create: jest.fn(),
      },
      complaintNote: { create: jest.fn() },
      customer: { findUnique: jest.fn() },
    };
    notificationsService = { sendGeneric: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ComplaintsService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationsService, useValue: notificationsService },
      ],
    }).compile();

    service = module.get(ComplaintsService);
  });

  describe('get', () => {
    it('throws NotFound for a missing complaint', async () => {
      prisma.complaint.findUnique.mockResolvedValue(null);

      await expect(service.get('missing')).rejects.toThrow(NotFoundException);
    });
  });

  /**
   * Regression — before this fix, get() (and everything built on it:
   * assign, addNote, resolve, escalate, listAll) took no tenant argument
   * at all, so any staff member holding CRM.COMPLAINT_MANAGE from ANY
   * company could read/act on another tenant's complaint by id.
   */
  describe('tenant isolation', () => {
    it('get() 404s a complaint belonging to a different company', async () => {
      prisma.complaint.findUnique.mockResolvedValue(complaint);

      await expect(service.get('complaint-1', 'company-b')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('get() returns the complaint when the caller belongs to the same company', async () => {
      prisma.complaint.findUnique.mockResolvedValue(complaint);

      await expect(service.get('complaint-1', 'company-a')).resolves.toEqual(
        complaint,
      );
    });

    it('get() applies no tenant filter when none is given (SUPER_ADMIN)', async () => {
      prisma.complaint.findUnique.mockResolvedValue(complaint);

      await expect(service.get('complaint-1')).resolves.toEqual(complaint);
    });

    it('assign() propagates the tenant check before updating', async () => {
      prisma.complaint.findUnique.mockResolvedValue(complaint);

      await expect(
        service.assign('complaint-1', 'staff-1', 'company-b'),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.complaint.update).not.toHaveBeenCalled();
    });

    it('addNote() propagates the tenant check before creating a note', async () => {
      prisma.complaint.findUnique.mockResolvedValue(complaint);

      await expect(
        service.addNote('complaint-1', 'note', 'staff-1', true, 'company-b'),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.complaintNote.create).not.toHaveBeenCalled();
    });

    it('escalate() propagates the tenant check before updating', async () => {
      prisma.complaint.findUnique.mockResolvedValue(complaint);

      await expect(
        service.escalate('complaint-1', 'FINANCE_OFFICER', 'company-b'),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.complaint.update).not.toHaveBeenCalled();
    });

    it('resolve() propagates the tenant check before updating', async () => {
      prisma.complaint.findUnique.mockResolvedValue(complaint);

      await expect(
        service.resolve('complaint-1', 'Refunded', 'company-b'),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.complaint.update).not.toHaveBeenCalled();
    });

    it('listAll() scopes through customer.companyId when a tenant filter is given', async () => {
      prisma.complaint.findMany.mockResolvedValue([]);

      await service.listAll({}, 'company-a');

      expect(prisma.complaint.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            customer: { companyId: 'company-a' },
          }),
        }),
      );
    });

    it('listAll() applies no tenant filter when none is given (SUPER_ADMIN)', async () => {
      prisma.complaint.findMany.mockResolvedValue([]);

      await service.listAll({});

      const call = prisma.complaint.findMany.mock.calls[0][0];
      expect(call.where).not.toHaveProperty('customer');
    });
  });
});
