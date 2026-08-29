import { BadRequestException, Injectable } from '@nestjs/common';
import { IntegrationCategory } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { INTEGRATION_CATALOG } from './integration-catalog';

@Injectable()
export class IntegrationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

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
    return (row?.config as Record<string, string>) ?? null;
  }

  /** Internal use only — which provider is currently active for a
   * category, or null if the operator hasn't chosen one yet (callers fall
   * back to the FLIGHT_PROVIDER/PAYMENT_PROVIDER/NOTIFICATION_PROVIDER env
   * var default in that case). */
  async getActiveProvider(category: IntegrationCategory): Promise<string | null> {
    const row = await this.prisma.integrationCredential.findFirst({
      where: { category, isActive: true },
    });
    return row?.provider ?? null;
  }

  private assertKnownProvider(category: IntegrationCategory, provider: string): void {
    const known = INTEGRATION_CATALOG[category].some((p) => p.provider === provider);
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

    const existing = await this.prisma.integrationCredential.findUnique({
      where: { category_provider: { category, provider } },
    });
    const mergedConfig = { ...((existing?.config as Record<string, string>) ?? {}), ...config };

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
