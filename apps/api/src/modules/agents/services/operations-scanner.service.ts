import { Injectable, Logger } from '@nestjs/common';
import { PilgrimType } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { ReadinessService } from '../../hajj-ops/readiness.service';
import { SecurityOverviewService } from '../../security/security-overview.service';
import { VisaChecklistService } from '../../visa/visa-checklist.service';
import { PriorityFactors } from '../runtime/priority';
import {
  AiRecommendationsService,
  RecommendationInput,
} from './recommendations.service';

export interface ScanReport {
  company: string;
  scanner: string;
  found: number;
  created: number;
}

const HOURS = 3600_000;
const hoursUntil = (d?: Date | null): number | undefined =>
  d ? Math.round((d.getTime() - Date.now()) / HOURS) : undefined;

/**
 * Detection is deterministic: plain rules over real records, each producing a recommendation with its evidence
 * and a transparent priority. A model may later EXPLAIN a finding, but it never decides whether one exists, so
 * the exception queue contains no invented problems and every finding can be re-derived from the data.
 * Every finding has a stable dedupeKey, so running a scan twice (or every morning) never duplicates work.
 */
@Injectable()
export class OperationsScannerService {
  private readonly logger = new Logger(OperationsScannerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly recs: AiRecommendationsService,
    private readonly readiness: ReadinessService,
    private readonly visaChecklist: VisaChecklistService,
    private readonly securityOverview: SecurityOverviewService,
  ) {}

  async scanCompany(companyId: string): Promise<ScanReport[]> {
    const scanners: [string, (c: string) => Promise<RecommendationInput[]>][] =
      [
        ['visa', (c) => this.visa(c)],
        ['pilgrims', (c) => this.pilgrims(c)],
        ['crm', (c) => this.crm(c)],
        ['finance', (c) => this.finance(c)],
        ['supplier', (c) => this.supplier(c)],
        ['security', (c) => this.security(c)],
        ['operations', (c) => this.operations(c)],
      ];
    const reports: ScanReport[] = [];
    for (const [name, fn] of scanners) {
      let found = 0;
      let created = 0;
      try {
        const items = await fn(companyId);
        found = items.length;
        for (const item of items) {
          const r = await this.recs.upsert(item);
          if (r.created) created++;
        }
      } catch (err) {
        this.logger.error(
          `Scanner ${name} failed for ${companyId}: ${(err as Error).message}`,
        );
      }
      reports.push({ company: companyId, scanner: name, found, created });
    }
    return reports;
  }

