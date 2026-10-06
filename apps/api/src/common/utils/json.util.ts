import { Prisma } from '@prisma/client';

/**
 * A deep, JSON-safe copy of a value, typed for Prisma Json columns and audit
 * snapshots. Dates become ISO strings and undefined fields drop out, which is
 * exactly what we want stored.
 */
export function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
