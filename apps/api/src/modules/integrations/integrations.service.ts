import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { IntegrationCategory } from '@prisma/client';
import { FieldCipher } from '../../common/security/field-cipher';
import {
  assertSafeHost,
  assertSafeHttpUrl,
} from '../../common/security/outbound-target';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { INTEGRATION_CATALOG } from './integration-catalog';

const MAX_VALUE_LENGTH = 2000;

/** Where a value lives, bound into its ciphertext so it cannot be replayed into another field/row. */
const contextOf = (category: string, provider: string, key: string) =>
  `integration:${category}:${provider}:${key}`;

@Injectable()
export class IntegrationsService implements OnModuleInit {
  private readonly logger = new Logger(IntegrationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Secrets saved before encryption existed are plaintext. Re-save them encrypted once at startup so
   * nothing sensitive stays readable in the database; a failure here must never stop the API booting.
   */
  async onModuleInit(): Promise<void> {
    try {
      const cipher = FieldCipher.default();
      const rows = await this.prisma.integrationCredential.findMany();
      for (const row of rows) {
        const spec = INTEGRATION_CATALOG[row.category]?.find(
          (p) => p.provider === row.provider,
        );
        const config = (row.config ?? {}) as Record<string, string>;
        let changed = false;
        const next: Record<string, string> = { ...config };
        for (const field of spec?.fields ?? []) {
          const value = config[field.key];
          if (
            field.secret &&
            typeof value === 'string' &&
            value &&
            cipher.needsRotation(value)
          ) {
            next[field.key] = cipher.rotate(
              value,
              contextOf(row.category, row.provider, field.key),
            );
            changed = true;
          }
        }
        if (changed) {
          await this.prisma.integrationCredential.update({
            where: { id: row.id },
            data: { config: next },
          });
        }
      }
    } catch (error) {
      this.logger.error(
        `Could not encrypt stored integration secrets: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /** For the settings UI: which providers exist for this category, whether
   * each has credentials saved, and which one is active — never the actual
   * secret values. */
  async listForCategory(category: IntegrationCategory) {
    const spec = INTEGRATION_CATALOG[category];
    const rows = await this.prisma.integrationCredential.findMany({
      where: { category },
    });
    const byProvider = new Map(rows.map((r) => [r.provider, r]));

    return spec.map((p) => {
      const row = byProvider.get(p.provider);
      const config = (row?.config as Record<string, string>) ?? {};
      return {
        provider: p.provider,
        label: p.label,
        implemented: p.implemented,
        docsUrl: p.docsUrl,
        fields: p.fields,
        isActive: row?.isActive ?? false,
        // Per-field "is something saved", never the value itself.
        configuredFields: p.fields
          .filter((f) => Boolean(config[f.key]))
          .map((f) => f.key),
        updatedAt: row?.updatedAt ?? null,
      };
    });
  }

  /** Internal use only (called by provider routers) — the real secret
   * values, never returned through a controller. */
  async getCredentialConfig(
    category: IntegrationCategory,
    provider: string,
  ): Promise<Record<string, string> | null> {
    const row = await this.prisma.integrationCredential.findUnique({
      where: { category_provider: { category, provider } },
    });
    if (!row?.config) return null;
    const stored = row.config as Record<string, string>;
    const secretKeys = new Set(
      INTEGRATION_CATALOG[category]
        ?.find((p) => p.provider === provider)
        ?.fields.filter((f) => f.secret)
        .map((f) => f.key) ?? [],
    );
    const cipher = FieldCipher.default();
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(stored)) {
      out[key] =
        secretKeys.has(key) && typeof value === 'string'
          ? cipher.decryptIfEncrypted(value, contextOf(category, provider, key))
          : value;
    }
    return out;
  }

  /** Internal use only — which provider is currently active for a
   * category, or null if the operator hasn't chosen one yet (callers fall
   * back to the FLIGHT_PROVIDER/PAYMENT_PROVIDER/NOTIFICATION_PROVIDER env
   * var default in that case). */
  async getActiveProvider(
    category: IntegrationCategory,
  ): Promise<string | null> {
    const row = await this.prisma.integrationCredential.findFirst({
      where: { category, isActive: true },
    });
    return row?.provider ?? null;
  }

  private assertKnownProvider(
    category: IntegrationCategory,
    provider: string,
  ): void {
    const known = INTEGRATION_CATALOG[category].some(
      (p) => p.provider === provider,
    );
    if (!known) {
      throw new BadRequestException(
        `Unknown provider "${provider}" for ${category}`,
      );
    }
  }

  /** Merges into any existing saved config, so updating one field doesn't
   * require resending every other one. */
  async upsertCredential(
    category: IntegrationCategory,
    provider: string,
    config: Record<string, string>,
    actorIdentityId: string | undefined,
  ): Promise<void> {
    this.assertKnownProvider(category, provider);

    // Only the fields this provider actually defines, as short strings. The body used to be an
    // arbitrary object stored as-is.
    const spec = INTEGRATION_CATALOG[category].find(
      (p) => p.provider === provider,
    )!;
    const fields = new Map(spec.fields.map((f) => [f.key, f]));
    for (const [key, value] of Object.entries(config)) {
      if (!fields.has(key)) {
        throw new BadRequestException(
          `"${key}" is not a setting of ${provider}`,
        );
      }
      if (typeof value !== 'string' || value.length > MAX_VALUE_LENGTH) {
        throw new BadRequestException(
          `"${key}" must be text of at most ${MAX_VALUE_LENGTH} characters`,
        );
      }
      if (value && key === 'baseUrl') assertSafeHttpUrl(value, key);
      if (value && key === 'host') assertSafeHost(value, key);
    }

    const existing = await this.prisma.integrationCredential.findUnique({
      where: { category_provider: { category, provider } },
    });
    const mergedConfig: Record<string, string> = {
      ...((existing?.config as Record<string, string>) ?? {}),
    };
    const cipher = FieldCipher.default();
    for (const [key, value] of Object.entries(config)) {
      mergedConfig[key] =
        fields.get(key)!.secret && value
          ? cipher.encrypt(value, contextOf(category, provider, key))
          : value;
    }
    // Anything already stored in plaintext or under an older key is brought up to the current key.
    for (const field of spec.fields) {
      const v = mergedConfig[field.key];
      if (
        field.secret &&
        typeof v === 'string' &&
        v &&
        cipher.needsRotation(v)
      ) {
        mergedConfig[field.key] = cipher.rotate(
          v,
          contextOf(category, provider, field.key),
        );
      }
    }

    await this.prisma.integrationCredential.upsert({
      where: { category_provider: { category, provider } },
      create: { category, provider, config: mergedConfig },
      update: { config: mergedConfig },
    });

    await this.auditService.record({
      identityId: actorIdentityId,
      action: 'integration.credential_updated',
      entityType: 'IntegrationCredential',
      entityId: `${category}:${provider}`,
      // Field names only, never values — same redaction as the read path.
      metadata: { category, provider, fields: Object.keys(config) },
    });
  }

  async setActive(
    category: IntegrationCategory,
    provider: string,
    actorIdentityId: string | undefined,
  ): Promise<void> {
    this.assertKnownProvider(category, provider);

    await this.prisma.$transaction([
      this.prisma.integrationCredential.updateMany({
        where: { category },
        data: { isActive: false },
      }),
      this.prisma.integrationCredential.upsert({
        where: { category_provider: { category, provider } },
        create: { category, provider, isActive: true },
        update: { isActive: true },
      }),
    ]);

    await this.auditService.record({
      identityId: actorIdentityId,
      action: 'integration.activated',
      entityType: 'IntegrationCredential',
      entityId: `${category}:${provider}`,
      metadata: { category, provider },
    });
  }
}
