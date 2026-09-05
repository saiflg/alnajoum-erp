import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

export interface TimelineEvent {
  timestamp: Date;
  source: 'audit' | 'provider_message';
  action: string;
  detail: string | null;
  actorEmail: string | null;
  metadata: unknown;
}

/**
 * Spec #26 — a chronological application history built entirely from data
 * that already exists (AuditLog entries for the application itself plus
 * every entity genuinely part of its story — guarantor, documents,
 * submissions, refund — and VisaProviderMessage rows) rather than a new
 * event-log table. Each related entity's own id is discovered from the
 * application's current relations, not guessed from AuditLog.metadata
 * (several existing audit calls, e.g. 'guarantor.verified', don't carry an
 * applicationId in their metadata — this approach works regardless).
 */
@Injectable()
export class VisaTimelineService {
  constructor(private readonly prisma: PrismaService) {}

  async getTimeline(applicationId: string): Promise<TimelineEvent[]> {
    const application = await this.prisma.visaApplication.findUnique({
      where: { id: applicationId },
      include: {
        documents: { select: { id: true } },
        guarantor: { select: { id: true } },
        submissions: { select: { id: true } },
        refund: { select: { id: true } },
      },
    });
    if (!application) {
      throw new NotFoundException('Visa application not found');
    }

    const entityFilters: Prisma.AuditLogWhereInput[] = [
      { entityType: 'VisaApplication', entityId: applicationId },
    ];
    if (application.guarantor) {
      entityFilters.push({
        entityType: 'Guarantor',
        entityId: application.guarantor.id,
      });
    }
    for (const doc of application.documents) {
      entityFilters.push({ entityType: 'VisaDocument', entityId: doc.id });
    }
    for (const submission of application.submissions) {
      entityFilters.push({
        entityType: 'VisaSubmission',
        entityId: submission.id,
      });
    }
    if (application.refund) {
      entityFilters.push({
        entityType: 'VisaRefund',
        entityId: application.refund.id,
      });
    }

    const [logs, providerMessages] = await Promise.all([
      this.prisma.auditLog.findMany({
        where: { OR: entityFilters },
        include: { identity: { select: { email: true } } },
      }),
      this.prisma.visaProviderMessage.findMany({ where: { applicationId } }),
    ]);

    const auditEvents: TimelineEvent[] = logs.map((log) => ({
      timestamp: log.createdAt,
      source: 'audit',
      action: log.action,
      detail: null,
      actorEmail: log.identity?.email ?? null,
      metadata: log.metadata,
    }));

    const messageEvents: TimelineEvent[] = providerMessages.map((message) => ({
      timestamp: message.createdAt,
      source: 'provider_message',
      action: 'provider_message',
      detail: message.message,
      actorEmail: null,
      metadata: {
        severity: message.severity,
        acknowledgedByStaffId: message.acknowledgedByStaffId,
        acknowledgedAt: message.acknowledgedAt,
      },
    }));

    return [...auditEvents, ...messageEvents].sort(
      (a, b) => a.timestamp.getTime() - b.timestamp.getTime(),
    );
  }
}
