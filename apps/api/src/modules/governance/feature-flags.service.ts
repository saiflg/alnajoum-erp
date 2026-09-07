import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CreateFeatureFlagDto } from './dto/create-feature-flag.dto';

/**
 * Spec #39 — a flag with no per-tenant override falls back to
 * isEnabledByDefault; overrides are additive and never bypass a
 * permission check (spec #39's own explicit warning) — every gated call
 * site still runs its normal RBAC guard regardless of a flag's state.
 */
@Injectable()
export class FeatureFlagsService {
  constructor(private readonly prisma: PrismaService) {}

  async listAll(companyId?: string) {
    // A sentinel that can never match a real Company id when none is
    // given, rather than a conditional `include` shape — keeps Prisma's
    // inferred return type single-shaped instead of a hard-to-type union.
    const flags = await this.prisma.featureFlag.findMany({
      orderBy: { key: 'asc' },
      include: { overrides: { where: { companyId: companyId ?? '__none__' } } },
    });
    return flags.map((flag) => ({
      id: flag.id,
      key: flag.key,
      description: flag.description,
      isEnabledByDefault: flag.isEnabledByDefault,
      isEnabled:
        flag.overrides.length > 0
          ? flag.overrides[0].isEnabled
          : flag.isEnabledByDefault,
    }));
  }

  create(dto: CreateFeatureFlagDto) {
    return this.prisma.featureFlag.create({ data: dto });
  }

  /** The single call every gated code path uses — cheap enough (one
   * indexed lookup, falling back to the flag's own default) to call
   * inline rather than caching, given this platform's scale. */
  async isEnabled(key: string, companyId?: string | null): Promise<boolean> {
    const flag = await this.prisma.featureFlag.findUnique({ where: { key } });
    if (!flag) return false; // an unregistered key is never silently "on"
    if (!companyId) return flag.isEnabledByDefault;

    const override = await this.prisma.featureFlagOverride.findUnique({
      where: { featureFlagId_companyId: { featureFlagId: flag.id, companyId } },
    });
    return override?.isEnabled ?? flag.isEnabledByDefault;
  }

  async setOverride(key: string, companyId: string, isEnabled: boolean) {
    const flag = await this.prisma.featureFlag.findUnique({ where: { key } });
    if (!flag) throw new NotFoundException('Feature flag not found');

    return this.prisma.featureFlagOverride.upsert({
      where: { featureFlagId_companyId: { featureFlagId: flag.id, companyId } },
      create: { featureFlagId: flag.id, companyId, isEnabled },
      update: { isEnabled },
    });
  }

  async clearOverride(key: string, companyId: string): Promise<void> {
    const flag = await this.prisma.featureFlag.findUnique({ where: { key } });
    if (!flag) throw new NotFoundException('Feature flag not found');
    await this.prisma.featureFlagOverride.deleteMany({
      where: { featureFlagId: flag.id, companyId },
    });
  }
}
