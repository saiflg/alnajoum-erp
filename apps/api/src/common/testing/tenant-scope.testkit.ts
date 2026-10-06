/**
 * Test helpers for the tenant-isolation specs (Phase 20 follow-up). Compiled out
 * of the production build — see tsconfig.build.json.
 *
 * `createPrismaMock()` returns a stand-in PrismaService whose every model/method
 * is a recording jest.fn with a harmless empty default (`findMany` -> [], `count`
 * -> 0, `findFirst` -> null ...). A test overrides what it needs and then asks
 * `expectEveryQueryTenantScoped` to prove that *each* query that ran — not just
 * the main one — carried the caller's tenant id.
 */
import type { AuthContext } from '../interfaces/auth-context.interface';

export interface RecordedCall {
  /** e.g. "flightBooking.findMany" or "$queryRaw" */
  name: string;
  args: unknown[];
}

type AnyMock = jest.Mock<Promise<unknown>, unknown[]>;

const emptyAggregate = {
  _sum: { amount: null, totalAmount: null },
  _count: 0,
};

function defaultFor(op: string): unknown {
  switch (op) {
    case 'findMany':
    case 'groupBy':
      return [];
    case 'count':
      return 0;
    case 'aggregate':
      return emptyAggregate;
    default:
      return null; // findFirst / findUnique ...
  }
}

export function createPrismaMock() {
  const mocks = new Map<string, AnyMock>();
  const mockFor = (name: string, op: string): AnyMock => {
    let m = mocks.get(name);
    if (!m) {
      m = jest.fn(() => Promise.resolve(defaultFor(op))) as AnyMock;
      mocks.set(name, m);
    }
    return m;
  };

  const models = new Map<string, unknown>();
  const prisma = new Proxy(
    {},
    {
      get: (_t, prop: string | symbol) => {
        if (typeof prop === 'symbol' || prop === 'then') return undefined;
        if (prop === '$queryRaw') {
          let m = mocks.get('$queryRaw');
          if (!m) {
            m = jest.fn(() => Promise.resolve([])) as AnyMock;
            mocks.set('$queryRaw', m);
          }
          return m;
        }
        if (!models.has(prop)) {
          models.set(
            prop,
            new Proxy(
              {},
              {
                get: (_m, op: string | symbol) =>
                  typeof op === 'symbol' || op === 'then'
                    ? undefined
                    : mockFor(`${prop}.${op}`, op),
              },
            ),
          );
        }
        return models.get(prop);
      },
    },
  ) as Record<string, Record<string, AnyMock>> & { $queryRaw: AnyMock };

  const calls = (): RecordedCall[] =>
    [...mocks.entries()].flatMap(([name, m]) =>
      m.mock.calls.map((args) => ({ name, args })),
    );

  /** How many times one method ran, e.g. `ran('flightBooking.findMany')`. */
  const ran = (name: string): number => mocks.get(name)?.mock.calls.length ?? 0;

  return { prisma, calls, ran };
}

/**
 * Every query that ran must mention the tenant id somewhere in its arguments
 * (where-clause, relation filter or raw-SQL bind value). `allow` lists
 * "model.method" names that are deliberately not tenant-keyed (e.g. the lookup
 * of the caller's own staff row by identity id) so each exception is explicit.
 */
export function expectEveryQueryTenantScoped(
  calls: RecordedCall[],
  tenantId: string,
  allow: string[] = [],
): void {
  expect(calls.length).toBeGreaterThan(0); // never pass vacuously
  const offenders = calls
    .filter((c) => !allow.includes(c.name))
    .filter((c) => !JSON.stringify(c.args).includes(tenantId))
    .map((c) => `${c.name}(${JSON.stringify(c.args).slice(0, 160)})`);
  expect(offenders).toEqual([]);
}

/** The inverse, for SUPER_ADMIN: no tenant id is invented where none applies. */
export function expectNoQueryMentions(
  calls: RecordedCall[],
  needle: string,
): void {
  expect(calls.length).toBeGreaterThan(0);
  expect(calls.filter((c) => JSON.stringify(c.args).includes(needle))).toEqual(
    [],
  );
}

export const authUser = (
  roles: string[],
  companyId: string | null = 'co-A',
  sub = 'identity-1',
): AuthContext =>
  ({
    sub,
    type: 'STAFF',
    roles,
    permissions: [],
    companyId,
    sessionId: null,
  }) as unknown as AuthContext;