  // ------------------------------------------------------------------------------------ visa
  async visa(companyId: string): Promise<RecommendationInput[]> {
    const out: RecommendationInput[] = [];
    const apps = await this.prisma.visaApplication.findMany({
      where: {
        customer: { companyId },
        status: { notIn: ['APPROVED', 'ISSUED', 'REJECTED', 'CANCELLED'] },
      },
      select: {
        id: true,
        applicationReference: true,
        status: true,
        destinationCountry: true,
        intendedTravelDate: true,
        updatedAt: true,
        customerId: true,
        customer: { select: { assignedBranchId: true } },
      },
      take: 200,
      orderBy: { updatedAt: 'asc' },
    });
    for (const a of apps) {
      const h = hoursUntil(a.intendedTravelDate);
      let missing: string[] = [];
      try {
        const cl = await this.visaChecklist.computeChecklist(a.id);
        missing = cl.items
          .filter(
            (i) =>
              i.required &&
              (i.state === 'MISSING' ||
                i.state === 'REJECTED' ||
                i.state === 'EXPIRED'),
          )
          .map((i) => `${i.documentType} (${i.state})`);
      } catch {
        /* no rule configured: nothing to check against */
      }
      if (missing.length)
        out.push({
          companyId,
          branchId: a.customer.assignedBranchId,
          agentKey: 'visa_ops',
          kind: 'VISA_DOCUMENT_MISSING',
          dedupeKey: `visa-docs:${a.id}`,
          title: `Visa ${a.applicationReference}: ${missing.length} document(s) missing`,
          reason: `The ${a.destinationCountry} visa application cannot move forward until the required documents are complete.`,
          evidence: [
            {
              label: 'Missing or rejected on the checklist',
              source: 'Visa document checklist',
              value: missing,
            },
            {
              label: 'Application status',
              source: 'ERP visa application',
              value: a.status,
            },
          ],
          confidence: 'HIGH',
          suggestedAction: { type: 'REQUEST_DOCUMENTS', applicationId: a.id },
          factors: {
            hoursToDeadline: h,
            customerImpact: 1,
            regulatoryImpact: 2,
            dependency: 0,
            risk: 1,
          },
          subjectType: 'VISA',
          subjectId: a.id,
          dueAt: a.intendedTravelDate,
        });
      const idleDays = (Date.now() - a.updatedAt.getTime()) / (24 * HOURS);
      if (a.status === 'IN_REVIEW' && idleDays > 7)
        out.push({
          companyId,
          branchId: a.customer.assignedBranchId,
          agentKey: 'visa_ops',
          kind: 'VISA_DELAYED',
          dedupeKey: `visa-stalled:${a.id}`,
          title: `Visa ${a.applicationReference} has not moved for ${Math.floor(idleDays)} days`,
          reason: 'The application has been in review with no update.',
          evidence: [
            {
              label: 'Days without an update',
              source: 'ERP visa application',
              value: Math.floor(idleDays),
            },
          ],
          confidence: 'MEDIUM',
          suggestedAction: { type: 'FOLLOW_UP_REVIEW', applicationId: a.id },
          factors: {
            hoursToDeadline: h,
            customerImpact: 1,
            regulatoryImpact: 1,
            dependency: 0,
            risk: 1,
          },
          subjectType: 'VISA',
          subjectId: a.id,
          dueAt: a.intendedTravelDate,
        });
    }
    return out;
  }

  // ------------------------------------------------------------------------------------ Hajj / Umrah
  /**
   * Readiness is the EXISTING live computation (ReadinessService). The score here only summarises it and always
   * shows how it was reached: each component is reported, and the percentage is their plain average.
   */
  async pilgrims(companyId: string): Promise<RecommendationInput[]> {
    const out: RecommendationInput[] = [];
    for (const type of ['HAJJ', 'UMRAH'] as const) {
      const groups = await (type === 'HAJJ'
        ? this.prisma.hajjGroup.findMany({
            where: { companyId, departureDate: { gte: new Date() } },
            include: { pilgrims: { select: { id: true } } },
            take: 50,
          })
        : this.prisma.umrahGroup.findMany({
            where: { companyId, departureDate: { gte: new Date() } },
            include: { pilgrims: { select: { id: true } } },
            take: 50,
          }));
      for (const g of groups) {
        const rows = await Promise.all(
          g.pilgrims
            .slice(0, 200)
            .map((p) => this.readiness.compute(type as PilgrimType, p.id)),
        );
        if (!rows.length) continue;
        const n = rows.length;
        const comp = {
          Documents: rows.filter((r) => r.documentsComplete).length,
          Visa: rows.filter((r) => r.visaStatus === 'APPROVED').length,
          Payment: rows.filter((r) => r.paymentComplete).length,
          Flight: rows.filter((r) => r.flightAssigned).length,
          Hotel: rows.filter((r) => r.hotelAssigned).length,
        };
        const pct = (x: number) => Math.round((x / n) * 100);
        const overall = Math.round(
          Object.values(comp).reduce((a, b) => a + pct(b), 0) /
            Object.keys(comp).length,
        );
        const problems = [
          n - comp.Documents &&
            `${n - comp.Documents} pilgrim(s) have incomplete documents`,
          n - comp.Visa &&
            `${n - comp.Visa} pilgrim(s) without an approved visa`,
          n - comp.Payment &&
            `${n - comp.Payment} pilgrim(s) with an unpaid balance`,
          n - comp.Flight && `${n - comp.Flight} pilgrim(s) not on a flight`,
          n - comp.Hotel && `${n - comp.Hotel} pilgrim(s) without a hotel`,
        ].filter(Boolean) as string[];
        if (!problems.length) continue;
        const h = hoursUntil(g.departureDate);
        out.push({
          companyId,
          agentKey: type === 'HAJJ' ? 'hajj_ops' : 'umrah_ops',
          kind: 'GROUP_NOT_READY',
          dedupeKey: `group:${type}:${g.id}`,
          title: `${type === 'HAJJ' ? 'Hajj' : 'Umrah'} group departing ${g.departureDate?.toISOString().slice(0, 10)} is ${overall}% ready`,
          reason: `Readiness is the plain average of: ${Object.entries(comp)
            .map(([k, v]) => `${k} ${pct(v)}%`)
            .join(', ')}. ${problems.join('; ')}.`,
          evidence: [
            {
              label: 'Components (pilgrims ready / total)',
              source: 'Hajj/Umrah readiness (live)',
              value: Object.fromEntries(
                Object.entries(comp).map(([k, v]) => [k, `${v}/${n}`]),
              ),
            },
            {
              label: 'Overall readiness',
              source: 'Average of the components',
              value: `${overall}%`,
            },
          ],
          confidence: 'HIGH',
          suggestedAction: {
            type: 'REVIEW_GROUP',
            groupType: type,
            groupId: g.id,
          },
          factors: {
            hoursToDeadline: h,
            customerImpact: n > 10 ? 3 : n > 3 ? 2 : 1,
            regulatoryImpact: comp.Visa < n ? 3 : 1,
            dependency: 2,
            risk: 2,
          },
          subjectType: 'GROUP',
          subjectId: g.id,
          dueAt: g.departureDate,
        });
      }
    }
    return out;
  }

