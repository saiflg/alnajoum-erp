import { Prisma } from '@prisma/client';
import { TENANT_SCOPES } from './tenant-guard.service';

/**
 * Every tenant scope is a Prisma `where` that is only ever evaluated against a real database at request
 * time. A typo in a relation name (a field that does not exist on the model) is invisible to the compiler and
 * to mocked unit tests, and turns every request for that kind of record into a 500. This walks each scope
 * against the generated schema and fails on any field or relation that does not exist.
 */
const models = new Map(
  Prisma.dmmf.datamodel.models.map((m) => [m.name.toLowerCase(), m]),
);
const byName = new Map(Prisma.dmmf.datamodel.models.map((m) => [m.name, m]));
const LOGICAL = new Set(['AND', 'OR', 'NOT']);

function problems(modelName: string, where: unknown, path: string): string[] {
  const model = byName.get(modelName);
  if (!model) return [`${path}: unknown model ${modelName}`];
  const out: string[] = [];
  if (typeof where !== 'object' || where === null) return out;
  for (const [key, value] of Object.entries(where as Record<string, unknown>)) {
    if (LOGICAL.has(key)) {
      for (const part of Array.isArray(value) ? value : [value]) {
        out.push(...problems(modelName, part, `${path}.${key}`));
      }
      continue;
    }
    const field = model.fields.find((f) => f.name === key);
    if (!field) {
      out.push(`${path}: "${key}" is not a field of ${modelName}`);
      continue;
    }
    if (
      field.kind === 'object' &&
      typeof value === 'object' &&
      value !== null
    ) {
      out.push(...problems(field.type, value, `${path}.${key}`));
    }
  }
  return out;
}

describe('tenant scopes match the Prisma schema', () => {
  for (const [kind, def] of Object.entries(TENANT_SCOPES)) {
    it(`${kind}`, () => {
      const model = models.get(def.model.toLowerCase());
      expect(model).toBeDefined();
      expect(problems(model!.name, def.scope('company-1'), kind)).toEqual([]);
    });
  }
});
