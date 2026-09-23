import { HttpException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as argon2 from 'argon2';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { WhatsAppOtpService } from './whatsapp-otp.service';

describe('WhatsAppOtpService', () => {
  let service: WhatsAppOtpService;
  let prisma: {
    whatsAppOtpChallenge: {
      findFirst: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    customer: { updateMany: jest.Mock };
  };
  let auditService: { record: jest.Mock };

  beforeEach(async () => {
    prisma = {
      whatsAppOtpChallenge: {
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      customer: { updateMany: jest.fn() },
    };
    auditService = { record: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WhatsAppOtpService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: auditService },
      ],
    }).compile();

    service = module.get(WhatsAppOtpService);
  });

  describe('requestOtp', () => {
    it('creates a hashed challenge and returns the plaintext code', async () => {
      prisma.whatsAppOtpChallenge.findFirst.mockResolvedValue(null);
      prisma.whatsAppOtpChallenge.create.mockResolvedValue({});

      const code = await service.requestOtp('+2348031234567', 'customer-1');

      expect(code).toMatch(/^\d{6}$/);
      const createCall = prisma.whatsAppOtpChallenge.create.mock
        .calls[0][0] as {
        data: { codeHash: string; phoneNumber: string };
      };
      expect(createCall.data.codeHash).not.toBe(code);
      await expect(argon2.verify(createCall.data.codeHash, code)).resolves.toBe(
        true,
      );
      expect(createCall.data.phoneNumber).toBe('+2348031234567');
    });

    it('never logs the plaintext code anywhere', async () => {
      prisma.whatsAppOtpChallenge.findFirst.mockResolvedValue(null);
      prisma.whatsAppOtpChallenge.create.mockResolvedValue({});

      const code = await service.requestOtp('+2348031234567');

      const auditCall = auditService.record.mock.calls[0][0];
      expect(JSON.stringify(auditCall)).not.toContain(code);
    });

    it('blocks a resend within the cooldown window', async () => {
      prisma.whatsAppOtpChallenge.findFirst.mockResolvedValue({
        createdAt: new Date(),
      });

      await expect(service.requestOtp('+2348031234567')).rejects.toThrow(
        HttpException,
      );
      expect(prisma.whatsAppOtpChallenge.create).not.toHaveBeenCalled();
    });

    it('allows a resend once the cooldown has passed', async () => {
      prisma.whatsAppOtpChallenge.findFirst.mockResolvedValue({
        createdAt: new Date(Date.now() - 5 * 60 * 1000),
      });
      prisma.whatsAppOtpChallenge.create.mockResolvedValue({});

      await expect(service.requestOtp('+2348031234567')).resolves.toMatch(
        /^\d{6}$/,
      );
    });
  });

  describe('verifyOtp', () => {
    it('returns false when no challenge exists', async () => {
      prisma.whatsAppOtpChallenge.findFirst.mockResolvedValue(null);

      await expect(service.verifyOtp('+2348031234567', '123456')).resolves.toBe(
        false,
      );
    });

    it('returns false for an expired challenge', async () => {
      prisma.whatsAppOtpChallenge.findFirst.mockResolvedValue({
        id: 'challenge-1',
        expiresAt: new Date(Date.now() - 1000),
        attempts: 0,
      });

      await expect(service.verifyOtp('+2348031234567', '123456')).resolves.toBe(
        false,
      );
    });

    it('returns false once the attempt limit is reached, without checking the hash', async () => {
      prisma.whatsAppOtpChallenge.findFirst.mockResolvedValue({
        id: 'challenge-1',
        expiresAt: new Date(Date.now() + 60_000),
        attempts: 5,
        codeHash: await argon2.hash('123456'),
      });

      await expect(service.verifyOtp('+2348031234567', '123456')).resolves.toBe(
        false,
      );
      expect(prisma.whatsAppOtpChallenge.update).not.toHaveBeenCalled();
    });

    it('accepts the correct code, consumes the challenge, and marks the customer verified', async () => {
      const codeHash = await argon2.hash('654321');
      prisma.whatsAppOtpChallenge.findFirst.mockResolvedValue({
        id: 'challenge-1',
        customerId: 'customer-1',
        expiresAt: new Date(Date.now() + 60_000),
        attempts: 0,
        codeHash,
      });
      prisma.whatsAppOtpChallenge.update.mockResolvedValue({});

      const result = await service.verifyOtp('+2348031234567', '654321');

      expect(result).toBe(true);
      expect(prisma.whatsAppOtpChallenge.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'challenge-1' },
          data: expect.objectContaining({ consumedAt: expect.any(Date) }),
        }),
      );
      expect(prisma.customer.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'customer-1' },
          data: expect.objectContaining({
            whatsappVerifiedAt: expect.any(Date),
          }),
        }),
      );
    });

    it('rejects the wrong code and increments attempts, without consuming the challenge', async () => {
      const codeHash = await argon2.hash('654321');
      prisma.whatsAppOtpChallenge.findFirst.mockResolvedValue({
        id: 'challenge-1',
        customerId: 'customer-1',
        expiresAt: new Date(Date.now() + 60_000),
        attempts: 0,
        codeHash,
      });
      prisma.whatsAppOtpChallenge.update.mockResolvedValue({});

      const result = await service.verifyOtp('+2348031234567', '000000');

      expect(result).toBe(false);
      const updateCall = prisma.whatsAppOtpChallenge.update.mock.calls[0][0];
      expect(updateCall.data.consumedAt).toBeUndefined();
      expect(prisma.customer.updateMany).not.toHaveBeenCalled();
    });

    it('never logs the submitted code, correct or not', async () => {
      const codeHash = await argon2.hash('654321');
      prisma.whatsAppOtpChallenge.findFirst.mockResolvedValue({
        id: 'challenge-1',
        expiresAt: new Date(Date.now() + 60_000),
        attempts: 0,
        codeHash,
      });
      prisma.whatsAppOtpChallenge.update.mockResolvedValue({});

      await service.verifyOtp('+2348031234567', '000000');

      for (const call of auditService.record.mock.calls) {
        expect(JSON.stringify(call[0])).not.toContain('000000');
      }
    });
  });
});
