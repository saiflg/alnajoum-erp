import { BadRequestException } from '@nestjs/common';
import {
  buildContactWhere,
  PRESET_SEGMENTS,
  validateDefinition,
} from './comm-segment.definition';

describe('segment definitions', () => {
  it('accepts a well-formed definition and drops empty fields', () => {
    expect(
      validateDefinition({ kinds: ['LEAD'], tags: ['VIP '], languages: [] }),
    ).toEqual({
      kinds: ['LEAD'],
      tags: ['vip'],
    });
  });
  it.each([
    [{ drop: 'table' }],
    [{ kinds: ['ROBOT'] }],
    [{ languages: ['fr'] }],
    [{ interests: ['CRYPTO'] }],
    [{ subscribedChannel: 'SMS' }],
    [{ topics: ['umrah'] }],
    [{ upcomingTravelWithinDays: 0 }],
    [{ upcomingTravelWithinDays: 9999 }],
    [{ hasPhone: 'yes' }],
    ['a string'],
    [null],
    [[]],
  ])('refuses %j', (bad) => {
    expect(() => validateDefinition(bad)).toThrow(BadRequestException);
  });

  it('always confines the filter to the company and to active contacts', () => {
    const where = buildContactWhere('co1', {});
    expect(JSON.stringify(where)).toContain('"companyId":"co1"');
    expect(JSON.stringify(where)).toContain('"status":"ACTIVE"');
  });
  it('a consent segment asks for SUBSCRIBED on that channel, treating an empty topic list as "everything"', () => {
    const json = JSON.stringify(
      buildContactWhere('co1', {
        subscribedChannel: 'EMAIL',
        topics: ['umrah'],
      }),
    );
    expect(json).toContain('"channel":"EMAIL"');
    expect(json).toContain('"status":"SUBSCRIBED"');
    expect(json).toContain('"isEmpty":true');
    expect(json).toContain('"hasSome":["umrah"]');
  });
  it('upcoming travel uses a window starting now', () => {
    const now = new Date('2026-10-12T00:00:00Z');
    const json = JSON.stringify(
      buildContactWhere('co1', { upcomingTravelWithinDays: 30 }, now),
    );
    expect(json).toContain('2026-10-12T00:00:00.000Z');
    expect(json).toContain('2026-11-11T00:00:00.000Z');
    expect(json).toContain('flightBookings');
    expect(json).toContain('umrahRegistrations');
    expect(json).toContain('hajjRegistrations');
  });
  it('every preset is itself valid', () => {
    for (const p of PRESET_SEGMENTS)
      expect(() => validateDefinition(p.definition)).not.toThrow();
    expect(PRESET_SEGMENTS.map((p) => p.name)).toEqual(
      expect.arrayContaining([
        'WhatsApp opted-in',
        'Email opted-in',
        'Umrah interest',
        'Hajj interest',
        'Visa interest',
        'Prospects',
        'Hausa speakers',
        'English speakers',
        'Arabic speakers',
      ]),
    );
  });
});
