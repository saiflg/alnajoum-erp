import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { WORKFLOW_EVENT_PUBLISHED } from '../../workflows/events/workflow-event-bus.service';
import { classifySupport } from '../runtime/support-classifier';
import { AiRecommendationsService } from './recommendations.service';
import { OperationsScannerService } from './operations-scanner.service';

/**
 * Agents react to the domain events that exist on the Phase 21 bus (it reports honestly which ones do not exist
 * yet). Reactions are deterministic and idempotent: they refresh or resolve queue items and raise
 * recommendations; they never act on money or messages by themselves.
 */
@Injectable()
export class AgentEventReactor {
  private readonly logger = new Logger(AgentEventReactor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly recs: AiRecommendationsService,
    private readonly scanner: OperationsScannerService,
  ) {}

  @OnEvent(WORKFLOW_EVENT_PUBLISHED, { async: true })
  async onPublished(payload: { eventId: string }): Promise<void> {
    try {
      const ev = await this.prisma.workflowEvent.findUnique({
        where: { id: payload.eventId },
      });
      if (!ev?.companyId) return;
      await this.react(
        ev.type,
        ev.companyId,
        ev.entityId ?? undefined,
        (ev.payload ?? {}) as Record<string, unknown>,
      );
    } catch (err) {
      this.logger.warn(
        `Agent event reaction failed: ${(err as Error).message}`,
      );
    }
  }

  async react(
    type: string,
    companyId: string,
    entityId: string | undefined,
    payload: Record<string, unknown>,
  ) {
    switch (type) {
      case 'payment.succeeded': {
        // The money arrived: the open "payment pending / balance overdue" findings for it are resolved.
        const ids = [
          payload.invoiceId,
          payload.paymentIntentId,
          entityId,
        ].filter((x): x is string => typeof x === 'string');
        if (ids.length)
          await this.prisma.aiRecommendation.updateMany({
            where: {
              companyId,
              status: { in: ['OPEN', 'ACKNOWLEDGED'] },
              OR: ids.flatMap((i) => [
                { dedupeKey: `intent:${i}` },
                { dedupeKey: `balance:${i}` },
              ]),
            },
            data: { status: 'DONE', resolvedAt: new Date() },
          });
        break;
      }
      case 'visa.status_changed':
      case 'flight.ticket_issued':
      case 'hotel.booking_completed':
        // Re-derive the findings from the data; resolved ones simply stop being produced and are closed below.
        await this.refresh(companyId);
        break;
      case 'support_ticket.created': {
        const text = [payload.subject, payload.description]
          .filter((x) => typeof x === 'string')
          .join(' ');
        const c = classifySupport(text);
        if (c.escalation.escalate && entityId)
          await this.recs.upsert({
            companyId,
            agentKey: 'crm_agent',
            kind: 'SUPPORT_ESCALATION',
            dedupeKey: `ticket-escalate:${entityId}`,
            title: `${c.complaint ? 'Complaint' : 'Support ticket'} needs attention (${c.category.toLowerCase()})`,
            reason: `Route to ${c.team}. Reasons: ${c.escalation.reasons.join(', ')}. A complaint is never dismissed automatically.`,
            evidence: [
              {
                label: 'Why it was escalated',
                source: 'Support triage rules',
                value: c.escalation.reasons,
              },
            ],
            confidence: 'MEDIUM',
            suggestedAction: {
              type: 'ASSIGN_TEAM',
              team: c.team,
              ticketId: entityId,
            },
            factors: {
              customerImpact: 1,
              regulatoryImpact: c.escalation.reasons.some((r) =>
                r.includes('legal'),
              )
                ? 3
                : 0,
              dependency: 0,
              risk: c.escalation.reasons.some((r) => r.includes('financial'))
                ? 2
                : 1,
              hoursToDeadline: c.escalation.reasons.some((r) =>
                r.includes('imminent'),
              )
                ? 24
                : undefined,
            },
            subjectType: 'CUSTOMER',
            subjectId: entityId,
          });
        break;
      }
      case 'lead.created':
        if (entityId)
          await this.recs.upsert({
            companyId,
            agentKey: 'sales_agent',
            kind: 'NEW_LEAD',
            dedupeKey: `lead-new:${entityId}`,
            title: 'New lead: make first contact today',
            reason:
              'Leads contacted within a day convert far better; this one has no activity yet.',
            evidence: [
              {
                label: 'Lead created',
                source: 'CRM',
                value: new Date().toISOString(),
              },
            ],
            confidence: 'MEDIUM',
            suggestedAction: { type: 'CREATE_FOLLOW_UP', leadId: entityId },
            factors: {
              hoursToDeadline: 24,
              customerImpact: 1,
              regulatoryImpact: 0,
              dependency: 0,
              risk: 0,
            },
            subjectType: 'LEAD',
            subjectId: entityId,
          });
        break;
    }
  }

  private async refresh(companyId: string) {
    await this.scanner.scanCompany(companyId);
  }
}
