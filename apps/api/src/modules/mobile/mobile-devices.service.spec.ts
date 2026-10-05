import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { MobileDevicesService } from './mobile-devices.service';

describe('MobileDevicesService', () => {
  let service: MobileDevicesService;
  let prisma: {
    mobileDevice: {
      upsert: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
    };
  };
  let auditService: { record: jest.Mock };

  beforeEach(async () => {
    prisma = {
      mobileDevice: {
        upsert: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };
    auditService = { record: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MobileDevicesService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: auditService },
      ],
    }).compile();

    service = module.get(MobileDevicesService);
  });

  describe('register', () => {
    it('upserts keyed on identityId+deviceId and audits it', async () => {
      prisma.mobileDevice.upsert.mockResolvedValue({ id: 'dev-1' });

      await service.register('identity-1', {
        deviceId: 'install-abc',
        platform: 'ANDROID' as never,
        appVersion: '1.0.0',
      });

      expect(prisma.mobileDevice.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            identityId_deviceId: { identityId: 'identity-1', deviceId: 'install-abc' },
          },
        }),
      );
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'mobile.device_registered' }),
      );
    });

    it('un-revokes on re-registration (reinstall/relaunch)', async () => {
      prisma.mobileDevice.upsert.mockResolvedValue({ id: 'dev-1' });

      await service.register('identity-1', {
        deviceId: 'install-abc',
        platform: 'IOS' as never,
        appVersion: '1.1.0',
      });

      const call = prisma.mobileDevice.upsert.mock.calls[0][0];
      expect(call.update.revokedAt).toBeNull();
    });

    it('defaults pushProvider to EXPO when a token is given but no provider', async () => {
      prisma.mobileDevice.upsert.mockResolvedValue({ id: 'dev-1' });

      await service.register('identity-1', {
        deviceId: 'install-abc',
        platform: 'IOS' as never,
        appVersion: '1.1.0',
        pushToken: 'ExponentPushToken[xxx]',
      });

      const call = prisma.mobileDevice.upsert.mock.calls[0][0];
      expect(call.create.pushProvider).toBe('EXPO');
    });

    it('leaves pushProvider null when no token is given', async () => {
      prisma.mobileDevice.upsert.mockResolvedValue({ id: 'dev-1' });

      await service.register('identity-1', {
        deviceId: 'install-abc',
        platform: 'IOS' as never,
        appVersion: '1.1.0',
      });

      const call = prisma.mobileDevice.upsert.mock.calls[0][0];
      expect(call.create.pushProvider).toBeNull();
    });
  });

  describe('ownership isolation', () => {
    it('updatePushToken throws NotFound for a device belonging to another identity', async () => {
      prisma.mobileDevice.findUnique.mockResolvedValue({
        id: 'dev-1',
        identityId: 'identity-OTHER',
      });

      await expect(
        service.updatePushToken('identity-1', 'dev-1', { pushToken: 'tok' }),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.mobileDevice.update).not.toHaveBeenCalled();
    });

    it('revoke throws NotFound for a missing device', async () => {
      prisma.mobileDevice.findUnique.mockResolvedValue(null);

      await expect(service.revoke('identity-1', 'missing')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('revoke clears the push token and audits a security event', async () => {
      prisma.mobileDevice.findUnique.mockResolvedValue({
        id: 'dev-1',
        identityId: 'identity-1',
        revokedAt: null,
      });
      prisma.mobileDevice.update.mockResolvedValue({ id: 'dev-1', revokedAt: new Date() });

      await service.revoke('identity-1', 'dev-1');

      expect(prisma.mobileDevice.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ pushToken: null, pushProvider: null }),
        }),
      );
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'security.mobile_device_revoked' }),
      );
    });

    it('revoke is a no-op (no duplicate audit) for an already-revoked device', async () => {
      const revokedDevice = { id: 'dev-1', identityId: 'identity-1', revokedAt: new Date() };
      prisma.mobileDevice.findUnique.mockResolvedValue(revokedDevice);

      const result = await service.revoke('identity-1', 'dev-1');

      expect(result).toBe(revokedDevice);
      expect(prisma.mobileDevice.update).not.toHaveBeenCalled();
      expect(auditService.record).not.toHaveBeenCalled();
    });
  });

  describe('listForIdentity', () => {
    it('scopes strictly by identityId', async () => {
      prisma.mobileDevice.findMany.mockResolvedValue([]);

      await service.listForIdentity('identity-1');

      expect(prisma.mobileDevice.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { identityId: 'identity-1' } }),
      );
    });
  });
});
