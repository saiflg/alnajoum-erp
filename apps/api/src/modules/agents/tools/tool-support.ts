import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { MoneyValue, Principal, ToolField } from '../agent.types';

/** A tool refused or failed in a way the runtime should report plainly (never a stack trace). */
export class ToolError extends Error {
  constructor(
    public readonly code:
      | 'NOT_FOUND'
      | 'FORBIDDEN'
      | 'INVALID_INPUT'
      | 'UNAVAILABLE'
      | 'CONFLICT'
      | 'NEEDS_CONFIRMATION',
    message: string,
  ) {
    super(message);
  }
}

export const money = (amount: number, currency: string): MoneyValue => ({
  amount,
  currency,
});

/**
 * Resolves which customer a tool acts on, enforcing the principal's limits in one place:
 *  - a CUSTOMER principal is always their own customer record; naming anyone else is refused as if it did not
 *    exist;
 *  - staff must name a customer who belongs to their company (NotFound, never Forbidden, across tenants) and,
 *    if they are confined to a branch, one assigned to their branch or to no branch yet;
 *  - the platform Super Admin is not confined to a company.
 */
export async function resolveCustomer(
  prisma: PrismaService,
  principal: Principal,
  requested: unknown,
): Promise<{
  id: string;
  companyId: string;
  firstName: string;
  lastName: string;
  preferredLanguage: string | null;
}> {
  const asked =
    typeof requested === 'string' && requested ? requested : undefined;
  let id: string | undefined;
  if (principal.kind === 'CUSTOMER') {
    if (!principal.customerId)
      throw new ToolError('FORBIDDEN', 'You are not signed in as a customer');
    if (asked && asked !== principal.customerId)
      throw new ToolError('NOT_FOUND', 'Customer not found');
    id = principal.customerId;
  } else {
    id = asked;
  }
  if (!id)
    throw new ToolError(
      'INVALID_INPUT',
      'Which customer? A customerId is needed',
    );
  const c = await prisma.customer.findFirst({
    where: {
      id,
      ...(principal.isSuperAdmin && !principal.companyId
        ? {}
        : { companyId: principal.companyId ?? '__none__' }),
    },
    select: {
      id: true,
      companyId: true,
      firstName: true,
      lastName: true,
      preferredLanguage: true,
      assignedBranchId: true,
    },
  });
  if (!c) throw new ToolError('NOT_FOUND', 'Customer not found');
  if (
    principal.kind === 'STAFF' &&
    principal.branchLimited &&
    principal.branchId &&
    c.assignedBranchId &&
    c.assignedBranchId !== principal.branchId
  ) {
    throw new ToolError('NOT_FOUND', 'Customer not found');
  }
  return c;
}

/** Validates a tool's input against its declared fields. Unknown fields are rejected. */
export function validateInput(
  fields: Record<string, ToolField>,
  input: Record<string, unknown>,
): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(input ?? {})) {
    if (!(key in fields)) return { ok: false, error: `Unknown field "${key}"` };
  }
  for (const [key, f] of Object.entries(fields)) {
    const v = input?.[key];
    if (v === undefined || v === null || v === '') {
      if (f.required) return { ok: false, error: `"${key}" is required` };
      continue;
    }
    switch (f.type) {
      case 'string':
        if (typeof v !== 'string')
          return { ok: false, error: `"${key}" must be text` };
        if (v.length > (f.maxLength ?? 500))
          return { ok: false, error: `"${key}" is too long` };
        if (f.enum && !f.enum.includes(v))
          return {
            ok: false,
            error: `"${key}" must be one of ${f.enum.join(', ')}`,
          };
        break;
      case 'date':
        if (
          typeof v !== 'string' ||
          !/^\d{4}-\d{2}-\d{2}/.test(v) ||
          Number.isNaN(Date.parse(v))
        )
          return {
            ok: false,
            error: `"${key}" must be a date like 2026-10-10`,
          };
        break;
      case 'number': {
        if (typeof v !== 'number' || !Number.isFinite(v))
          return { ok: false, error: `"${key}" must be a number` };
        if (f.min !== undefined && v < f.min)
          return { ok: false, error: `"${key}" is too small` };
        if (f.max !== undefined && v > f.max)
          return { ok: false, error: `"${key}" is too large` };
        break;
      }
      case 'boolean':
        if (typeof v !== 'boolean')
          return { ok: false, error: `"${key}" must be true or false` };
        break;
      case 'object':
        if (typeof v !== 'object' || Array.isArray(v))
          return { ok: false, error: `"${key}" must be an object` };
        break;
      case 'array':
        if (!Array.isArray(v) || v.length > 50)
          return { ok: false, error: `"${key}" must be a short list` };
        break;
    }
    out[key] = v;
  }
  return { ok: true, value: out };
}
