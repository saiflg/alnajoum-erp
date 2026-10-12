import {
  maskEmail,
  maskPhone,
  newOpaqueToken,
  normaliseEmail,
  normalisePhone,
  normaliseTags,
} from './comm-identifiers';
import {
  applyConsentAction,
  marketingEligibility,
  transactionalEligibility,
} from './comm-consent.policy';
import { classifyConsentReply } from './comm-inbound-intent';

describe('identifiers', () => {
  it('normalises phones to one E.164 form whatever way they were typed', () => {
    const forms = [
      '0803 123 4567',
      '+234 803 123 4567',
      '2348031234567',
      '00234-803-123-4567',
    ];
    for (const f of forms) expect(normalisePhone(f)).toBe('+2348031234567');
  });
  it('rejects text and too-short numbers instead of storing them', () => {
    expect(normalisePhone('call me')).toBeNull();
    expect(normalisePhone('12345')).toBeNull();
    expect(normalisePhone('')).toBeNull();
    expect(normalisePhone(null)).toBeNull();
  });
  it('normalises and validates emails', () => {
    expect(normaliseEmail('  Ada@Example.COM ')).toBe('ada@example.com');
    for (const bad of [
      '',
      'ada',
      'ada@',
      'a b@c.com',
      'a@b',
      '<a@b.com>',
      'a@b.c',
    ])
      expect(normaliseEmail(bad)).toBeNull();
  });
  it('masks identifiers for operator lists', () => {
    expect(maskPhone('+2348031234567')).toBe('+234*******567');
    expect(maskEmail('ada@example.com')).toBe('a***@example.com');
  });
  it('produces unguessable, distinct tokens', () => {
    const a = newOpaqueToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(newOpaqueToken()).not.toBe(a);
  });
  it('cleans tags', () => {
    expect(normaliseTags([' VIP ', 'vip', 'Hajj 2027'])).toEqual([
      'vip',
      'hajj-2027',
    ]);
  });
});

describe('consent state machine', () => {
  const single = { doubleOptIn: false };
  const dbl = { doubleOptIn: true };

  it('single opt-in grants straight away', () => {
    expect(applyConsentAction('NONE', 'GRANTED', single)).toEqual({
      status: 'SUBSCRIBED',
      allowsMarketing: true,
    });
  });
  it('double opt-in only becomes active after the confirmation', () => {
    const afterGrant = applyConsentAction('NONE', 'GRANTED', dbl);
    expect(afterGrant).toEqual({
      status: 'PENDING_CONFIRMATION',
      allowsMarketing: false,
    });
    expect(applyConsentAction(afterGrant.status, 'CONFIRMED', dbl)).toEqual({
      status: 'SUBSCRIBED',
      allowsMarketing: true,
    });
  });
  it('a confirmation can never revive a withdrawn or never-requested subscription', () => {
    expect(
      applyConsentAction('UNSUBSCRIBED', 'CONFIRMED', dbl).allowsMarketing,
    ).toBe(false);
    expect(applyConsentAction('NONE', 'CONFIRMED', dbl).allowsMarketing).toBe(
      false,
    );
  });
  it('a request and a denial never grant', () => {
    expect(
      applyConsentAction('NONE', 'REQUESTED', single).allowsMarketing,
    ).toBe(false);
    expect(
      applyConsentAction('UNSUBSCRIBED', 'REQUESTED', single).allowsMarketing,
    ).toBe(false);
    expect(applyConsentAction('UNSUBSCRIBED', 'DENIED', single).status).toBe(
      'UNSUBSCRIBED',
    );
  });
  it('a withdrawal is immediate from every state', () => {
    for (const s of [
      'NONE',
      'PENDING_CONFIRMATION',
      'SUBSCRIBED',
      'UNSUBSCRIBED',
    ] as const)
      expect(applyConsentAction(s, 'WITHDRAWN', single)).toEqual({
        status: 'UNSUBSCRIBED',
        allowsMarketing: false,
      });
  });
  it('only a new grant lifts an unsubscribe', () => {
    expect(
      applyConsentAction('UNSUBSCRIBED', 'GRANTED', single).allowsMarketing,
    ).toBe(true);
    expect(
      applyConsentAction('UNSUBSCRIBED', 'GRANTED', dbl).allowsMarketing,
    ).toBe(false);
  });
});

