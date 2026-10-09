import type { TenantKind } from './tenant-guard.service';

export const TENANT_SCOPED_KEY = 'tenantScoped';

export interface TenantScopeSpec {
  /** What kind of record the value names (see TENANT_SCOPES). Omit when `kindBy` decides. */
  kind?: TenantKind;
  /**
   * For routes like /checkin/:type/:id where another param says what the id is: the value of
   * `params[param]` picks the kind from `map` (an unknown value is skipped, not guessed).
   */
  kindBy?: { param: string; map: Record<string, TenantKind> };
  /** Request property holding the id; defaults to the route param `id`. */
  param?: string;
  /** Where to read it from; defaults to the route params. */
  source?: 'params' | 'body' | 'query';
}

/**
 * Declares that a route (or every route of a controller) names tenant-owned records, and which ones.
 * `TenantResourceGuard` then refuses the request with 404 when a non-SUPER_ADMIN caller names a
 * record of another company — before any controller or service code runs.
 *
 *   @TenantScoped('flightBooking')                       // :id param
 *   @TenantScoped({ kind: 'customer', param: 'customerId' })
 *   @TenantScoped({ kind: 'customer', param: 'customerId', source: 'body' })
 *
 * Several specs may be given. A missing value is skipped (an optional filter or an absent field),
 * never treated as "all records".
 */
export const TenantScoped =
  (...specs: Array<TenantKind | TenantScopeSpec>) =>
  (
    target: object,
    _key?: string | symbol,
    descriptor?: TypedPropertyDescriptor<unknown>,
  ): void => {
    const holder: object = (descriptor?.value as object | undefined) ?? target;
    const added = specs.map((spec): TenantScopeSpec =>
      typeof spec === 'string' ? { kind: spec } : spec,
    );
    // Several @TenantScoped on one route accumulate (SetMetadata would let the last one win).
    const existing =
      (Reflect.getMetadata(TENANT_SCOPED_KEY, holder) as
        TenantScopeSpec[] | undefined) ?? [];
    Reflect.defineMetadata(TENANT_SCOPED_KEY, [...existing, ...added], holder);
  };
