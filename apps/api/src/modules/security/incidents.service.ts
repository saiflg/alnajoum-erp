import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { IncidentSeverity, IncidentStatus } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

export interface OpenIncidentInput {
  title: string;
  description: string;
  severity: IncidentSeverity;
  personalDataInvolved?: boolean;
}

/** Statuses an incident may move to from each status (no skipping straight to CLOSED, no re-opening a closed one). */
const NEXT: Record<IncidentStatus, IncidentStatus[]> = {
  OPEN: ['INVESTIGATING', 'CONTAINED', 'RESOLVED'],
  INVESTIGATING: ['CONTAINED', 'RESOLVED'],
  CONTAINED: ['INVESTIGATING', 'RESOLVED'],
  RESOLVED: ['CLOSED', 'INVESTIGATING'],
  CLOSED: [],
};

@Injectable()
export class IncidentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private scope(tenant?: string) {
    return tenant === undefined ? {} : { companyId: tenant };
  }

  async open(
    input: OpenIncidentInput,
    reporter: { identityId: string; companyId: string | null },
  ) {
    const incident = await this.prisma.securityIncident.create({
      data: {
        companyId: reporter.companyId ?? undefined,
        title: input.title,
        description: input.description,
        severity: input.severity,
        personalDataInvolved: input.personalDataInvolved ?? false,
        reportedByIdentityId: reporter.identityId,
        notes: {
          create: {
            authorIdentityId: reporter.identityId,
            body: 'Incident opened.',
            statusChange: 'OPEN',
          },
        },
      },
    });
    await this.audit.record({
      identityId: reporter.identityId,
      companyId: reporter.companyId ?? undefined,
      action: 'security.incident_opened',
      entityType: 'SecurityIncident',
      entityId: incident.id,
      metadata: {
        severity: input.severity,
        personalDataInvolved: input.personalDataInvolved ?? false,
      },
    });
    return incident;
  }

  list(tenant?: string, status?: IncidentStatus) {
    return this.prisma.securityIncident.findMany({
      where: { ...this.scope(tenant), ...(status && { status }) },
      orderBy: [{ status: 'asc' }, { detectedAt: 'desc' }],
      take: 200,
    });
  }

  async get(id: string, tenant?: string) {
    const incident = await this.prisma.securityIncident.findFirst({
      where: { id, ...this.scope(tenant) },
      include: { notes: { orderBy: { createdAt: 'asc' } } },
    });
    if (!incident) throw new NotFoundException('Incident not found');
    return incident;
  }

  async addNote(
    id: string,
    body: string,
    actor: { identityId: string },
    tenant?: string,
  ) {
    await this.get(id, tenant);
    return this.prisma.securityIncidentNote.create({
      data: { incidentId: id, authorIdentityId: actor.identityId, body },
    });
  }

  async changeStatus(
    id: string,
    to: IncidentStatus,
    note: string,
    actor: { identityId: string; companyId: string | null },
    tenant?: string,
  ) {
    const incident = await this.get(id, tenant);
    if (!NEXT[incident.status].includes(to)) {
      throw new ConflictException(
        `An incident that is ${incident.status} cannot move to ${to}`,
      );
    }
    // Atomic transition: two people changing the same incident cannot both apply a stale decision.
    const claim = await this.prisma.securityIncident.updateMany({
      where: { id, status: incident.status },
      data: {
        status: to,
        resolvedAt: to === 'RESOLVED' || to === 'CLOSED' ? new Date() : null,
      },
    });
    if (claim.count === 0)
      throw new ConflictException(
        'The incident was changed by someone else; reload and try again',
      );
    await this.prisma.securityIncidentNote.create({
      data: {
        incidentId: id,
        authorIdentityId: actor.identityId,
        body: note,
        statusChange: to,
      },
    });
    await this.audit.record({
      identityId: actor.identityId,
      companyId: incident.companyId ?? undefined,
      action: 'security.incident_status_changed',
      entityType: 'SecurityIncident',
      entityId: id,
      metadata: { from: incident.status, to },
    });
    return this.get(id, tenant);
  }
}
