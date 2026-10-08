import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { ToolError } from '../tools/tool-support';
import { AiControlsService } from './controls.service';

/**
 * The company's rules for what an AI may send, to whom, when, and how often. Enforced in code at the point of
 * sending (never left to a prompt): permitted channel, the company's allowed hours in ITS timezone, a daily
 * message cap per customer, and prohibited content.
 */
@Injectable()
export class CommunicationPolicyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly controls: AiControlsService,
  ) {}

  async assertMayMessage(args: {
    companyId: string;
    customerIdentityId: string;
    channel: string;
    subject: string;
    body: string;
    agentKey: string;
    now?: Date;
  }): Promise<void> {
    const { commPolicy } = await this.controls.resolve(
      args.companyId,
      args.agentKey,
    );
    if (!commPolicy.channels.includes(args.channel))
      throw new ToolError(
        'FORBIDDEN',
        `Company policy does not allow the AI to send ${args.channel} messages`,
      );

    const company = await this.prisma.company.findUnique({
      where: { id: args.companyId },
      select: { timezone: true },
    });
    const hour =
      Number(
        new Intl.DateTimeFormat('en-GB', {
          hour: '2-digit',
          hour12: false,
          timeZone: company?.timezone ?? 'Africa/Lagos',
        }).format(args.now ?? new Date()),
      ) % 24;
    if (
      hour < commPolicy.allowedHours.start ||
      hour >= commPolicy.allowedHours.end
    )
      throw new ToolError(
        'FORBIDDEN',
        `Company policy only allows AI messages between ${commPolicy.allowedHours.start}:00 and ${commPolicy.allowedHours.end}:00 (company time)`,
      );

    const lower = `${args.subject} ${args.body}`.toLowerCase();
    const bad = commPolicy.prohibitedContent.find((p) =>
      lower.includes(p.toLowerCase()),
    );
    if (bad)
      throw new ToolError(
        'FORBIDDEN',
        'The message contains content the company policy prohibits',
      );

    const startOfDay = new Date(args.now ?? new Date());
    startOfDay.setUTCHours(0, 0, 0, 0);
    const sentToday = await this.prisma.notification.count({
      where: {
        identityId: args.customerIdentityId,
        relatedType: 'WORKFLOW_STEP',
        relatedId: { startsWith: 'ai:' },
        createdAt: { gte: startOfDay },
      },
    });
    if (sentToday >= commPolicy.maxMessagesPerCustomerPerDay)
      throw new ToolError(
        'FORBIDDEN',
        'This customer has already received the maximum number of AI messages today',
      );
  }
}
