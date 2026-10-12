/** Plain-language reasons a contact is left out of a campaign (mirrors the server's list). */
export const EXCLUSION_LABELS: Record<string, string> = {
  CONTACT_NOT_ACTIVE: 'Contact is merged or erased',
  NO_ADDRESS: 'No address for this channel',
  ADDRESS_INVALID: 'Address marked invalid',
  SUPPRESSED: 'On the do-not-send list',
  NOT_SUBSCRIBED: 'Has not given marketing consent',
  PENDING_CONFIRMATION: 'Consent not yet confirmed',
  UNSUBSCRIBED: 'Unsubscribed',
  TOPIC_NOT_SELECTED: 'Did not choose this topic',
};
