import { BadRequestException } from '@nestjs/common';
import { CommChannel, CommContactKind, Prisma } from '@prisma/client';
import { CONTACT_INTERESTS } from './comm-identifiers';

/**
 * A segment is a saved filter over contacts. It decides who is LISTED, never who may be messaged: a campaign still
 * checks consent, suppression and topic for every recipient at the moment of sending, whatever a segment says.
 */
export interface SegmentDefinition {
  /** Limit to people currently subscribed to marketing on this channel (optionally for given topics). */
  subscribedChannel?: CommChannel;
  topics?: string[];
  kinds?: CommContactKind[];
  languages?: string[];
  countries?: string[];
  tags?: string[];
  interests?: string[];
  sources?: string[];
  hasPhone?: boolean;
  hasEmail?: boolean;
  /** Customers with a confirmed flight, Umrah or Hajj departure within this many days. */
  upcomingTravelWithinDays?: number;
  /** Not messaged in the last N days (or never). */
  notContactedForDays?: number;
}

const KINDS: CommContactKind[] = [
  'CUSTOMER',
  'STAFF',
  'LEAD',
  'SUBSCRIBER',
  'OTHER',
];
const KEYS = new Set<string>([
  'subscribedChannel',
  'topics',
  'kinds',
  'languages',
  'countries',
  'tags',
  'interests',
  'sources',
  'hasPhone',
  'hasEmail',
  'upcomingTravelWithinDays',
  'notContactedForDays',
]);

function strings(v: unknown, field: string, max = 30): string[] | undefined {
  if (v === undefined || v === null) return undefined;
  if (
    !Array.isArray(v) ||
    v.length > max ||
    v.some((x) => typeof x !== 'string' || x.length > 60)
  )
    throw new BadRequestException(
      `"${field}" must be a short list of text values.`,
    );
  const out = [
    ...new Set((v as string[]).map((x) => x.trim()).filter(Boolean)),
  ];
  return out.length ? out : undefined;
}

/** Accepts only the fields above; anything else is an error, so a definition can never smuggle in a raw query. */
export function validateDefinition(raw: unknown): SegmentDefinition {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw))
    throw new BadRequestException('A segment definition must be an object.');
  const input = raw as Record<string, unknown>;
  for (const k of Object.keys(input))
    if (!KEYS.has(k))
      throw new BadRequestException(`Unknown segment field "${k}".`);
  const def: SegmentDefinition = {};

  if (input.subscribedChannel !== undefined) {
    if (
      input.subscribedChannel !== 'WHATSAPP' &&
      input.subscribedChannel !== 'EMAIL'
    )
      throw new BadRequestException(
        '"subscribedChannel" must be WHATSAPP or EMAIL.',
      );
    def.subscribedChannel = input.subscribedChannel;
  }
  def.topics = strings(input.topics, 'topics', 20);
  if (def.topics && !def.subscribedChannel)
    throw new BadRequestException(
      'Choosing topics needs a subscribed channel.',
    );
  const kinds = strings(input.kinds, 'kinds', 5);
  if (kinds) {
    if (kinds.some((k) => !KINDS.includes(k as CommContactKind)))
      throw new BadRequestException('Unknown contact kind.');
    def.kinds = kinds as CommContactKind[];
  }
  def.languages = strings(input.languages, 'languages', 5);
  if (def.languages?.some((l) => !['en', 'ha', 'ar'].includes(l)))
    throw new BadRequestException('Languages are en, ha or ar.');
  def.countries = strings(input.countries, 'countries', 20);
  def.tags = strings(input.tags, 'tags')?.map((t) => t.toLowerCase());
  def.interests = strings(input.interests, 'interests', 6);
  if (
    def.interests?.some(
      (i) => !(CONTACT_INTERESTS as readonly string[]).includes(i),
    )
  )
    throw new BadRequestException('Unknown interest.');
  def.sources = strings(input.sources, 'sources', 10);
  for (const f of ['hasPhone', 'hasEmail'] as const) {
    if (input[f] === undefined) continue;
    if (typeof input[f] !== 'boolean')
      throw new BadRequestException(`"${f}" must be true or false.`);
    def[f] = input[f];
  }
  for (const f of [
    'upcomingTravelWithinDays',
    'notContactedForDays',
  ] as const) {
    if (input[f] === undefined) continue;
    const n = input[f];
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > 730)
      throw new BadRequestException(
        `"${f}" must be a whole number of days between 1 and 730.`,
      );
    def[f] = n;
  }
  for (const k of Object.keys(def) as (keyof SegmentDefinition)[])
    if (def[k] === undefined) delete def[k];
  return def;
}

const DAY = 24 * 60 * 60 * 1000;

