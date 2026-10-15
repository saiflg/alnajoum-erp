import { CommConsentAction, CommSubscriptionStatus } from '@prisma/client';

/**
 * The rules of marketing consent, as pure functions so they can be tested exhaustively.
 *
 * Three different things are never confused:
 *  - holding a CRM contact record (no permission to market at all),
 *  - marketing consent on a channel (WhatsApp and email are separate, per topic),
 *  - transactional messages (service messages about a booking or payment), which do not need marketing consent but
 *    still honour a hard suppression (a bounced or invalid address).
 */

export interface ConsentTransition {
  status: CommSubscriptionStatus;
  /** Whether the person is now allowed marketing on this channel. */
  allowsMarketing: boolean;
}

function keep(
  status: CommSubscriptionStatus,
  allowsMarketing: boolean,
): ConsentTransition {
  return { status, allowsMarketing };
}

/**
 * The state after an action. A withdrawal is final until a NEW valid grant: an import, a tag, an AI suggestion or an
 * admin edit never moves UNSUBSCRIBED back to SUBSCRIBED; only GRANTED/CONFIRMED (from the person or recorded on
 * their behalf with evidence) does.
 */
export function applyConsentAction(
  current: CommSubscriptionStatus,
  action: CommConsentAction,
  opts: { doubleOptIn: boolean },
): ConsentTransition {
  switch (action) {
    case 'REQUESTED':
      // A request only asks. It can never grant, and never undoes a withdrawal that was not re-granted.
      if (current === 'SUBSCRIBED') return keep(current, true);
      return { status: 'PENDING_CONFIRMATION', allowsMarketing: false };
    case 'GRANTED':
      if (opts.doubleOptIn) {
        // Needs the person's own confirmation (a link in the email); an already-subscribed person stays so.
        if (current === 'SUBSCRIBED') return keep(current, true);
        return { status: 'PENDING_CONFIRMATION', allowsMarketing: false };
      }
      return { status: 'SUBSCRIBED', allowsMarketing: true };
    case 'CONFIRMED':
      // Only meaningful when something was pending; a confirmation cannot revive a withdrawn subscription.
      if (current === 'PENDING_CONFIRMATION')
        return { status: 'SUBSCRIBED', allowsMarketing: true };
      return keep(current, current === 'SUBSCRIBED');
    case 'WITHDRAWN':
      return { status: 'UNSUBSCRIBED', allowsMarketing: false };
    case 'DENIED':
      if (current === 'SUBSCRIBED') return keep(current, true);
      return {
        status: current === 'UNSUBSCRIBED' ? 'UNSUBSCRIBED' : 'NONE',
        allowsMarketing: false,
      };
  }
}

export type ExclusionReason =
  | 'CONTACT_NOT_ACTIVE'
  | 'NO_ADDRESS'
  | 'ADDRESS_INVALID'
  | 'SUPPRESSED'
  | 'NOT_SUBSCRIBED'
  | 'PENDING_CONFIRMATION'
  | 'UNSUBSCRIBED'
  | 'TOPIC_NOT_SELECTED';

export interface EligibilityInput {
  contactStatus: 'ACTIVE' | 'MERGED' | 'ERASED';
  hasAddress: boolean;
  addressInvalid: boolean;
  suppressed: boolean;
  subscription: CommSubscriptionStatus;
  subscribedTopics: string[];
  topic: string;
}

export type Eligibility =
  { eligible: true } | { eligible: false; reason: ExclusionReason };

/** Whether a marketing message on one channel and topic may go to the contact, and if not, why. */
export function marketingEligibility(i: EligibilityInput): Eligibility {
  if (i.contactStatus !== 'ACTIVE')
    return { eligible: false, reason: 'CONTACT_NOT_ACTIVE' };
  if (!i.hasAddress) return { eligible: false, reason: 'NO_ADDRESS' };
  // The person's own choice is named first: it is the more useful thing to read in a report.
  if (i.subscription === 'UNSUBSCRIBED')
    return { eligible: false, reason: 'UNSUBSCRIBED' };
  if (i.suppressed) return { eligible: false, reason: 'SUPPRESSED' };
  if (i.addressInvalid) return { eligible: false, reason: 'ADDRESS_INVALID' };
  if (i.subscription === 'PENDING_CONFIRMATION')
    return { eligible: false, reason: 'PENDING_CONFIRMATION' };
  if (i.subscription !== 'SUBSCRIBED')
    return { eligible: false, reason: 'NOT_SUBSCRIBED' };
  // An empty topic list on a subscribed contact means "everything"; otherwise the campaign topic must be among them.
  if (
    i.topic !== 'general' &&
    i.subscribedTopics.length > 0 &&
    !i.subscribedTopics.includes(i.topic)
  )
    return { eligible: false, reason: 'TOPIC_NOT_SELECTED' };
  return { eligible: true };
}

/** A transactional message ignores marketing consent but never a suppressed or invalid address. */
export function transactionalEligibility(
  i: Pick<
    EligibilityInput,
    'contactStatus' | 'hasAddress' | 'addressInvalid' | 'suppressed'
  >,
): Eligibility {
  if (i.contactStatus !== 'ACTIVE')
    return { eligible: false, reason: 'CONTACT_NOT_ACTIVE' };
  if (!i.hasAddress) return { eligible: false, reason: 'NO_ADDRESS' };
  if (i.addressInvalid) return { eligible: false, reason: 'ADDRESS_INVALID' };
  // Only a hard suppression (bounce, complaint, invalid) should block service messages. A marketing unsubscribe is
  // modelled by CommSubscription, and the caller passes `suppressed` for hard reasons only.
  if (i.suppressed) return { eligible: false, reason: 'SUPPRESSED' };
  return { eligible: true };
}

export const EXCLUSION_LABELS: Record<ExclusionReason, string> = {
  CONTACT_NOT_ACTIVE: 'Contact is merged or erased',
  NO_ADDRESS: 'No address for this channel',
  ADDRESS_INVALID: 'Address marked invalid',
  SUPPRESSED: 'On the suppression list',
  NOT_SUBSCRIBED: 'Has not given marketing consent',
  PENDING_CONFIRMATION: 'Consent not yet confirmed',
  UNSUBSCRIBED: 'Unsubscribed',
  TOPIC_NOT_SELECTED: 'Did not choose this topic',
};
