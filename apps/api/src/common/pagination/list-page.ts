import type { Response } from 'express';

/**
 * Row cap for the big administrative lists (invoices, customers, bookings, tickets).
 *
 * These endpoints used to return every row. That is fine for a demo and a problem for a real agency: the response
 * grows without bound and each request reads the whole table. They now return at most `limit` rows (default 500,
 * never more than 1000), newest first, and accept `?limit=` and `?offset=` to page. The response is still a plain
 * array, so existing callers keep working; the headers say whether the page was cut short:
 *
 *   X-Result-Limit, X-Result-Offset, X-Result-Truncated (true|false), and X-Total-Count when truncated.
 */
export const DEFAULT_LIST_LIMIT = 500;
export const MAX_LIST_LIMIT = 1000;

export interface ListPage {
  take: number;
  skip: number;
}

const toInt = (value: string | undefined): number | undefined => {
  if (value === undefined || !/^\d{1,9}$/.test(value.trim())) return undefined;
  return Number.parseInt(value, 10);
};

/** Reads `limit` / `offset` leniently: anything unusable falls back to the default rather than failing the list. */
export function parseListPage(limit?: string, offset?: string): ListPage {
  const l = toInt(limit);
  const o = toInt(offset);
  return {
    take: l && l > 0 ? Math.min(l, MAX_LIST_LIMIT) : DEFAULT_LIST_LIMIT,
    skip: o ?? 0,
  };
}

/** Sets the paging headers and returns the rows unchanged. `total` is only evaluated when the page is full. */
export async function withPageHeaders<T>(
  res: Pick<Response, 'setHeader'>,
  rows: T[],
  page: ListPage,
  total: () => Promise<number>,
): Promise<T[]> {
  const truncated = rows.length >= page.take;
  res.setHeader('X-Result-Limit', String(page.take));
  res.setHeader('X-Result-Offset', String(page.skip));
  res.setHeader('X-Result-Truncated', String(truncated));
  if (truncated) res.setHeader('X-Total-Count', String(await total()));
  return rows;
}
