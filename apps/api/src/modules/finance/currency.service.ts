import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateCurrencyDto } from './dto/create-currency.dto';
import { UpdateCurrencyDto } from './dto/update-currency.dto';

/**
 * Phase 11 spec #21 — platform-wide currency reference data (code, symbol,
 * decimal places, exchange rate to the platform base currency). Genuinely
 * platform-wide, not tenant-scoped: unlike a FlightSupplier's negotiated
 * terms, an ISO 4217 code and its exchange rate are facts about the world
 * every tenant shares, not private business data — see the schema's own
 * "relative to the platform base currency" comment on exchangeRateToBase.
 * Every booking module keeps storing its own transaction currency exactly
 * as before; this table is a lookup/reference, never authoritative over
 * an already-recorded amount.
 */
@Injectable()
export class CurrencyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  listAll(activeOnly?: boolean) {
    return this.prisma.currency.findMany({
      where: activeOnly ? { isActive: true } : undefined,
      orderBy: { code: 'asc' },
    });
  }

  async get(code: string) {
    const currency = await this.prisma.currency.findUnique({
      where: { code: code.toUpperCase() },
    });
    if (!currency) throw new NotFoundException('Currency not found');
    return currency;
  }

  async create(dto: CreateCurrencyDto, actorIdentityId?: string) {
    const code = dto.code.toUpperCase();
    const existing = await this.prisma.currency.findUnique({ where: { code } });
    if (existing) {
      throw new ConflictException(`Currency ${code} is already registered`);
    }

    const currency = await this.prisma.currency.create({
      data: { ...dto, code },
    });

    await this.auditService.record({
      identityId: actorIdentityId,
      action: 'currency.created',
      entityType: 'Currency',
      entityId: currency.code,
      metadata: { code },
    });

    return currency;
  }

  async update(code: string, dto: UpdateCurrencyDto, actorIdentityId?: string) {
    const currency = await this.get(code);

    const updated = await this.prisma.currency.update({
      where: { code: currency.code },
      data: dto,
    });

    await this.auditService.record({
      identityId: actorIdentityId,
      action: 'currency.updated',
      entityType: 'Currency',
      entityId: currency.code,
      metadata: { changes: { ...dto } },
    });

    return updated;
  }
}