/** The contact filter for a definition, always confined to one company and to active contacts. */
export function buildContactWhere(
  companyId: string,
  def: SegmentDefinition,
  now: Date = new Date(),
): Prisma.CommContactWhereInput {
  const and: Prisma.CommContactWhereInput[] = [
    { companyId },
    { status: 'ACTIVE' },
  ];
  if (def.subscribedChannel) {
    const topicClause: Prisma.CommSubscriptionWhereInput = def.topics?.length
      ? {
          OR: [
            { topics: { isEmpty: true } },
            { topics: { hasSome: def.topics } },
          ],
        }
      : {};
    and.push({
      subscriptions: {
        some: {
          channel: def.subscribedChannel,
          status: 'SUBSCRIBED',
          ...topicClause,
        },
      },
    });
  }
  if (def.kinds?.length) and.push({ kind: { in: def.kinds } });
  if (def.languages?.length)
    and.push({ preferredLanguage: { in: def.languages } });
  if (def.countries?.length)
    and.push({
      OR: def.countries.map((c) => ({
        country: { equals: c, mode: 'insensitive' as const },
      })),
    });
  if (def.tags?.length) and.push({ tags: { hasSome: def.tags } });
  if (def.interests?.length)
    and.push({ interests: { hasSome: def.interests } });
  if (def.sources?.length) and.push({ source: { in: def.sources } });
  if (def.hasPhone !== undefined)
    and.push(
      def.hasPhone ? { primaryPhone: { not: null } } : { primaryPhone: null },
    );
  if (def.hasEmail !== undefined)
    and.push(
      def.hasEmail ? { primaryEmail: { not: null } } : { primaryEmail: null },
    );
  if (def.upcomingTravelWithinDays) {
    const end = new Date(now.getTime() + def.upcomingTravelWithinDays * DAY);
    const window = { gte: now, lte: end };
    and.push({
      customer: {
        OR: [
          {
            flightBookings: {
              some: {
                status: { in: ['CONFIRMED', 'TICKETED'] },
                departureAt: window,
              },
            },
          },
          {
            umrahRegistrations: {
              some: {
                status: { in: ['CONFIRMED', 'PENDING'] },
                package: { departureDate: window },
              },
            },
          },
          {
            hajjRegistrations: {
              some: {
                status: { in: ['CONFIRMED', 'PENDING'] },
                package: { departureDate: window },
              },
            },
          },
        ],
      },
    });
  }
  if (def.notContactedForDays) {
    const cutoff = new Date(now.getTime() - def.notContactedForDays * DAY);
    and.push({
      OR: [
        { lastCommunicatedAt: null },
        { lastCommunicatedAt: { lt: cutoff } },
      ],
    });
  }
  return { AND: and };
}

/** Segments every company starts with. Created on first visit to the segments page; editable afterwards. */
export const PRESET_SEGMENTS: {
  name: string;
  description: string;
  definition: SegmentDefinition;
}[] = [
  {
    name: 'WhatsApp opted-in',
    description: 'Subscribed to WhatsApp marketing.',
    definition: { subscribedChannel: 'WHATSAPP' },
  },
  {
    name: 'Email opted-in',
    description: 'Subscribed to email marketing (confirmed).',
    definition: { subscribedChannel: 'EMAIL' },
  },
  {
    name: 'Umrah interest',
    description: 'Contacts interested in Umrah.',
    definition: { interests: ['UMRAH'] },
  },
  {
    name: 'Hajj interest',
    description: 'Contacts interested in Hajj.',
    definition: { interests: ['HAJJ'] },
  },
  {
    name: 'Visa interest',
    description: 'Contacts interested in visas.',
    definition: { interests: ['VISA'] },
  },
  {
    name: 'Flight interest',
    description: 'Contacts interested in flights.',
    definition: { interests: ['FLIGHT'] },
  },
  {
    name: 'Hotel interest',
    description: 'Contacts interested in hotels.',
    definition: { interests: ['HOTEL'] },
  },
  {
    name: 'Corporate clients',
    description: 'Corporate travel contacts.',
    definition: { interests: ['CORPORATE'] },
  },
  {
    name: 'Prospects',
    description: 'Leads who are not customers yet.',
    definition: { kinds: ['LEAD'] },
  },
  {
    name: 'Upcoming travel (30 days)',
    description: 'Customers departing in the next 30 days.',
    definition: { upcomingTravelWithinDays: 30 },
  },
  {
    name: 'Hausa speakers',
    description: 'Prefer Hausa.',
    definition: { languages: ['ha'] },
  },
  {
    name: 'English speakers',
    description: 'Prefer English.',
    definition: { languages: ['en'] },
  },
  {
    name: 'Arabic speakers',
    description: 'Prefer Arabic.',
    definition: { languages: ['ar'] },
  },
];
