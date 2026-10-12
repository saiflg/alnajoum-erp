import {
  DEFAULT_LIST_LIMIT,
  MAX_LIST_LIMIT,
  parseListPage,
  withPageHeaders,
} from './list-page';

describe('parseListPage', () => {
  it('defaults to a bounded page', () => {
    expect(parseListPage()).toEqual({ take: DEFAULT_LIST_LIMIT, skip: 0 });
  });

  it('honours a sensible limit and offset', () => {
    expect(parseListPage('50', '100')).toEqual({ take: 50, skip: 100 });
  });

  it('never allows more than the maximum, however much is asked for', () => {
    expect(parseListPage('999999').take).toBe(MAX_LIST_LIMIT);
  });

  it.each(['abc', '-5', '0', '1.5', '', ' ', '1e9', '99999999999'])(
    'falls back to the default for the unusable limit %p',
    (bad) => {
      expect(parseListPage(bad).take).toBe(DEFAULT_LIST_LIMIT);
    },
  );

  it('treats a bad offset as zero', () => {
    expect(parseListPage(undefined, '-3').skip).toBe(0);
    expect(parseListPage(undefined, 'x').skip).toBe(0);
  });
});

describe('withPageHeaders', () => {
  const headersOf = () => {
    const h: Record<string, string> = {};
    return { h, res: { setHeader: (k: string, v: string) => (h[k] = v) } };
  };

  it('reports a complete page without counting anything', async () => {
    const { h, res } = headersOf();
    const total = jest.fn();
    const rows = await withPageHeaders(
      res as never,
      [1, 2, 3],
      { take: 10, skip: 0 },
      total,
    );
    expect(rows).toEqual([1, 2, 3]);
    expect(h['X-Result-Truncated']).toBe('false');
    expect(h['X-Total-Count']).toBeUndefined();
    expect(total).not.toHaveBeenCalled();
  });

  it('flags a full page as possibly cut short and reports the real total', async () => {
    const { h, res } = headersOf();
    await withPageHeaders(res as never, [1, 2], { take: 2, skip: 4 }, () =>
      Promise.resolve(37),
    );
    expect(h).toMatchObject({
      'X-Result-Limit': '2',
      'X-Result-Offset': '4',
      'X-Result-Truncated': 'true',
      'X-Total-Count': '37',
    });
  });
});
