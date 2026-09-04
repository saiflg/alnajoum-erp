import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  TicketMessageAuthorType,
  TicketPriority,
  TicketStatus,
} from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SupportConfigService } from './support-config.service';
import { SupportTicketsService } from './support-tickets.service';

describe('SupportTicketsService', () => {
  let service: SupportTicketsService;
  let prisma: Record<string, any>;
  let notificationsService: { sendGeneric: jest.Mock };
  let configService: { responseMinutesFor: jest.Mock };

  const openTicket = {
    id: 'ticket-1',
    ticketNumber: 'TKT-ABC123',
    customerId: 'customer-1',
    status: TicketStatus.OPEN,
    firstRespondedAt: null,
    priority: TicketPriority.HIGH,
  };

  beforeEach(async () => {
    prisma = {
      supportTicket: {
        create: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
      },
      supportTicketMessage: { create: jest.fn() },
      customerTimelineEvent: { create: jest.fn() },
      customer: { findUnique: jest.fn() },
    };
    notificationsService = { sendGeneric: jest.fn() };
    configService = { responseMinutesFor: jest.fn().mockResolvedValue(240) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SupportTicketsService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: { record: jest.fn() } },
        { provide: NotificationsService, useValue: notificationsService },
        { provide: SupportConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get(SupportTicketsService);
  });

  describe('create (spec #13 — SLA calculation)', () => {
    it('sets slaResponseDueAt from the configured response minutes for the ticket priority', async () => {
      const before = Date.now();
      prisma.supportTicket.create.mockImplementation(({ data }: any) =>
        Promise.resolve({ id: 'ticket-1', ...data }),
      );

      const ticket = await service.create('customer-1', {
        subject: 'Refund question',
        categoryId: 'cat-1',
        priority: TicketPriority.HIGH,
        description: 'Where is my refund?',
      });

      expect(configService.responseMinutesFor).toHaveBeenCalledWith(
        TicketPriority.HIGH,
      );
      expect(ticket.slaResponseDueAt).not.toBeNull();
      const dueAt = new Date(ticket.slaResponseDueAt!).getTime();
      expect(dueAt).toBeGreaterThanOrEqual(before + 239 * 60_000);
      expect(dueAt).toBeLessThanOrEqual(before + 241 * 60_000);
    });

    it('seeds the message thread with the customer description as the first message', async () => {
      prisma.supportTicket.create.mockResolvedValue({ id: 'ticket-1' });

      await service.create('customer-1', {
        subject: 'Refund question',
        categoryId: 'cat-1',
        description: 'Where is my refund?',
      });

      expect(prisma.supportTicket.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            messages: {
              create: expect.objectContaining({
                authorType: 'CUSTOMER',
                message: 'Where is my refund?',
              }),
            },
          }),
        }),
      );
    });
  });

  describe('addMessage (spec #12 — separating customer messages from internal notes)', () => {
    it('records the first non-internal staff reply as firstRespondedAt and flips status to WAITING_FOR_CUSTOMER', async () => {
      prisma.supportTicket.findUnique.mockResolvedValue({
        ...openTicket,
        messages: [],
        category: {},
      });
      prisma.supportTicketMessage.create.mockResolvedValue({
        id: 'msg-1',
        isInternal: false,
      });
      prisma.customer.findUnique.mockResolvedValue({
        id: 'customer-1',
        identity: { email: 'chinedu@example.com', id: 'identity-1' },
      });

      await service.addMessage(
        'ticket-1',
        'We are looking into it.',
        TicketMessageAuthorType.STAFF,
        'staff-1',
        false,
      );

      expect(prisma.supportTicket.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            firstRespondedAt: expect.any(Date),
            status: TicketStatus.WAITING_FOR_CUSTOMER,
          }),
        }),
      );
      expect(notificationsService.sendGeneric).toHaveBeenCalled();
    });

    it('an internal note never sets firstRespondedAt and never notifies the customer', async () => {
      prisma.supportTicket.findUnique.mockResolvedValue({
        ...openTicket,
        messages: [],
        category: {},
      });
      prisma.supportTicketMessage.create.mockResolvedValue({
        id: 'msg-1',
        isInternal: true,
      });

      await service.addMessage(
        'ticket-1',
        'Checking with finance internally.',
        TicketMessageAuthorType.STAFF,
        'staff-1',
        true,
      );

      expect(prisma.supportTicket.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ firstRespondedAt: undefined }),
        }),
      );
      expect(notificationsService.sendGeneric).not.toHaveBeenCalled();
    });

    it('refuses to add any message to a closed ticket', async () => {
      prisma.supportTicket.findUnique.mockResolvedValue({
        ...openTicket,
        status: TicketStatus.CLOSED,
        messages: [],
        category: {},
      });

      await expect(
        service.addMessage(
          'ticket-1',
          'hello',
          TicketMessageAuthorType.CUSTOMER,
        ),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('getForCustomer (customer data isolation + internal-note filtering)', () => {
    it('strips internal messages from what a customer can see', async () => {
      prisma.supportTicket.findUnique.mockResolvedValue({
        ...openTicket,
        category: {},
        assignedStaff: null,
        messages: [
          { id: 'm1', isInternal: false, message: 'Customer message' },
          { id: 'm2', isInternal: true, message: 'Internal-only note' },
          { id: 'm3', isInternal: false, message: 'Staff reply' },
        ],
      });

      const result = await service.getForCustomer('ticket-1', 'customer-1');

      expect(result.messages).toHaveLength(2);
      expect(result.messages.some((m) => m.isInternal)).toBe(false);
    });

    it('throws NotFound-shaped rejection when the ticket belongs to a different customer', async () => {
      prisma.supportTicket.findUnique.mockResolvedValue({
        ...openTicket,
        customerId: 'someone-else',
        messages: [],
        category: {},
      });

      await expect(
        service.getForCustomer('ticket-1', 'customer-1'),
      ).rejects.toThrow();
    });
  });
});
