import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CustomersService } from './customers.service';

describe('CustomersService', () => {
  let service: CustomersService;
  let prisma: Record<string, Record<string, jest.Mock>>;
  let auditService: { record: jest.Mock };

  beforeEach(async () => {
    prisma = {
      customer: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      identity: {
        update: jest.fn(),
      },
    };
    auditService = { record: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CustomersService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: auditService },
      ],
    }).compile();

    service = module.get(CustomersService);
  });

  describe('findOne', () => {
    it('throws NotFound when the customer does not exist', async () => {
      prisma.customer.findUnique.mockResolvedValue(null);

      await expect(service.findOne('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('findByIdentityId', () => {
    it('throws NotFound when no customer profile is linked to the identity', async () => {
      prisma.customer.findUnique.mockResolvedValue(null);

      await expect(service.findByIdentityId('identity-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getCustomerIdForIdentity', () => {
    it('throws NotFound when there is no customer profile', async () => {
      prisma.customer.findUnique.mockResolvedValue(null);

      await expect(
        service.getCustomerIdForIdentity('identity-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('returns the customer id when found', async () => {
      prisma.customer.findUnique.mockResolvedValue({ id: 'customer-1' });

      await expect(
        service.getCustomerIdForIdentity('identity-1'),
      ).resolves.toBe('customer-1');
    });
  });

  describe('update', () => {
    it('converts date-only strings to Date objects before writing', async () => {
      prisma.customer.findUnique.mockResolvedValue({ id: 'customer-1' });
      prisma.customer.update.mockResolvedValue({ id: 'customer-1' });

      await service.update('customer-1', {
        dateOfBirth: '1990-01-01',
        passportExpiryDate: '2030-01-01',
      });

      expect(prisma.customer.update).toHaveBeenCalledWith({
        where: { id: 'customer-1' },
        data: expect.objectContaining({
          dateOfBirth: new Date('1990-01-01'),
          passportExpiryDate: new Date('2030-01-01'),
        }),
      });
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'customer.updated', entityId: 'customer-1' }),
      );
    });

    it('records a separate staff_assignment_changed audit entry when the assigned staff changes', async () => {
      prisma.customer.findUnique.mockResolvedValue({
        id: 'customer-1',
        assignedStaffId: 'staff-old',
      });
      prisma.customer.update.mockResolvedValue({
        id: 'customer-1',
        assignedStaffId: 'staff-new',
      });
      prisma.staff = { findUnique: jest.fn().mockResolvedValue({ id: 'staff-new' }) };

      await service.update(
        'customer-1',
        { assignedStaffId: 'staff-new' },
        'actor-identity',
      );

      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          identityId: 'actor-identity',
          action: 'customer.staff_assignment_changed',
          metadata: expect.objectContaining({
            previousStaffId: 'staff-old',
            newStaffId: 'staff-new',
          }),
        }),
      );
    });

    it('does not record a staff_assignment_changed entry when the assignment is untouched', async () => {
      prisma.customer.findUnique.mockResolvedValue({
        id: 'customer-1',
        assignedStaffId: 'staff-old',
      });
      prisma.customer.update.mockResolvedValue({
        id: 'customer-1',
        assignedStaffId: 'staff-old',
      });

      await service.update('customer-1', { firstName: 'Amina' });

      expect(auditService.record).not.toHaveBeenCalledWith(
        expect.objectContaining({ action: 'customer.staff_assignment_changed' }),
      );
    });
  });

  describe('deactivate', () => {
    it('sets the linked identity status to DEACTIVATED', async () => {
      prisma.customer.findUnique.mockResolvedValue({
        id: 'customer-1',
        identityId: 'identity-1',
      });

      await service.deactivate('customer-1', 'actor-identity');

      expect(prisma.identity.update).toHaveBeenCalledWith({
        where: { id: 'identity-1' },
        data: { status: 'DEACTIVATED' },
      });
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          identityId: 'actor-identity',
          action: 'customer.deactivated',
          entityId: 'customer-1',
        }),
      );
    });
  });
});
