import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NfcReaderDevice } from '@prisma/client';
import { createHash, randomBytes } from 'node:crypto';
import { FieldCipher } from '../../common/security/field-cipher';
import { isProductionEnv } from '../../common/security/runtime-environment';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NfcProfileDto, NfcReaderDto, PrepareNfcDto } from './dto/nfc.dto';
import {
  CHIP_CAPABILITIES,
  ChipType,
  newNfcReference,
  nfcUrl,
  normaliseUid,
  planEncoding,
  referenceFromPayload,
  uidHint,
} from './nfc.ndef';

export interface NfcActor {
  identityId: string;
}

const sha = (v: string) => createHash('sha256').update(v).digest('hex');

/**
 * Chip profiles, readers, and the issuance workflow for the NFC half of a card:
 *
 *   prepare  -> a random reference and the exact NDEF bytes to write (status PREPARED)
 *   write    -> done by a compatible reader or phone, outside this server
 *   confirm  -> the writer reports what it read back; only an exact match marks the chip VERIFIED
 *   activate -> allowed once the chip is VERIFIED (a card that has an NFC chip cannot be activated before)
 *
 * Nothing personal is ever written to the chip: only the reference, inside an https address.
 */
@Injectable()
export class StaffCardNfcService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  private origin(): string {
    return this.config.get<string>(
      'PUBLIC_WEB_ORIGIN',
      'http://localhost:3000',
    );
  }

  private withCapability<T extends { chipType: string }>(p: T) {
    return { ...p, capability: CHIP_CAPABILITIES[p.chipType as ChipType] };
  }

  // ---------------------------------------------------------------------------------------------- capabilities

  capabilities() {
    return Object.entries(CHIP_CAPABILITIES).map(([chipType, c]) => ({
      chipType,
      ...c,
    }));
  }

  // ---------------------------------------------------------------------------------------------- profiles

  async listProfiles(companyId: string) {
    const rows = await this.prisma.nfcCardProfile.findMany({
      where: { companyId },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
      include: { _count: { select: { credentials: true } } },
    });
    return rows.map((r) => this.withCapability(r));
  }

  async saveProfile(
    companyId: string,
    dto: NfcProfileDto,
    actor: NfcActor,
    id?: string,
  ) {
    const data = {
      name: dto.name.trim(),
      chipType: dto.chipType,
      frequency: dto.frequency?.trim() || '13.56 MHz ISO/IEC 14443',
      cardStock: dto.cardStock?.trim() || null,
      readerModel: dto.readerModel?.trim() || null,
      compatibilityNotes: dto.compatibilityNotes?.trim() || null,
      ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
    };
    try {
      const row = await this.prisma.$transaction(async (tx) => {
        if (id) {
          const cur = await tx.nfcCardProfile.findFirst({
            where: { id, companyId },
          });
          if (!cur) throw new NotFoundException('Profile not found');
          // A profile already written to cards keeps its chip type: changing it would misdescribe those cards.
          const used = await tx.staffIdCardNfc.count({
            where: { profileId: id },
          });
          if (used > 0 && dto.chipType !== cur.chipType)
            throw new ConflictException(
              'Cards have already been written with this profile. Create a new profile for a different chip.',
            );
        }
        if (dto.isDefault)
          await tx.nfcCardProfile.updateMany({
            where: { companyId, isDefault: true },
            data: { isDefault: false },
          });
        return id
          ? tx.nfcCardProfile.update({
              where: { id },
              data: {
                ...data,
                ...(dto.isDefault !== undefined
                  ? { isDefault: dto.isDefault }
                  : {}),
              },
            })
          : tx.nfcCardProfile.create({
              data: {
                ...data,
                companyId,
                isDefault: dto.isDefault ?? false,
                createdByIdentityId: actor.identityId,
              },
            });
      });
      await this.audit.record({
        identityId: actor.identityId,
        companyId,
        action: id
          ? 'staff_card.nfc_profile_updated'
          : 'staff_card.nfc_profile_created',
        entityType: 'NfcCardProfile',
        entityId: row.id,
        metadata: { chipType: row.chipType },
      });
      return this.withCapability(row);
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002')
        throw new ConflictException('A profile with this name already exists.');
      throw e;
    }
  }

  // ---------------------------------------------------------------------------------------------- readers

  async listReaders(companyId: string) {
    const rows = await this.prisma.nfcReaderDevice.findMany({
      where: { companyId },
      orderBy: { name: 'asc' },
    });
    const now = Date.now();
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      model: r.model,
      adapter: r.adapter,
      location: r.location,
      isActive: r.isActive,
      simulated: r.adapter === 'MOCK',
      hasBridgeToken: !!r.tokenHash,
      lastSeenAt: r.lastSeenAt,
      lastCardAt: r.lastCardAt,
      lastResult: r.lastResult,
      lastError: r.lastError,
      // A reader that has not reported for two minutes is shown as disconnected, whatever it last said.
      status:
        !r.lastSeenAt || now - r.lastSeenAt.getTime() > 120_000
          ? 'DISCONNECTED'
          : (r.lastStatus ?? 'DISCONNECTED'),
      compatibility: this.compatibility(r),
    }));
  }

  private compatibility(r: Pick<NfcReaderDevice, 'adapter' | 'model'>): string {
    switch (r.adapter) {
      case 'MOCK':
        return 'Labelled mock reader for tests. It reads nothing from a real card.';
      case 'WEB_NFC':
        return 'Works only in Chrome on Android over HTTPS (or localhost) with the phone’s NFC switched on. Not available in desktop browsers or on iPhone.';
      case 'KEYBOARD_WEDGE':
        return 'Only for readers that are set to type what they read, followed by Enter. Most USB NFC readers are PC/SC devices and do NOT do this.';
      case 'PCSC_BRIDGE':
        return 'Needs the local bridge program running on the computer the reader is plugged into, and the reader’s PC/SC driver installed. Not yet tested on hardware.';
      case 'VENDOR_SDK':
        return 'Needs the reader maker’s SDK and a small program that posts reads to the bridge address. Not yet tested on hardware.';
      case 'ANDROID_APP':
        return 'Needs a companion app on an NFC-capable Android phone. Not yet built or tested.';
    }
  }

  /** Registers a reader. Bridge-type readers receive a one-time secret; only its hash is kept. */
  async createReader(companyId: string, dto: NfcReaderDto, actor: NfcActor) {
    const needsToken = ['PCSC_BRIDGE', 'VENDOR_SDK', 'ANDROID_APP'].includes(
      dto.adapter,
    );
    const token = needsToken ? randomBytes(24).toString('base64url') : null;
    try {
      const row = await this.prisma.nfcReaderDevice.create({
        data: {
          companyId,
          name: dto.name.trim(),
          model: dto.model?.trim() || null,
          adapter: dto.adapter,
          location: dto.location?.trim() || null,
          tokenHash: token ? sha(token) : null,
          createdByIdentityId: actor.identityId,
        },
      });
      await this.audit.record({
        identityId: actor.identityId,
        companyId,
        action: 'staff_card.nfc_reader_created',
        entityType: 'NfcReaderDevice',
        entityId: row.id,
        metadata: { adapter: row.adapter },
      });
      return {
        id: row.id,
        name: row.name,
        adapter: row.adapter,
        bridgeToken: token ?? undefined,
        note: token
          ? 'Copy this secret into the bridge program now. It is not shown again.'
          : undefined,
      };
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002')
        throw new ConflictException('A reader with this name already exists.');
      throw e;
    }
  }

  async setReaderActive(
    companyId: string,
    id: string,
    isActive: boolean,
    actor: NfcActor,
  ) {
    const r = await this.prisma.nfcReaderDevice.updateMany({
      where: { id, companyId },
      data: { isActive },
    });
    if (r.count === 0) throw new NotFoundException('Reader not found');
    await this.audit.record({
      identityId: actor.identityId,
      companyId,
      action: isActive
        ? 'staff_card.nfc_reader_enabled'
        : 'staff_card.nfc_reader_disabled',
      entityType: 'NfcReaderDevice',
      entityId: id,
    });
    return { id, isActive };
  }

  /** A browser adapter (or a signed-in person) reports what its reader is doing. Only for the caller's own company. */
  async report(
    companyId: string,
    id: string,
    status: 'CONNECTED' | 'DISCONNECTED' | 'ERROR',
    error?: string,
  ) {
    const r = await this.prisma.nfcReaderDevice.updateMany({
      where: { id, companyId, isActive: true },
      data: {
        lastSeenAt: new Date(),
        lastStatus: status,
        lastError:
          status === 'ERROR'
            ? (error ?? 'Unknown reader error').slice(0, 300)
            : null,
      },
    });
    if (r.count === 0)
      throw new NotFoundException('Reader not found or switched off');
    return { ok: true };
  }

  /** A bridge program identifies itself with its secret. Returns the reader, or null for anything unknown or off. */
  async readerForToken(token: string): Promise<NfcReaderDevice | null> {
    if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
    const r = await this.prisma.nfcReaderDevice.findUnique({
      where: { tokenHash: sha(token) },
    });
    return r && r.isActive ? r : null;
  }

  // ---------------------------------------------------------------------------------------------- issuance

  private async cardOf(companyId: string, cardId: string) {
    const card = await this.prisma.staffIdCard.findFirst({
      where: { id: cardId, companyId },
      include: {
        nfc: true,
        staff: {
          select: {
            isActive: true,
            firstName: true,
            lastName: true,
            employeeCode: true,
          },
        },
      },
    });
    if (!card) throw new NotFoundException('Card not found');
    return card;
  }

  /**
   * Step 1. Creates (or re-creates, after a failed attempt) the chip's reference and says exactly what to write.
   * A chip that is already confirmed is not overwritten: revoke or replace the card first.
   */
  async prepare(
    companyId: string,
    cardId: string,
    dto: PrepareNfcDto,
    actor: NfcActor,
  ) {
    const card = await this.cardOf(companyId, cardId);
    if (!['PENDING', 'ACTIVE'].includes(card.status))
      throw new ConflictException(
        'Only a pending or active card can be given an NFC chip.',
      );
    if (!card.staff.isActive)
      throw new ConflictException('This staff member is deactivated.');
    if (card.nfc?.status === 'VERIFIED')
      throw new ConflictException(
        'This card already has a confirmed NFC chip. Replace the card to use a different chip.',
      );

    const profile = dto.profileId
      ? await this.prisma.nfcCardProfile.findFirst({
          where: { id: dto.profileId, companyId, isActive: true },
        })
      : await this.prisma.nfcCardProfile.findFirst({
          where: { companyId, isActive: true },
          orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
        });
    if (!profile)
      throw new BadRequestException(
        'Record the card and chip type first (NFC settings, then Chip profiles).',
      );

    const reference = newNfcReference();
    const url = nfcUrl(this.origin(), reference);
    if (isProductionEnv() && !url.startsWith('https://'))
      throw new BadRequestException(
        'The site address (PUBLIC_WEB_ORIGIN) must start with https:// before cards are written. Set it first.',
      );
    let plan: ReturnType<typeof planEncoding>;
    try {
      plan = planEncoding(url, profile.chipType);
    } catch (e) {
      throw new BadRequestException(
        `${(e as Error).message} The site address (PUBLIC_WEB_ORIGIN) is ${this.origin()}.`,
      );
    }
    if (plan.fits === false)
      throw new BadRequestException(
        `The address (${plan.bytes} bytes) does not fit this chip.`,
      );

    const cred = await this.prisma.$transaction(async (tx) => {
      // An abandoned attempt's reference is retired for good: it can never verify anything.
      if (card.nfc) await tx.staffIdCardNfc.delete({ where: { cardId } });
      const row = await tx.staffIdCardNfc.create({
        data: {
          cardId,
          companyId,
          profileId: profile.id,
          reference,
          ndefUrl: url,
          batch: dto.batch?.trim() || null,
          createdByIdentityId: actor.identityId,
        },
      });
      await tx.staffIdCardEvent.create({
        data: {
          cardId,
          action: 'NFC_PREPARED',
          actorIdentityId: actor.identityId,
          metadata: { chipType: profile.chipType, batch: row.batch },
        },
      });
      return row;
    });
    await this.audit.record({
      identityId: actor.identityId,
      companyId,
      action: 'staff_card.nfc_prepared',
      entityType: 'StaffIdCard',
      entityId: cardId,
      metadata: { chipType: profile.chipType, batch: cred.batch },
    });

    return {
      cardId,
      status: cred.status,
      reference: cred.reference,
      url,
      batch: cred.batch,
      recordUid: dto.recordUid === true,
      chip: {
        type: profile.chipType,
        ...CHIP_CAPABILITIES[profile.chipType],
      },
      plan,
      instructions: [
        'Write the NDEF URI record to the chip with a compatible reader or an NFC phone (the exact bytes are in "plan").',
        'Then read the chip back and confirm here. The chip counts as written only if what it holds matches exactly.',
        'Do not write names, numbers, passwords or any other personal data to the chip.',
      ],
    };
  }

  /**
   * Step 3. The writer reports the outcome. A successful write is accepted only if the read-back reference is exactly
   * the one prepared. If the serial number is to be recorded, it must not already belong to another card.
   */
  async confirmEncoding(
    companyId: string,
    cardId: string,
    input: {
      success: boolean;
      readBack?: string;
      uid?: string;
      error?: string;
      recordUid?: boolean;
      simulated?: boolean;
    },
    actor: NfcActor,
  ) {
    // A confirmation made without a real read-back proves nothing about a real chip: never accepted in production.
    if (input.simulated && isProductionEnv())
      throw new ForbiddenException(
        'Simulated confirmations are not accepted in production.',
      );
    const card = await this.cardOf(companyId, cardId);
    const cred = card.nfc;
    if (!cred)
      throw new NotFoundException('Prepare the NFC chip for this card first.');
    if (cred.status === 'VERIFIED')
      return { status: 'VERIFIED', already: true };

    const fail = async (reason: string) => {
      await this.prisma.staffIdCardNfc.update({
        where: { cardId },
        data: {
          status: 'FAILED',
          failureReason: reason.slice(0, 300),
          updatedAt: new Date(),
        },
      });
      await this.prisma.staffIdCardEvent.create({
        data: {
          cardId,
          action: 'NFC_ENCODING_FAILED',
          reason: reason.slice(0, 300),
          actorIdentityId: actor.identityId,
        },
      });
      await this.audit.record({
        identityId: actor.identityId,
        companyId,
        action: 'staff_card.nfc_encoding_failed',
        entityType: 'StaffIdCard',
        entityId: cardId,
        reason,
      });
      return { status: 'FAILED' as const, reason };
    };

    if (!input.success)
      return fail(
        input.error?.trim() || 'The writer reported that writing failed.',
      );
    const readBack = input.readBack
      ? referenceFromPayload(input.readBack)
      : null;
    if (!readBack)
      return fail('Nothing readable was found on the chip after writing.');
    if (readBack !== cred.reference)
      return fail('What the chip holds does not match what was prepared.');

    let uidHash: string | null = null;
    let hint: string | null = null;
    if (input.recordUid && input.uid) {
      const uid = normaliseUid(input.uid);
      if (!uid)
        return fail('The chip serial number was not in a valid format.');
      uidHash = FieldCipher.default().keyedHash(uid, 'staff-card-nfc-uid');
      const clash = await this.prisma.staffIdCardNfc.findFirst({
        where: { companyId, uidHash, cardId: { not: cardId } },
        select: { cardId: true },
      });
      if (clash)
        return fail(
          'This chip serial number is already recorded for another card. The chip may be a copy or used twice.',
        );
      hint = uidHint(uid);
    }

    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.staffIdCardNfc.update({
        where: { cardId },
        data: {
          status: 'VERIFIED',
          encodedAt: now,
          verifiedAt: now,
          encodedByIdentityId: actor.identityId,
          failureReason: null,
          uidHash,
          uidHint: hint,
        },
      });
      await tx.staffIdCardEvent.create({
        data: {
          cardId,
          action: 'NFC_ENCODED',
          actorIdentityId: actor.identityId,
          metadata: { serialRecorded: !!uidHash, simulated: input.simulated === true },
        },
      });
    });
    await this.audit.record({
      identityId: actor.identityId,
      companyId,
      action: 'staff_card.nfc_encoded',
      entityType: 'StaffIdCard',
      entityId: cardId,
      metadata: { serialRecorded: !!uidHash },
    });
    return { status: 'VERIFIED' as const, serialRecorded: !!uidHash };
  }

  /** What an administrator sees for one card's chip (never the reference itself once confirmed). */
  async statusFor(companyId: string, cardId: string) {
    const card = await this.cardOf(companyId, cardId);
    const c = card.nfc;
    if (!c) return { present: false as const };
    return {
      present: true as const,
      status: c.status,
      batch: c.batch,
      encodedAt: c.encodedAt,
      verifiedAt: c.verifiedAt,
      failureReason: c.failureReason,
      serialRecorded: !!c.uidHash,
      serialHint: c.uidHint,
    };
  }

  async batches(companyId: string) {
    const rows = await this.prisma.staffIdCardNfc.groupBy({
      by: ['batch', 'status'],
      where: { companyId },
      _count: { _all: true },
    });
    const out = new Map<string, Record<string, number>>();
    for (const r of rows) {
      const key = r.batch ?? '(no batch)';
      out.set(key, { ...(out.get(key) ?? {}), [r.status]: r._count._all });
    }
    return [...out.entries()].map(([batch, counts]) => ({ batch, ...counts }));
  }

  /** The unified status for the readers screen: configuration, devices and the last taps. */
  async overview(companyId: string) {
    const [profiles, readers, recent, counts] = await Promise.all([
      this.listProfiles(companyId),
      this.listReaders(companyId),
      this.prisma.staffIdCardScan.findMany({
        where: { companyId, method: { in: ['NFC', 'NFC_UID', 'QR_AND_NFC'] } },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          id: true,
          result: true,
          method: true,
          assurance: true,
          simulated: true,
          createdAt: true,
          readerId: true,
        },
      }),
      this.prisma.staffIdCardNfc.groupBy({
        by: ['status'],
        where: { companyId },
        _count: { _all: true },
      }),
    ]);
    return {
      profiles,
      readers,
      recent,
      chips: Object.fromEntries(counts.map((c) => [c.status, c._count._all])),
    };
  }
}
