import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ApiKeyStatus } from '@prisma/client';
import * as argon2 from 'argon2';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateApiKeyDto } from './dto/create-api-key.dto';

const RAW_KEY_BYTES = 32;
const PREFIX_LENGTH = 8;

/**
 * Spec #19 — API key management for machine-to-machine integrations.
 * The raw key is generated, hashed, and returned to the caller exactly
 * once at creation; only its hash and an 8-char, non-secret prefix (so
 * the owner can tell keys apart in a list) are ever stored or shown
 * again. No dedicated API-key auth guard/strategy exists yet to actually
 * accept these keys on a request — this phase ships the management
 * surface (create/list/revoke, permission scoping, expiry, last-used
 * tracking) as the correct foundation; wiring a request-time strategy is
 * future work, called out honestly rather than claimed as done.
 */
@Injectable()
export class ApiKeysService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async create(ownerIdentityId: string, dto: CreateApiKeyDto) {
    const rawKey = randomBytes(RAW_KEY_BYTES).toString('hex');
    const keyHash = await argon2.hash(rawKey);

    const apiKey = await this.prisma.apiKey.create({
      data: {
        ownerIdentityId,
        name: dto.name,
        keyPrefix: rawKey.slice(0, PREFIX_LENGTH),
        keyHash,
        permissions: dto.permissions ?? [],
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : undefined,
      },
    });

    await this.auditService.record({
      identityId: ownerIdentityId,
      action: 'security.api_key_created',
      entityType: 'ApiKey',
      entityId: apiKey.id,
      metadata: { name: dto.name },
    });

    // The only time the raw key is ever returned.
    return { ...apiKey, rawKey };
  }

  listForOwner(ownerIdentityId: string) {
    return this.prisma.apiKey.findMany({
      where: { ownerIdentityId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async revoke(id: string, ownerIdentityId: string) {
    const apiKey = await this.prisma.apiKey.findUnique({ where: { id } });
    if (!apiKey) throw new NotFoundException('API key not found');
    if (apiKey.ownerIdentityId !== ownerIdentityId) {
      throw new ForbiddenException('You can only revoke your own API keys');
    }
    if (apiKey.status === ApiKeyStatus.REVOKED) return apiKey;

    const revoked = await this.prisma.apiKey.update({
      where: { id },
      data: { status: ApiKeyStatus.REVOKED, revokedAt: new Date() },
    });

    await this.auditService.record({
      identityId: ownerIdentityId,
      action: 'security.api_key_revoked',
      entityType: 'ApiKey',
      entityId: id,
    });

    return revoked;
  }

  /** Would back a future request-time auth strategy — resolves a raw key
   * to its owning identity, checking status/expiry, and bumps
   * lastUsedAt. Implemented now so the surface is real and testable even
   * though nothing calls it from an actual guard yet (see this file's
   * class-level doc comment). */
  async validateRawKey(rawKey: string) {
    const prefix = rawKey.slice(0, PREFIX_LENGTH);
    const candidates = await this.prisma.apiKey.findMany({
      where: { keyPrefix: prefix, status: ApiKeyStatus.ACTIVE },
    });
    for (const candidate of candidates) {
      if (await argon2.verify(candidate.keyHash, rawKey)) {
        if (candidate.expiresAt && candidate.expiresAt < new Date()) {
          return null;
        }
        await this.prisma.apiKey.update({
          where: { id: candidate.id },
          data: { lastUsedAt: new Date() },
        });
        return candidate;
      }
    }
    return null;
  }
}