describe('marketing eligibility', () => {
  const ok = {
    contactStatus: 'ACTIVE' as const,
    hasAddress: true,
    addressInvalid: false,
    suppressed: false,
    subscription: 'SUBSCRIBED' as const,
    subscribedTopics: [] as string[],
    topic: 'umrah',
  };
  it('allows a subscribed contact', () =>
    expect(marketingEligibility(ok)).toEqual({ eligible: true }));
  it.each([
    [{ contactStatus: 'MERGED' as const }, 'CONTACT_NOT_ACTIVE'],
    [{ hasAddress: false }, 'NO_ADDRESS'],
    [{ suppressed: true }, 'SUPPRESSED'],
    [{ addressInvalid: true }, 'ADDRESS_INVALID'],
    [{ subscription: 'UNSUBSCRIBED' as const }, 'UNSUBSCRIBED'],
    [{ subscription: 'PENDING_CONFIRMATION' as const }, 'PENDING_CONFIRMATION'],
    [{ subscription: 'NONE' as const }, 'NOT_SUBSCRIBED'],
    [{ subscribedTopics: ['visa'] }, 'TOPIC_NOT_SELECTED'],
  ])('excludes %j as %s', (patch, reason) => {
    expect(marketingEligibility({ ...ok, ...patch })).toEqual({
      eligible: false,
      reason,
    });
  });
  it('suppression wins even over a subscribed state', () => {
    expect(
      marketingEligibility({
        ...ok,
        suppressed: true,
        subscription: 'SUBSCRIBED',
      }),
    ).toEqual({ eligible: false, reason: 'SUPPRESSED' });
  });
  it('a topic list that includes the topic, or the general topic, passes', () => {
    expect(
      marketingEligibility({ ...ok, subscribedTopics: ['umrah', 'visa'] })
        .eligible,
    ).toBe(true);
    expect(
      marketingEligibility({
        ...ok,
        subscribedTopics: ['visa'],
        topic: 'general',
      }).eligible,
    ).toBe(true);
  });
  it('transactional messages ignore marketing consent but not a hard suppression', () => {
    const base = {
      contactStatus: 'ACTIVE' as const,
      hasAddress: true,
      addressInvalid: false,
      suppressed: false,
    };
    expect(transactionalEligibility(base).eligible).toBe(true);
    expect(
      transactionalEligibility({ ...base, suppressed: true }).eligible,
    ).toBe(false);
    expect(
      transactionalEligibility({ ...base, addressInvalid: true }).eligible,
    ).toBe(false);
  });
});

describe('inbound consent replies (English, Hausa, Arabic)', () => {
  it.each([
    'STOP',
    'stop.',
    'Unsubscribe',
    'stop all',
    'daina',
    'Ka daina',
    'cire ni',
    'إيقاف',
    'ايقاف',
    'توقف',
    'إلغاء الاشتراك',
    'please stop sending me messages about umrah',
    'ba na son sakonni',
    'لا ترسل لي رسائل',
  ])('reads %j as an opt-out', (t) =>
    expect(classifyConsentReply(t)).toBe('OPT_OUT'),
  );
  it.each(['cancel', 'no', 'enough', 'stop it', 'لا', 'dakata yanzu'])(
    'asks before treating %j as an opt-out',
    (t) => expect(classifyConsentReply(t)).toBe('OPT_OUT_UNCLEAR'),
  );
  it.each([
    'cancel my booking',
    'please stop the payment',
    'I want a refund for my ticket',
    'what is the price of umrah',
    'hello',
  ])('does not unsubscribe %j', (t) =>
    expect(['OTHER']).toContain(classifyConsentReply(t)),
  );
  it('opt-in needs an explicit word; a bare yes is not consent', () => {
    expect(classifyConsentReply('START')).toBe('OPT_IN');
    expect(classifyConsentReply('subscribe')).toBe('OPT_IN');
    expect(classifyConsentReply('yes')).toBe('OTHER');
    expect(classifyConsentReply('ok')).toBe('OTHER');
  });
  it('recognises a confirmation', () =>
    expect(classifyConsentReply('CONFIRM')).toBe('CONFIRM'));
  it('handles empty input', () =>
    expect(classifyConsentReply('   ')).toBe('OTHER'));
});
