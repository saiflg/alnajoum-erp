import {
  canTransition,
  confirmationMismatch,
  firstName,
  isEditable,
  MAX_ATTEMPTS,
  missingCampaignValues,
  retryDelayMs,
  tickBudget,
  whatsAppParameter,
  withinSizeLimit,
} from './comm-campaign.rules';

describe('campaign values', () => {
  it('per-recipient values never have to be supplied; the rest do', () => {
    expect(
      missingCampaignValues(
        ['first_name', 'offer', 'link', 'unsubscribe_link'],
        { offer: 'x' },
      ),
    ).toEqual(['link']);
    expect(missingCampaignValues(['offer'], { offer: '   ' })).toEqual([
      'offer',
    ]);
    expect(missingCampaignValues(['offer'], undefined)).toEqual(['offer']);
  });
});

describe('campaign status transitions', () => {
  it.each([
    ['DRAFT', 'PENDING_APPROVAL', true],
    ['DRAFT', 'SENDING', false],
    ['PENDING_APPROVAL', 'SENDING', false],
    ['PENDING_APPROVAL', 'APPROVED', true],
    ['APPROVED', 'SENDING', true],
    ['SENDING', 'PAUSED', true],
    ['PAUSED', 'SENDING', true],
    ['COMPLETED', 'SENDING', false],
    ['CANCELLED', 'DRAFT', false],
    ['FAILED', 'SENDING', false],
  ] as const)('%s -> %s is %s', (from, to, ok) =>
    expect(canTransition(from, to)).toBe(ok),
  );
  it('only a draft is editable', () => {
    expect(isEditable('DRAFT')).toBe(true);
    for (const s of [
      'PENDING_APPROVAL',
      'APPROVED',
      'SCHEDULED',
      'SENDING',
      'PAUSED',
      'COMPLETED',
    ] as const)
      expect(isEditable(s)).toBe(false);
  });
});

describe('size limits', () => {
  it('allows up to and including the limit', () => {
    expect(withinSizeLimit(200, 200).allowed).toBe(true);
    expect(withinSizeLimit(200, 201).allowed).toBe(false);
    expect(withinSizeLimit(0, 1).allowed).toBe(false);
  });
});

describe('final confirmation', () => {
  const campaign = {
    channel: 'EMAIL',
    topic: 'umrah',
    segmentId: 's1',
    templateId: 't1',
    scheduledAt: new Date('2026-11-01T09:00:00Z'),
  };
  const ok = {
    channel: 'EMAIL',
    topic: 'umrah',
    segmentId: 's1',
    templateId: 't1',
    eligibleCount: 120,
    scheduledAt: '2026-11-01T09:00:00.000Z',
  };
  it('accepts exactly what is going to be sent', () =>
    expect(confirmationMismatch(ok, campaign, 120)).toBeNull());
  it.each([
    [{ channel: 'WHATSAPP' }, 120, 'channel'],
    [{ topic: 'hajj' }, 120, 'topic'],
    [{ segmentId: 's2' }, 120, 'segment'],
    [{ templateId: 't9' }, 120, 'template'],
    [{ scheduledAt: null }, 120, 'schedule'],
    [{}, 121, 'audience'],
    [{}, 119, 'audience'],
  ])(
    'refuses a difference %j (current audience %p) as %s',
    (patch, current, what) => {
      expect(confirmationMismatch({ ...ok, ...patch }, campaign, current)).toBe(
        what,
      );
    },
  );
});

describe('retry and rate rules', () => {
  it('backs off and gives up after the maximum number of attempts', () => {
    expect(retryDelayMs(1)).toBe(60_000);
    expect(retryDelayMs(2)).toBe(300_000);
    expect(retryDelayMs(MAX_ATTEMPTS)).toBeNull();
  });
  it('turns a per-minute limit into a per-tick budget, never below one, never above the daily allowance', () => {
    expect(tickBudget(60, 15, 0, 5000)).toBe(15);
    expect(tickBudget(1, 15, 0, 5000)).toBe(1);
    expect(tickBudget(600, 15, 4990, 5000)).toBe(10);
    expect(tickBudget(60, 15, 5000, 5000)).toBe(0);
  });
});

describe('WhatsApp parameters', () => {
  it('are one clean line', () =>
    expect(whatsAppParameter('a\n\nb\t c   d ')).toBe('a b c d'));
  it('take the first name', () => {
    expect(firstName('  Amina Yusuf Bello')).toBe('Amina');
    expect(firstName('Amina')).toBe('Amina');
  });
});