  // ------------------------------------------------------------------------------------ CRM
  async crm(companyId: string): Promise<RecommendationInput[]> {
    const out: RecommendationInput[] = [];
    const leads = await this.prisma.lead.findMany({
      where: {
        status: 'OPEN',
        updatedAt: { lt: new Date(Date.now() - 3 * 24 * HOURS) },
        OR: [
          { assignedStaff: { companyId } },
          { createdByStaff: { companyId } },
          { assignedBranch: { companyId } },
        ],
      },
      select: {
        id: true,
        leadNumber: true,
        name: true,
        updatedAt: true,
        assignedBranchId: true,
        budget: true,
      },
      take: 100,
      orderBy: { updatedAt: 'asc' },
    });
    for (const l of leads)
      out.push({
        companyId,
        branchId: l.assignedBranchId,
        agentKey: 'crm_agent',
        kind: 'LEAD_FOLLOW_UP',
        dedupeKey: `lead-quiet:${l.id}`,
        title: `Follow up lead ${l.leadNumber} (${l.name})`,
        reason: `No activity for ${Math.floor((Date.now() - l.updatedAt.getTime()) / (24 * HOURS))} days.`,
        evidence: [
          {
            label: 'Last activity',
            source: 'CRM lead',
            value: l.updatedAt.toISOString().slice(0, 10),
          },
        ],
        confidence: 'HIGH',
        suggestedAction: { type: 'CREATE_FOLLOW_UP', leadId: l.id },
        factors: {
          customerImpact: 1,
          regulatoryImpact: 0,
          dependency: 0,
          risk: 0,
          financialImpact: l.budget ?? undefined,
        },
        subjectType: 'LEAD',
        subjectId: l.id,
      });

    const unpaid = await this.prisma.invoice.findMany({
      where: {
        customer: { companyId },
        status: { in: ['ISSUED', 'PARTIALLY_PAID'] },
        createdAt: { lt: new Date(Date.now() - 7 * 24 * HOURS) },
        OR: [
          { umrahRegistrationId: { not: null } },
          { hajjRegistrationId: { not: null } },
          { flightBookingId: { not: null } },
        ],
      },
      select: {
        id: true,
        invoiceNumber: true,
        currency: true,
        totalAmount: true,
        customerId: true,
        hajjRegistrationId: true,
        umrahRegistrationId: true,
        customer: { select: { assignedBranchId: true } },
        payments: { select: { amount: true } },
      },
      take: 100,
      orderBy: { createdAt: 'asc' },
    });
    for (const i of unpaid) {
      const owed = i.totalAmount - i.payments.reduce((s, p) => s + p.amount, 0);
      if (owed <= 0) continue;
      out.push({
        companyId,
        branchId: i.customer?.assignedBranchId,
        agentKey: 'crm_agent',
        kind: 'BALANCE_OVERDUE',
        dedupeKey: `balance:${i.id}`,
        title: `Invoice ${i.invoiceNumber} still has ${owed.toLocaleString('en-US')} ${i.currency} unpaid`,
        reason: 'The invoice has been open for more than 7 days.',
        evidence: [
          {
            label: 'Outstanding',
            source: 'Finance ledger',
            value: `${owed} ${i.currency}`,
          },
        ],
        confidence: 'HIGH',
        suggestedAction: { type: 'SEND_PAYMENT_REMINDER', invoiceId: i.id },
        factors: {
          customerImpact: 1,
          regulatoryImpact: 0,
          dependency: 0,
          risk: 1,
          financialImpact: owed,
        },
        subjectType: i.umrahRegistrationId
          ? 'UMRAH'
          : i.hajjRegistrationId
            ? 'HAJJ'
            : 'PAYMENT',
        subjectId: i.id,
      });
    }

    const soon = new Date(Date.now() + 183 * 24 * HOURS);
    const passports = await this.prisma.customer.findMany({
      where: {
        companyId,
        passportExpiryDate: { not: null, lte: soon, gte: new Date() },
        OR: [
          {
            flightBookings: {
              some: {
                status: { in: ['PENDING', 'CONFIRMED', 'TICKETED'] },
                departureAt: { gte: new Date() },
              },
            },
          },
          { umrahRegistrations: { some: {} } },
          { hajjRegistrations: { some: {} } },
          { visaApplications: { some: {} } },
        ],
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        passportExpiryDate: true,
        assignedBranchId: true,
      },
      take: 100,
    });
    for (const c of passports)
      out.push({
        companyId,
        branchId: c.assignedBranchId,
        agentKey: 'crm_agent',
        kind: 'PASSPORT_EXPIRING',
        dedupeKey: `passport:${c.id}`,
        title: `${c.firstName} ${c.lastName}'s passport expires ${c.passportExpiryDate!.toISOString().slice(0, 10)}`,
        reason:
          'Most destinations require six months of passport validity at travel.',
        evidence: [
          {
            label: 'Passport expiry',
            source: 'ERP customer record',
            value: c.passportExpiryDate!.toISOString().slice(0, 10),
          },
        ],
        confidence: 'HIGH',
        suggestedAction: { type: 'REQUEST_NEW_PASSPORT', customerId: c.id },
        factors: {
          hoursToDeadline: hoursUntil(c.passportExpiryDate),
          customerImpact: 1,
          regulatoryImpact: 2,
          dependency: 0,
          risk: 1,
        },
        subjectType: 'CUSTOMER',
        subjectId: c.id,
        dueAt: c.passportExpiryDate,
      });

    const tickets = await this.prisma.supportTicket.findMany({
      where: {
        customer: { companyId },
        status: {
          in: ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'WAITING_FOR_STAFF'],
        },
        createdAt: { lt: new Date(Date.now() - 2 * 24 * HOURS) },
      },
      select: {
        id: true,
        ticketNumber: true,
        subject: true,
        priority: true,
        branchId: true,
        createdAt: true,
      },
      take: 50,
      orderBy: { createdAt: 'asc' },
    });
    for (const t of tickets)
      out.push({
        companyId,
        branchId: t.branchId,
        agentKey: 'crm_agent',
        kind: 'TICKET_UNRESOLVED',
        dedupeKey: `ticket:${t.id}`,
        title: `Support ticket ${t.ticketNumber} unresolved for ${Math.floor((Date.now() - t.createdAt.getTime()) / (24 * HOURS))} days`,
        reason: t.subject,
        evidence: [
          { label: 'Priority', source: 'Support desk', value: t.priority },
        ],
        confidence: 'HIGH',
        suggestedAction: { type: 'ESCALATE_TICKET', ticketId: t.id },
        factors: {
          customerImpact: 1,
          regulatoryImpact: 0,
          dependency: 0,
          risk: t.priority === 'CRITICAL' || t.priority === 'HIGH' ? 2 : 1,
        },
        subjectType: 'CUSTOMER',
        subjectId: t.id,
      });
    return out;
  }

  // ------------------------------------------------------------------------------------ finance (careful wording)
  async finance(companyId: string): Promise<RecommendationInput[]> {
    const out: RecommendationInput[] = [];
    const stale = await this.prisma.paymentIntent.findMany({
      where: {
        customer: { companyId },
        status: 'PENDING',
        createdAt: {
          lt: new Date(Date.now() - 30 * 60_000),
          gt: new Date(Date.now() - 7 * 24 * HOURS),
        },
      },
      select: {
        id: true,
        reference: true,
        amount: true,
        currency: true,
        provider: true,
        createdAt: true,
        customer: { select: { assignedBranchId: true } },
      },
      take: 100,
    });
    for (const i of stale)
      out.push({
        companyId,
        branchId: i.customer.assignedBranchId,
        agentKey: 'finance_assistant',
        kind: 'PAYMENT_PENDING_TOO_LONG',
        dedupeKey: `intent:${i.id}`,
        title: `Online payment ${i.reference} is still pending`,
        reason:
          'The provider has not reported a result yet. This may be a delayed webhook, or the customer may not have completed it. Verify with the provider before treating it as paid or failed.',
        evidence: [
          {
            label: 'Amount',
            source: 'Payment intent',
            value: `${i.amount} ${i.currency}`,
          },
          { label: 'Provider', source: 'Payment intent', value: i.provider },
        ],
        confidence: 'MEDIUM',
        suggestedAction: { type: 'INVESTIGATE', intentId: i.id },
        factors: {
          customerImpact: 1,
          regulatoryImpact: 0,
          dependency: 0,
          risk: 2,
          financialImpact: i.amount,
        },
        subjectType: 'PAYMENT',
        subjectId: i.id,
      });
    const manual = await this.prisma.manualPaymentSubmission.findMany({
      where: {
        status: 'PENDING_VERIFICATION',
        customer: { companyId },
        createdAt: { lt: new Date(Date.now() - 24 * HOURS) },
      },
      select: {
        id: true,
        amount: true,
        method: true,
        createdAt: true,
        invoice: { select: { invoiceNumber: true, currency: true } },
      },
      take: 50,
    });
    for (const m of manual)
      out.push({
        companyId,
        agentKey: 'finance_assistant',
        kind: 'MANUAL_PAYMENT_WAITING',
        dedupeKey: `manual:${m.id}`,
        title: `Manual payment for ${m.invoice.invoiceNumber} has waited over a day for verification`,
        reason: 'A person must verify the receipt against the bank.',
        evidence: [
          {
            label: 'Amount',
            source: 'Manual payment submission',
            value: `${m.amount} ${m.invoice.currency}`,
          },
          {
            label: 'Method',
            source: 'Manual payment submission',
            value: m.method,
          },
        ],
        confidence: 'HIGH',
        suggestedAction: { type: 'REVIEW_MANUAL_PAYMENT', submissionId: m.id },
        factors: {
          customerImpact: 1,
          regulatoryImpact: 0,
          dependency: 0,
          risk: 1,
          financialImpact: m.amount,
        },
        subjectType: 'PAYMENT',
        subjectId: m.id,
      });
    const lines = await this.prisma.bankStatementLine.findMany({
      where: {
        status: 'UNMATCHED',
        importedByStaff: { companyId },
        createdAt: { lt: new Date(Date.now() - 24 * HOURS) },
      },
      select: {
        id: true,
        description: true,
        amount: true,
        currency: true,
        date: true,
      },
      take: 50,
    });
    for (const l of lines)
      out.push({
        companyId,
        agentKey: 'finance_assistant',
        kind: 'UNMATCHED_BANK_LINE',
        dedupeKey: `bankline:${l.id}`,
        title: `Unmatched bank line ${l.amount} ${l.currency} on ${l.date.toISOString().slice(0, 10)}`,
        reason:
          'No payment or expense has been matched to this statement line. Recommended: match, reject or investigate; finance decides.',
        evidence: [
          {
            label: 'Description',
            source: 'Bank statement',
            value: l.description,
          },
        ],
        confidence: 'MEDIUM',
        suggestedAction: { type: 'MATCH_OR_INVESTIGATE', lineId: l.id },
        factors: {
          customerImpact: 0,
          regulatoryImpact: 0,
          dependency: 0,
          risk: 1,
          financialImpact: Math.abs(l.amount),
        },
        subjectType: 'PAYMENT',
        subjectId: l.id,
      });
    // Duplicate payments: the same amount on the same invoice within ten minutes.
    const recent = await this.prisma.payment.findMany({
      where: {
        invoice: { customer: { companyId } },
        createdAt: { gt: new Date(Date.now() - 14 * 24 * HOURS) },
      },
      select: {
        id: true,
        invoiceId: true,
        amount: true,
        paidAt: true,
        paymentReference: true,
        invoice: { select: { invoiceNumber: true, currency: true } },
      },
      orderBy: { paidAt: 'asc' },
      take: 1000,
    });
    const byInvoice = new Map<string, typeof recent>();
    for (const p of recent)
      byInvoice.set(p.invoiceId, [...(byInvoice.get(p.invoiceId) ?? []), p]);
    for (const [invoiceId, list] of byInvoice)
      for (let i = 1; i < list.length; i++)
        if (
          list[i].amount === list[i - 1].amount &&
          list[i].paidAt.getTime() - list[i - 1].paidAt.getTime() < 10 * 60_000
        )
          out.push({
            companyId,
            agentKey: 'finance_assistant',
            kind: 'POSSIBLE_DUPLICATE_PAYMENT',
            dedupeKey: `dup:${list[i - 1].id}:${list[i].id}`,
            title: `Potential anomaly: two equal payments on ${list[i].invoice.invoiceNumber} minutes apart`,
            reason:
              'Two payments of the same amount were recorded on one invoice within ten minutes. This may be legitimate (an instalment) or a duplicate; it needs a person to confirm.',
            evidence: [
              {
                label: 'Payments',
                source: 'Finance ledger',
                value: [list[i - 1].paymentReference, list[i].paymentReference],
              },
              {
                label: 'Amount each',
                source: 'Finance ledger',
                value: `${list[i].amount} ${list[i].invoice.currency}`,
              },
            ],
            confidence: 'MEDIUM',
            suggestedAction: { type: 'INVESTIGATE', invoiceId },
            factors: {
              customerImpact: 1,
              regulatoryImpact: 0,
              dependency: 0,
              risk: 2,
              financialImpact: list[i].amount,
            },
            subjectType: 'PAYMENT',
            subjectId: invoiceId,
          });
    return out;
  }

  // ------------------------------------------------------------------------------------ supplier
  async supplier(companyId: string): Promise<RecommendationInput[]> {
    const out: RecommendationInput[] = [];
    const soon = new Date(Date.now() + 45 * 24 * HOURS);
    const contracts = await this.prisma.flightSupplierContract.findMany({
      where: {
        supplier: { companyId },
        endDate: { lte: soon, gte: new Date() },
      },
      select: { id: true, endDate: true, supplier: { select: { name: true } } },
      take: 50,
    });
    for (const c of contracts)
      out.push({
        companyId,
        agentKey: 'supplier_agent',
        kind: 'CONTRACT_EXPIRING',
        dedupeKey: `contract:${c.id}`,
        title: `Contract with ${c.supplier.name} ends ${c.endDate!.toISOString().slice(0, 10)}`,
        reason:
          'Renew or replace the contract before it lapses to avoid interrupted supply.',
        evidence: [
          {
            label: 'End date',
            source: 'Supplier contract',
            value: c.endDate!.toISOString().slice(0, 10),
          },
        ],
        confidence: 'HIGH',
        suggestedAction: { type: 'REVIEW_CONTRACT', contractId: c.id },
        factors: {
          hoursToDeadline: hoursUntil(c.endDate),
          customerImpact: 1,
          regulatoryImpact: 0,
          dependency: 1,
          risk: 1,
        },
        subjectType: 'SUPPLIER',
        subjectId: c.id,
        dueAt: c.endDate,
      });
    const failures = await this.prisma.providerTransactionLog
      .count({
        where: {
          status: 'FAILURE',
          createdAt: { gte: new Date(Date.now() - 24 * HOURS) },
        },
      })
      .catch(() => 0);
    if (failures >= 5)
      out.push({
        companyId,
        agentKey: 'supplier_agent',
        kind: 'PROVIDER_FAILURES',
        dedupeKey: `provider-failures:${new Date().toISOString().slice(0, 10)}`,
        title: `${failures} provider call failures in the last 24 hours`,
        reason:
          'A burst of failed provider calls can mean an outage or a credentials problem.',
        evidence: [
          {
            label: 'Failed calls (24h)',
            source: 'Provider transaction log',
            value: failures,
          },
        ],
        confidence: 'MEDIUM',
        suggestedAction: { type: 'CHECK_PROVIDER' },
        factors: {
          customerImpact: 2,
          regulatoryImpact: 0,
          dependency: 2,
          risk: 2,
        },
        subjectType: 'SUPPLIER',
      });
    return out;
  }

  // ------------------------------------------------------------------------------------ security
  async security(companyId: string): Promise<RecommendationInput[]> {
    const out: RecommendationInput[] = [];
    const o = await this.securityOverview.overview(companyId);
    const get = (action: string) => o.events.find((e) => e.action === action);
    const failed = get('security.login_failed')?.last24h ?? 0;
    const day = new Date().toISOString().slice(0, 10);
    if (failed >= 20)
      out.push({
        companyId,
        agentKey: 'security_agent',
        kind: 'LOGIN_FAILURE_SPIKE',
        dedupeKey: `login-spike:${day}`,
        title: `Potential anomaly: ${failed} failed sign-ins in 24 hours`,
        reason:
          'A spike in failed sign-ins may be password guessing. Review the accounts involved; consider forcing a password reset. Containment is a human decision.',
        evidence: [
          {
            label: 'Failed sign-ins (24h)',
            source: 'Security events',
            value: failed,
          },
          {
            label: 'Accounts locked (24h)',
            source: 'Security events',
            value: get('security.account_locked')?.last24h ?? 0,
          },
        ],
        confidence: 'MEDIUM',
        suggestedAction: { type: 'REVIEW_SECURITY_EVENTS' },
        factors: {
          customerImpact: 1,
          regulatoryImpact: 1,
          dependency: 0,
          risk: 3,
        },
        subjectType: 'SECURITY',
      });
    const blocked = get('security.role_escalation_blocked')?.last24h ?? 0;
    if (blocked > 0)
      out.push({
        companyId,
        agentKey: 'security_agent',
        kind: 'ESCALATION_ATTEMPTS',
        dedupeKey: `escalation:${day}`,
        title: `${blocked} blocked privilege escalation attempt(s) in 24 hours`,
        reason:
          'Someone tried to grant a role above their own. It was blocked; review who and why.',
        evidence: [
          {
            label: 'Blocked attempts (24h)',
            source: 'Security events',
            value: blocked,
          },
        ],
        confidence: 'HIGH',
        suggestedAction: { type: 'REVIEW_SECURITY_EVENTS' },
        factors: {
          customerImpact: 0,
          regulatoryImpact: 1,
          dependency: 0,
          risk: 3,
        },
        subjectType: 'SECURITY',
      });
    if (o.incidents.openCritical > 0)
      out.push({
        companyId,
        agentKey: 'security_agent',
        kind: 'OPEN_CRITICAL_INCIDENT',
        dedupeKey: `critical-incidents:${day}`,
        title: `${o.incidents.openCritical} open critical security incident(s)`,
        reason: 'Critical incidents need an owner and a status update.',
        evidence: [
          {
            label: 'Open critical incidents',
            source: 'Incident register',
            value: o.incidents.openCritical,
          },
        ],
        confidence: 'HIGH',
        suggestedAction: { type: 'OPEN_INCIDENTS' },
        factors: {
          customerImpact: 2,
          regulatoryImpact: 3,
          dependency: 1,
          risk: 3,
        },
        subjectType: 'SECURITY',
      });
    return out;
  }

  // ------------------------------------------------------------------------------------ operations
  async operations(companyId: string): Promise<RecommendationInput[]> {
    const out: RecommendationInput[] = [];
    const failed = await this.prisma.workflowExecution.findMany({
      where: {
        companyId,
        status: { in: ['FAILED', 'DEAD_LETTERED'] },
        startedAt: { gte: new Date(Date.now() - 24 * HOURS) },
      },
      select: { id: true, error: true, workflow: { select: { name: true } } },
      take: 30,
    });
    for (const w of failed)
      out.push({
        companyId,
        agentKey: 'operations_supervisor',
        kind: 'WORKFLOW_FAILED',
        dedupeKey: `workflow:${w.id}`,
        title: `Automation "${w.workflow.name}" failed`,
        reason: w.error ?? 'The workflow stopped with an error.',
        evidence: [
          {
            label: 'Error',
            source: 'Workflow engine',
            value: (w.error ?? 'unknown').slice(0, 300),
          },
        ],
        confidence: 'HIGH',
        suggestedAction: { type: 'OPEN_EXECUTION', executionId: w.id },
        factors: {
          customerImpact: 1,
          regulatoryImpact: 0,
          dependency: 1,
          risk: 1,
        },
        subjectType: 'WORKFLOW',
        subjectId: w.id,
      });
    const holds = await this.prisma.flightBooking.findMany({
      where: {
        customer: { companyId },
        holdExpiresAt: {
          gte: new Date(),
          lte: new Date(Date.now() + 24 * HOURS),
        },
        status: { in: ['PENDING', 'CONFIRMED'] },
      },
      select: {
        id: true,
        bookingReference: true,
        holdExpiresAt: true,
        totalAmount: true,
        currency: true,
        customer: { select: { assignedBranchId: true } },
      },
      take: 50,
    });
    for (const b of holds)
      out.push({
        companyId,
        branchId: b.customer.assignedBranchId,
        agentKey: 'flight_ops',
        kind: 'HOLD_EXPIRING',
        dedupeKey: `hold:${b.id}`,
        title: `Flight hold ${b.bookingReference} expires within 24 hours`,
        reason:
          'The reserved seats are released if the booking is not paid and ticketed in time.',
        evidence: [
          {
            label: 'Hold expires',
            source: 'Flight booking',
            value: b.holdExpiresAt!.toISOString(),
          },
        ],
        confidence: 'HIGH',
        suggestedAction: { type: 'CHASE_PAYMENT', bookingId: b.id },
        factors: {
          hoursToDeadline: hoursUntil(b.holdExpiresAt),
          customerImpact: 1,
          regulatoryImpact: 0,
          dependency: 0,
          risk: 1,
          financialImpact: b.totalAmount,
        },
        subjectType: 'FLIGHT',
        subjectId: b.id,
        dueAt: b.holdExpiresAt,
      });
    return out;
  }
}
