import { BadRequestException, Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { AuthContext } from '../../../common/interfaces/auth-context.interface';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { PERMISSIONS } from '../../rbac/constants/permissions.constant';
import {
  classifyDocument,
  extractPassport,
  triageMessage,
} from '../runtime/assist';
import { detectInjection, maskSensitive } from '../runtime/guards';
import { ToolError, resolveCustomer } from '../tools/tool-support';
import { PrincipalService } from './principal.service';
import { AiRecommendationsService } from './recommendations.service';
import { AiSafetyService } from './safety.service';

/**
 * Document, email and call assistants. They READ and PROPOSE. Nothing they return has been applied: a passport
 * field changes only through applyPassport, which needs a person with permission to edit the customer, an explicit
 * confirmation, and (when it would replace what is stored) an explicit overwrite. Email and call content is
 * untrusted data: instructions inside it are reported, never followed.
 */
@Injectable()
export class AiAssistService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly principals: PrincipalService,
    private readonly recs: AiRecommendationsService,
    private readonly safety: AiSafetyService,
  ) {}

  async proposeDocument(
    user: AuthContext,
    input: { customerId: string; fileName: string; text?: string },
  ) {
    const p = await this.principals.fromAuth(user);
    const c = await resolveCustomer(this.prisma, p, input.customerId).catch(
      (e: ToolError) => {
        throw new BadRequestException(e.message);
      },
    );
    const row = await this.prisma.customer.findUnique({
      where: { id: c.id },
      select: { passportNumber: true, passportExpiryDate: true },
    });
    const classification = classifyDocument(input.fileName, input.text ?? '');
    const passport =
      classification.proposedType === 'PASSPORT' && input.text
        ? extractPassport(input.text, {
            passportNumber: row?.passportNumber,
            passportExpiryDate: row?.passportExpiryDate?.toISOString() ?? null,
          })
        : null;
    return {
      customerId: c.id,
      classification,
      passport,
      notice:
        'These are proposals read from the file. Nothing has been saved. Check them against the document itself.',
    };
  }

  async applyPassport(
    user: AuthContext,
    input: {
      customerId: string;
      passportNumber: string;
      passportExpiryDate: string;
      confirmed: boolean;
      overwrite?: boolean;
    },
  ) {
    if (
      !user.permissions.includes(PERMISSIONS.CUSTOMER.UPDATE) &&
      !user.roles.includes('SUPER_ADMIN')
    )
      throw new BadRequestException(
        'You need permission to edit customers to save passport details',
      );
    if (input.confirmed !== true)
      throw new BadRequestException(
        'A person must confirm these values against the document',
      );
    const p = await this.principals.fromAuth(user);
    const c = await resolveCustomer(this.prisma, p, input.customerId).catch(
      (e: ToolError) => {
        throw new BadRequestException(e.message);
      },
    );
    const proposal = extractPassport(
      `Passport No: ${input.passportNumber}\nDate of expiry: ${input.passportExpiryDate}`,
    );
    const blocking = proposal.issues.filter((i) =>
      /format|valid date|already expired|No passport|No expiry/.test(i),
    );
    if (blocking.length) throw new BadRequestException(blocking.join('; '));
    const before = await this.prisma.customer.findUnique({
      where: { id: c.id },
      select: { passportNumber: true, passportExpiryDate: true },
    });
    const wouldReplace =
      (before?.passportNumber &&
        before.passportNumber !== input.passportNumber.toUpperCase()) ||
      (before?.passportExpiryDate &&
        before.passportExpiryDate.toISOString().slice(0, 10) !==
          input.passportExpiryDate.slice(0, 10));
    if (wouldReplace && input.overwrite !== true)
      throw new BadRequestException(
        'This would replace passport details already on file. Confirm the overwrite explicitly.',
      );
    await this.prisma.customer.update({
      where: { id: c.id },
      data: {
        passportNumber: input.passportNumber.toUpperCase(),
        passportExpiryDate: new Date(input.passportExpiryDate),
      },
    });
    // The numbers themselves stay out of the audit text; only the fact that they changed.
    await this.audit.record({
      identityId: user.sub,
      companyId: c.companyId,
      action: 'ai.passport_details_applied',
      entityType: 'Customer',
      entityId: c.id,
      metadata: {
        source: 'document assistant proposal, confirmed by a person',
        overwrote: !!wouldReplace,
      },
    });
    return { saved: true, overwrote: !!wouldReplace };
  }

  private async matchCustomer(
    companyId: string | null,
    by: { email?: string; phone?: string },
  ) {
    if (!companyId) return null;
    if (by.email)
      return this.prisma.customer.findFirst({
        where: {
          companyId,
          identity: { email: by.email.trim().toLowerCase() },
        },
        select: { id: true, firstName: true, lastName: true },
      });
    if (by.phone)
      return this.prisma.customer.findFirst({
        where: { companyId, identity: { phone: by.phone } },
        select: { id: true, firstName: true, lastName: true },
      });
    return null;
  }

  async triageEmail(
    user: AuthContext,
    input: { from?: string; subject: string; body: string; record?: boolean },
  ) {
    const p = await this.principals.fromAuth(user);
    const scan = detectInjection(`${input.subject}\n${input.body}`);
    if (scan.flagged)
      await this.safety.record({
        kind: 'PROMPT_INJECTION',
        companyId: p.companyId,
        identityId: user.sub,
        agentKey: 'email_assistant',
        evidence: { source: 'email', kinds: scan.kinds, matches: scan.matches },
      });
    const customer = await this.matchCustomer(p.companyId, {
      email: input.from,
    });
    const result = triageMessage(
      maskSensitive(input.subject),
      maskSensitive(input.body),
      {
        customerName: customer
          ? `${customer.firstName} ${customer.lastName}`
          : undefined,
        channel: 'EMAIL',
      },
    );
    let recommendationId: string | undefined;
    if (input.record && p.companyId) {
      const key = createHash('sha256')
        .update(`${input.from}|${input.subject}|${input.body.slice(0, 200)}`)
        .digest('hex')
        .slice(0, 24);
      recommendationId = (
        await this.recs.upsert({
          companyId: p.companyId,
          agentKey: 'crm_agent',
          kind: 'EMAIL_TRIAGE',
          dedupeKey: `email:${key}`,
          title: `Email: ${result.summary.slice(0, 90)}`,
          reason: `Route to ${result.team}. ${result.requests.join(', ') || 'general enquiry'}.`,
          evidence: [
            {
              label: 'Email summary',
              source: 'Email assistant (rule-based)',
              value: result.summary,
            },
          ],
          confidence: 'MEDIUM',
          suggestedAction: {
            type: 'REPLY_DRAFTED',
            tasks: result.suggestedTasks,
          },
          factors: {
            customerImpact: 1,
            regulatoryImpact: result.approvalReasons.some((r) =>
              r.includes('legal'),
            )
              ? 3
              : 0,
            dependency: 0,
            risk: result.requiresHumanApproval ? 2 : 0,
          },
          subjectType: customer ? 'CUSTOMER' : undefined,
          subjectId: customer?.id,
        })
      ).id;
    }
    return {
      ...result,
      matchedCustomer: customer
        ? {
            id: customer.id,
            name: `${customer.firstName} ${customer.lastName}`,
          }
        : null,
      injectionAttemptDetected: scan.flagged,
      recommendationId,
      notice:
        'The reply is a draft: nothing has been sent. Instructions inside the email were not followed.',
    };
  }

  /** Call architecture: takes a TRANSCRIPT. Speech-to-text and telephony are out of scope; spoken claims never verify anyone. */
  async processCall(
    user: AuthContext,
    input: { transcript: string; callerPhone?: string; otpVerified?: boolean },
  ) {
    const p = await this.principals.fromAuth(user);
    const scan = detectInjection(input.transcript);
    if (scan.flagged)
      await this.safety.record({
        kind: 'PROMPT_INJECTION',
        companyId: p.companyId,
        identityId: user.sub,
        agentKey: 'voice_assistant',
        evidence: { source: 'call', kinds: scan.kinds },
      });
    const customer = await this.matchCustomer(p.companyId, {
      phone: input.callerPhone,
    });
    const verified = !!customer && input.otpVerified === true;
    const result = triageMessage(
      'Phone call',
      maskSensitive(input.transcript),
      {
        customerName: verified ? customer!.firstName : undefined,
        channel: 'CALL',
      },
    );
    return {
      callSummary: result.summary,
      category: result.category,
      team: result.team,
      requests: result.requests,
      suggestedTasks: result.suggestedTasks,
      identity: {
        phoneMatchedACustomer: !!customer,
        verified,
        note: verified
          ? 'Verified by the one-time code the caller system checked.'
          : 'NOT verified. A caller saying who they are does not verify them: confirm by one-time code before sharing any account detail.',
      },
      matchedCustomer: verified ? { id: customer!.id } : null,
      requiresHumanApproval: result.requiresHumanApproval,
      approvalReasons: result.approvalReasons,
      notice:
        'Summary and suggested tasks only. No action was taken on the call.',
    };
  }
}
