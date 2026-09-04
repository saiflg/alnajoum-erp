import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import nodemailer from 'nodemailer';
import { IntegrationsService } from '../../integrations/integrations.service';
import { SmtpNotificationProviderService } from './smtp-notification-provider.service';

jest.mock('nodemailer');

describe('SmtpNotificationProviderService', () => {
  let service: SmtpNotificationProviderService;
  let integrationsService: { getCredentialConfig: jest.Mock };
  let configService: { get: jest.Mock };
  let sendMailMock: jest.Mock;

  beforeEach(async () => {
    sendMailMock = jest.fn().mockResolvedValue({});
    (nodemailer.createTransport as jest.Mock) = jest
      .fn()
      .mockReturnValue({ sendMail: sendMailMock });

    integrationsService = {
      getCredentialConfig: jest.fn().mockResolvedValue(null),
    };
    configService = {
      get: jest.fn((_key: string, fallback?: unknown) => fallback),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SmtpNotificationProviderService,
        { provide: ConfigService, useValue: configService },
        { provide: IntegrationsService, useValue: integrationsService },
      ],
    }).compile();

    service = module.get(SmtpNotificationProviderService);
  });

  it('reports not-configured when neither the DB nor env vars have a host', async () => {
    const result = await service.sendEmail({
      to: 'amina@example.com',
      subject: 'Test',
      textBody: 'Body',
    });

    expect(result).toEqual({
      success: false,
      error: expect.stringContaining('SMTP is not configured'),
    });
    expect(nodemailer.createTransport).not.toHaveBeenCalled();
  });

  it('prefers credentials saved at /admin/integrations over env vars', async () => {
    integrationsService.getCredentialConfig.mockResolvedValue({
      host: 'smtp.db.example.com',
      port: '2525',
      user: 'db-user',
      password: 'db-pass',
      from: 'DB Sender <db@example.com>',
      secure: 'false',
    });
    configService.get.mockImplementation((key: string, fallback?: unknown) => {
      if (key === 'SMTP_HOST') return 'smtp.env.example.com';
      return fallback;
    });

    await service.sendEmail({
      to: 'amina@example.com',
      subject: 'Test',
      textBody: 'Body',
    });

    expect(nodemailer.createTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        host: 'smtp.db.example.com',
        port: 2525,
        auth: { user: 'db-user', pass: 'db-pass' },
      }),
    );
    expect(sendMailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'DB Sender <db@example.com>',
        to: 'amina@example.com',
      }),
    );
  });

  it('falls back to env vars when nothing is saved in the DB', async () => {
    configService.get.mockImplementation((key: string, fallback?: unknown) => {
      const values: Record<string, unknown> = {
        SMTP_HOST: 'smtp.env.example.com',
        SMTP_PORT: 587,
        SMTP_USER: 'env-user',
        SMTP_PASSWORD: 'env-pass',
      };
      return values[key] ?? fallback;
    });

    await service.sendEmail({
      to: 'amina@example.com',
      subject: 'Test',
      textBody: 'Body',
    });

    expect(nodemailer.createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ host: 'smtp.env.example.com' }),
    );
  });

  it('reports the transport error instead of throwing when sendMail rejects', async () => {
    integrationsService.getCredentialConfig.mockResolvedValue({
      host: 'smtp.db.example.com',
    });
    sendMailMock.mockRejectedValue(new Error('Connection refused'));

    const result = await service.sendEmail({
      to: 'amina@example.com',
      subject: 'Test',
      textBody: 'Body',
    });

    expect(result).toEqual({ success: false, error: 'Connection refused' });
  });

  describe('sendSms / sendWhatsApp', () => {
    it('honestly reports not configured rather than pretending to send', async () => {
      await expect(
        service.sendSms({ to: '+2348000000000', body: 'hi' }),
      ).resolves.toEqual({
        success: false,
        error: expect.stringContaining('not configured'),
      });
      await expect(
        service.sendWhatsApp({ to: '+2348000000000', body: 'hi' }),
      ).resolves.toEqual({
        success: false,
        error: expect.stringContaining('not configured'),
      });
    });
  });
});
