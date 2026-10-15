import { CommCampaignStatus } from '@prisma/client';

/**
 * The pure rules of the campaign workflow, kept apart from the database code so they can be tested exhaustively.
 */

/** Values filled in per recipient by the system; everything else must be supplied once for the whole campaign. */
export const PER_RECIPIENT_VARIABLES = new Set([
  'first_name',
  'name',
  'company_name',
  'unsubscribe_link',
  'preferences_link',
  'contact_phone',
]);

/** Template values the campaign author still has to supply. */
export function missingCampaignValues(
  templateVariables: string[],
  supplied: Record<string, string> | null | undefined,
): string[] {
  return templateVariables.filter(
    (v) => !PER_RECIPIENT_VARIABLES.has(v) && !(supplied?.[v] ?? '').trim(),
  );
}

export const TRANSITIONS: Record<CommCampaignStatus, CommCampaignStatus[]> = {
  DRAFT: ['PENDING_APPROVAL', 'APPROVED', 'CANCELLED'],
  PENDING_APPROVAL: ['APPROVED', 'DRAFT', 'CANCELLED'],
  APPROVED: ['SCHEDULED', 'SENDING', 'DRAFT', 'CANCELLED'],
  SCHEDULED: ['SENDING', 'PAUSED', 'CANCELLED', 'DRAFT'],
  SENDING: ['PAUSED', 'COMPLETED', 'CANCELLED', 'FAILED'],
  PAUSED: ['SENDING', 'SCHEDULED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
  FAILED: [],
};

export function canTransition(
  from: CommCampaignStatus,
  to: CommCampaignStatus,
): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Only an unsent campaign may be edited. A rejected one goes back to DRAFT first. */
export function isEditable(status: CommCampaignStatus): boolean {
  return status === 'DRAFT';
}

export interface SizeDecision {
  allowed: boolean;
  limit: number;
}

/**
 * Whether a role may put a campaign of this size forward (or approve it). The largest limit among the person's roles
 * applies; a person with no listed role has a limit of zero.
 */
export function withinSizeLimit(limit: number, audience: number): SizeDecision {
  return { allowed: audience <= limit, limit };
}

export interface ApprovalConfirmation {
  channel: string;
  topic: string;
  segmentId: string | null;
  templateId: string | null;
  eligibleCount: number;
  scheduledAt: string | null;
}

export interface CampaignFacts {
  channel: string;
  topic: string;
  segmentId: string | null;
  templateId: string | null;
  scheduledAt: Date | null;
}

/**
 * The approver has to state back what they are approving. Any difference - a changed template, a re-targeted
 * segment, or an audience that has grown or shrunk since they looked - means they were not looking at what would be
 * sent, and the approval is refused.
 */
export function confirmationMismatch(
  confirm: ApprovalConfirmation,
  campaign: CampaignFacts,
  currentEligible: number,
): string | null {
  if (confirm.channel !== campaign.channel) return 'channel';
  if (confirm.topic !== campaign.topic) return 'topic';
  if ((confirm.segmentId ?? null) !== (campaign.segmentId ?? null))
    return 'segment';
  if ((confirm.templateId ?? null) !== (campaign.templateId ?? null))
    return 'template';
  const sameSchedule =
    (confirm.scheduledAt ? new Date(confirm.scheduledAt).getTime() : null) ===
    (campaign.scheduledAt ? campaign.scheduledAt.getTime() : null);
  if (!sameSchedule) return 'schedule';
  if (confirm.eligibleCount !== currentEligible) return 'audience';
  return null;
}

/** Waits (ms) before attempt number `attempt` (1-based count of attempts already made). Null: give up. */
export const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000];
export function retryDelayMs(attemptsMade: number): number | null {
  if (attemptsMade >= MAX_ATTEMPTS) return null;
  return BACKOFF_MS[Math.max(0, attemptsMade - 1)];
}

/** How many messages one scheduler tick may send, from a per-minute limit. At least one, so a low limit still moves. */
export function tickBudget(
  perMinute: number,
  tickSeconds: number,
  sentLast24h: number,
  dailyCap: number,
): number {
  const byRate = Math.max(1, Math.floor((perMinute * tickSeconds) / 60));
  const byCap = Math.max(0, dailyCap - sentLast24h);
  return Math.min(byRate, byCap);
}

/** One whitespace-collapsed line, as a WhatsApp template parameter must be. */
export function whatsAppParameter(value: string): string {
  return value
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/ {2,}/g, ' ')
    .trim()
    .slice(0, 1000);
}

export function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? '';
}
